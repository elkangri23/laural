import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import type { GoogleOAuthConfig } from "./config.js";
export type GoogleOAuthFlow = { cookieDigest: string; csrfDigest: string; accountId: string };

type Transaction = {
  cookie_digest: string;
  csrf_digest: string;
  nonce_digest: string;
  code_verifier: string;
};

export class GoogleOAuthService {
  private readonly client: OAuth2Client;

  constructor(private readonly pool: Pick<Pool, "query" | "connect">, private readonly config: GoogleOAuthConfig, client?: OAuth2Client) {
    this.client = client ?? new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
  }

  async start(cookieDigest: string, csrfDigest: string): Promise<string> {
    if (!isDigest(cookieDigest) || !isDigest(csrfDigest)) throw new Error("Flujo OAuth no válido.");
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const { codeVerifier, codeChallenge } = await this.client.generateCodeVerifierAsync();
    if (!codeChallenge) throw new Error("No se pudo generar el desafío PKCE.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const flow = await client.query(
        `SELECT 1 FROM native_auth_flows WHERE cookie_digest = $1 AND csrf_digest = $2
          AND consumed_at IS NULL AND expires_at > now() AND attempts < 5 FOR UPDATE`,
        [cookieDigest, csrfDigest],
      );
      if (flow.rowCount !== 1) throw new Error("Flujo OAuth caducado.");
      await client.query(
        `INSERT INTO google_oauth_transactions (state_digest, cookie_digest, csrf_digest, nonce_digest, code_verifier, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')`,
        [sha256(state), cookieDigest, csrfDigest, sha256(nonce), codeVerifier],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return this.client.generateAuthUrl({
      scope: ["openid", "email"], state, nonce, code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256, prompt: "select_account",
    });
  }

  async finish(state: string, code: string): Promise<GoogleOAuthFlow | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || code.length < 1 || code.length > 2048) return null;
    const transaction = await this.consumeTransaction(sha256(state));
    if (!transaction) return null;
    const flowActive = await this.pool.query(
      `SELECT 1 FROM native_auth_flows WHERE cookie_digest = $1 AND csrf_digest = $2
        AND consumed_at IS NULL AND expires_at > now() AND attempts < 5`,
      [transaction.cookie_digest, transaction.csrf_digest],
    );
    if (flowActive.rowCount !== 1) return null;

    try {
      const tokens = await this.client.getToken({ code, codeVerifier: transaction.code_verifier, redirect_uri: this.config.redirectUri });
      if (!tokens.tokens.id_token) return null;
      const ticket = await this.client.verifyIdToken({ idToken: tokens.tokens.id_token, audience: this.config.clientId });
      const claims = ticket.getPayload();
      if (!claims || typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 255
        || typeof claims.email !== "string" || claims.email.length > 320
        || claims.email_verified !== true || typeof claims.nonce !== "string"
        || !equalDigest(sha256(claims.nonce), transaction.nonce_digest)) return null;
      const email = claims.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
      const stillActive = await this.pool.query(
        `SELECT 1 FROM native_auth_flows WHERE cookie_digest = $1 AND csrf_digest = $2
          AND consumed_at IS NULL AND expires_at > now() AND attempts < 5`,
        [transaction.cookie_digest, transaction.csrf_digest],
      );
      if (stillActive.rowCount !== 1) return null;
      const accountId = await this.linkIdentity(claims.sub, email);
      return accountId ? { cookieDigest: transaction.cookie_digest, csrfDigest: transaction.csrf_digest, accountId } : null;
    } catch {
      return null;
    }
  }

  async cancel(state: string): Promise<void> {
    if (/^[A-Za-z0-9_-]{43}$/.test(state)) await this.consumeTransaction(sha256(state));
  }

  private async consumeTransaction(stateDigest: string): Promise<Transaction | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<Transaction>(
        `DELETE FROM google_oauth_transactions WHERE state_digest = $1 AND expires_at > now()
         RETURNING cookie_digest, csrf_digest, nonce_digest, code_verifier`,
        [stateDigest],
      );
      await client.query("COMMIT");
      return result.rows[0] ?? null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async linkIdentity(subject: string, email: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ account_id: string }>(
        `SELECT i.account_id FROM account_identities i JOIN accounts a ON a.id = i.account_id
         WHERE i.provider = 'google' AND i.subject = $1 AND a.deleted_at IS NULL AND a.email_verified_at IS NOT NULL FOR UPDATE OF a`,
        [subject],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return existing.rows[0].account_id;
      }
      const accounts = await client.query<{ id: string; email_verified_at: Date | null }>(
        `SELECT id, email_verified_at FROM accounts WHERE lower(email) = $1 AND deleted_at IS NULL FOR UPDATE`, [email],
      );
      let accountId = accounts.rows[0]?.id;
      if (accounts.rows[0] && !accounts.rows[0].email_verified_at) {
        await client.query("ROLLBACK");
        return null;
      }
      if (!accountId) {
        const created = await client.query<{ id: string }>(
          `INSERT INTO accounts (email, display_name, email_verified_at) VALUES ($1, 'Usuario Google', now()) RETURNING id`, [email],
        );
        accountId = created.rows[0]?.id;
      }
      if (!accountId) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `INSERT INTO account_identities (account_id, provider, subject) VALUES ($1, 'google', $2)`, [accountId, subject],
      );
      await client.query("COMMIT");
      return accountId;
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) return null;
      throw error;
    } finally {
      client.release();
    }
  }
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function isDigest(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
function equalDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex"); const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
function isUniqueViolation(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "23505"; }
