import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import type { PasskeyConfig } from "./config.js";
import type { SecurityEmailEvent } from "./security-email-outbox.js";

const FLOW_TTL_SECONDS = 5 * 60;
const CHALLENGE_TTL_SECONDS = 3 * 60;
const MAX_CREDENTIALS_PER_ACCOUNT = 10;
const DISPLAY_NAME_MAX = 80;

type LoginChallenge = { flow_id: string; challenge: string };
type StoredCredential = {
  id: string;
  account_id: string;
  credential_id: string;
  public_key: Buffer;
  sign_count: string;
  transports: string[];
};

export type PasskeyLoginResult = { accountId: string } | null;
export type PasskeySummary = { id: string; name: string; createdAt: string; lastUsedAt: string | null };
export type PasskeyManagementSession = { cookieToken: string; csrfToken: string } | null;

export class AccountPasskeyService {
  constructor(private readonly pool: Pool, private readonly config: PasskeyConfig) {}

  async createManagementTicket(accountId: string, authorization: string | undefined): Promise<string | null> {
    const token = bearerToken(authorization);
    if (!token) return null;
    const recent = await this.pool.query(
      `SELECT 1 FROM account_sessions
        WHERE account_id = $1 AND token_hash = $2 AND revoked_at IS NULL
          AND expires_at > now() AND created_at > now() - interval '10 minutes'`,
      [accountId, digest(token)],
    );
    if (!recent.rows.length) return null;
    const ticket = randomBytes(32).toString("base64url");
    await this.pool.query(
      `INSERT INTO passkey_management_tickets (ticket_digest, account_id, expires_at)
       VALUES ($1, $2, now() + interval '2 minutes')`,
      [digest(ticket), accountId],
    );
    return ticket;
  }

  managementUrl(ticket: string): string {
    return `${this.config.origin}/auth/passkeys/manage#ticket=${encodeURIComponent(ticket)}`;
  }

  async consumeManagementTicket(ticket: string): Promise<PasskeyManagementSession> {
    if (!isOpaqueToken(ticket)) return null;
    const cookieToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ticketResult = await client.query<{ account_id: string }>(
        `UPDATE passkey_management_tickets SET consumed_at = now()
          WHERE ticket_digest = $1 AND consumed_at IS NULL AND expires_at > now()
          RETURNING account_id`,
        [digest(ticket)],
      );
      const accountId = ticketResult.rows[0]?.account_id;
      if (!accountId) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `INSERT INTO passkey_management_sessions (cookie_digest, csrf_digest, account_id, expires_at)
         VALUES ($1, $2, $3, now() + interval '${FLOW_TTL_SECONDS} seconds')`,
        [digest(cookieToken), digest(csrfToken), accountId],
      );
      await client.query("COMMIT");
      return { cookieToken, csrfToken };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createLoginOptions(cookieToken: string, csrfToken: string) {
    if (!isOpaqueToken(cookieToken) || !isOpaqueToken(csrfToken)) return null;
    const flow = await this.pool.query<{ id: string }>(
      `SELECT id FROM native_auth_flows
        WHERE cookie_digest = $1 AND csrf_digest = $2 AND consumed_at IS NULL
          AND expires_at > now() AND attempts < 5`,
      [digest(cookieToken), digest(csrfToken)],
    );
    const flowId = flow.rows[0]?.id;
    if (!flowId) return null;
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      timeout: 60_000,
      userVerification: "required",
    });
    await this.pool.query(
      `INSERT INTO passkey_login_challenges (flow_id, challenge, expires_at)
       VALUES ($1, $2, now() + interval '${CHALLENGE_TTL_SECONDS} seconds')
       ON CONFLICT (flow_id) DO UPDATE SET challenge = EXCLUDED.challenge,
         expires_at = EXCLUDED.expires_at, consumed_at = NULL`,
      [flowId, options.challenge],
    );
    return options;
  }

  async verifyLogin(
    cookieToken: string,
    csrfToken: string,
    response: AuthenticationResponseJSON,
  ): Promise<PasskeyLoginResult> {
    if (!isOpaqueToken(cookieToken) || !isOpaqueToken(csrfToken) || !isValidAuthenticationResponse(response)) return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const challenge = await this.lockLoginChallenge(client, cookieToken, csrfToken);
      if (!challenge) {
        await client.query("ROLLBACK");
        return null;
      }
      const credentialResult = await client.query<StoredCredential>(
        `SELECT p.id, p.account_id, p.credential_id, p.public_key, p.sign_count::text, p.transports
           FROM account_passkeys p JOIN accounts a ON a.id = p.account_id
          WHERE p.credential_id = $1 AND a.email_verified_at IS NOT NULL AND a.deleted_at IS NULL
          FOR UPDATE OF p`,
        [response.id],
      );
      const stored = credentialResult.rows[0];
      if (!stored || response.response.userHandle !== Buffer.from(stored.account_id).toString("base64url")) {
        await client.query("COMMIT");
        return null;
      }
      const credential = toWebAuthnCredential(stored);
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challenge.challenge,
          expectedOrigin: this.config.origin,
          expectedRPID: this.config.rpId,
          credential,
          requireUserVerification: true,
        });
      } catch {
        await client.query("COMMIT");
        return null;
      }
      if (!verification.verified) {
        await client.query("COMMIT");
        return null;
      }
      await client.query(
        `UPDATE account_passkeys SET sign_count = $2, last_used_at = now() WHERE id = $1`,
        [stored.id, verification.authenticationInfo.newCounter],
      );
      await client.query("COMMIT");
      return { accountId: stored.account_id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createRegistrationOptions(cookieToken: string, csrfToken: string, displayName: string) {
    if (!isSafeDisplayName(displayName)) return null;
    const session = await this.getManagementSession(cookieToken, csrfToken);
    if (!session) return null;
    const [account, credentials] = await Promise.all([
      this.pool.query<{ id: string; email: string }>(
        `SELECT a.id, a.email FROM accounts a WHERE a.id = $1 AND a.deleted_at IS NULL`,
        [session.accountId],
      ),
      this.pool.query<{ credential_id: string; transports: string[] }>(
        `SELECT credential_id, transports FROM account_passkeys WHERE account_id = $1`,
        [session.accountId],
      ),
    ]);
    const identity = account.rows[0];
    if (!identity || credentials.rows.length >= MAX_CREDENTIALS_PER_ACCOUNT) return null;
    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: this.config.rpId,
      userID: Buffer.from(identity.id),
      userName: identity.email,
      userDisplayName: identity.email,
      timeout: 60_000,
      attestationType: "none",
      excludeCredentials: credentials.rows.map((credential) => ({
        id: credential.credential_id,
        transports: credential.transports,
      })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    await this.pool.query(
      `INSERT INTO passkey_management_challenges
         (cookie_digest, csrf_digest, account_id, challenge, display_name, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '${CHALLENGE_TTL_SECONDS} seconds')
       ON CONFLICT (cookie_digest) DO UPDATE SET csrf_digest = EXCLUDED.csrf_digest,
         account_id = EXCLUDED.account_id, challenge = EXCLUDED.challenge,
         display_name = EXCLUDED.display_name, expires_at = EXCLUDED.expires_at,
         consumed_at = NULL`,
      [digest(cookieToken), digest(csrfToken), session.accountId, options.challenge, displayName.trim()],
    );
    return options;
  }

  async verifyRegistration(
    cookieToken: string,
    csrfToken: string,
    response: RegistrationResponseJSON,
  ): Promise<boolean> {
    if (!isOpaqueToken(cookieToken) || !isOpaqueToken(csrfToken) || !isValidRegistrationResponse(response)) return false;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const challenge = await client.query<{
        account_id: string;
        challenge: string;
        display_name: string;
      }>(
        `UPDATE passkey_management_challenges c SET consumed_at = now()
          FROM passkey_management_sessions s
         WHERE c.cookie_digest = $1 AND c.csrf_digest = $2
           AND c.account_id = s.account_id AND s.cookie_digest = c.cookie_digest
           AND s.csrf_digest = c.csrf_digest AND s.expires_at > now()
           AND c.consumed_at IS NULL AND c.expires_at > now()
         RETURNING c.account_id, c.challenge, c.display_name`,
        [digest(cookieToken), digest(csrfToken)],
      );
      const state = challenge.rows[0];
      if (!state) {
        await client.query("ROLLBACK");
        return false;
      }
      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response,
          expectedChallenge: state.challenge,
          expectedOrigin: this.config.origin,
          expectedRPID: this.config.rpId,
          requireUserVerification: true,
        });
      } catch {
        await client.query("COMMIT");
        return false;
      }
      if (!verification.verified) {
        await client.query("COMMIT");
        return false;
      }
      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
      const transports = credential.transports ?? [];
      if (!isValidCredentialTransports(transports)) {
        await client.query("COMMIT");
        return false;
      }
      const accountLock = await client.query<{ id: string }>("SELECT id FROM accounts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [state.account_id]);
      const currentCount = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM account_passkeys WHERE account_id = $1", [state.account_id]);
      if (!accountLock.rows.length || Number(currentCount.rows[0]?.count ?? 0) >= MAX_CREDENTIALS_PER_ACCOUNT) {
        await client.query("COMMIT");
        return false;
      }
      await client.query(
        `INSERT INTO account_passkeys
           (account_id, credential_id, public_key, sign_count, transports, display_name, device_type, backed_up)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [state.account_id, credential.id, Buffer.from(credential.publicKey), credential.counter,
          transports, state.display_name, credentialDeviceType, credentialBackedUp],
      );
      await queuePasskeySecurityEmail(client, state.account_id, "passkey_added");
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) return false;
      throw error;
    } finally {
      client.release();
    }
  }

  async listManagementPasskeys(cookieToken: string, csrfToken: string): Promise<PasskeySummary[] | null> {
    const session = await this.getManagementSession(cookieToken, csrfToken);
    if (!session) return null;
    const result = await this.pool.query<{
      id: string;
      display_name: string;
      created_at: Date;
      last_used_at: Date | null;
    }>(
      `SELECT id, display_name, created_at, last_used_at FROM account_passkeys
        WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [session.accountId, MAX_CREDENTIALS_PER_ACCOUNT],
    );
    return result.rows.map((passkey) => ({
      id: passkey.id,
      name: passkey.display_name,
      createdAt: passkey.created_at.toISOString(),
      lastUsedAt: passkey.last_used_at?.toISOString() ?? null,
    }));
  }

  async removeManagementPasskey(cookieToken: string, csrfToken: string, passkeyId: string): Promise<boolean> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(passkeyId)) return false;
    if (!isOpaqueToken(cookieToken) || !isOpaqueToken(csrfToken)) return false;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const session = await client.query<{ account_id: string }>(
        `SELECT account_id FROM passkey_management_sessions
          WHERE cookie_digest = $1 AND csrf_digest = $2 AND expires_at > now()
          FOR UPDATE`,
        [digest(cookieToken), digest(csrfToken)],
      );
      const accountId = session.rows[0]?.account_id;
      if (!accountId) {
        await client.query("ROLLBACK");
        return false;
      }
      const deleted = await client.query<{ id: string }>(
        `DELETE FROM account_passkeys WHERE id = $1 AND account_id = $2 RETURNING id`,
        [passkeyId, accountId],
      );
      if (!deleted.rows.length) {
        await client.query("ROLLBACK");
        return false;
      }
      await queuePasskeySecurityEmail(client, accountId, "passkey_removed");
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async getManagementSession(cookieToken: string, csrfToken: string): Promise<{ accountId: string } | null> {
    if (!isOpaqueToken(cookieToken) || !isOpaqueToken(csrfToken)) return null;
    const result = await this.pool.query<{ account_id: string }>(
      `SELECT account_id FROM passkey_management_sessions
        WHERE cookie_digest = $1 AND csrf_digest = $2 AND expires_at > now()`,
      [digest(cookieToken), digest(csrfToken)],
    );
    const accountId = result.rows[0]?.account_id;
    return accountId ? { accountId } : null;
  }

  private async lockLoginChallenge(client: PoolClient, cookieToken: string, csrfToken: string): Promise<LoginChallenge | null> {
    const result = await client.query<LoginChallenge>(
      `UPDATE passkey_login_challenges c SET consumed_at = now()
        FROM native_auth_flows f
       WHERE f.id = c.flow_id AND f.cookie_digest = $1 AND f.csrf_digest = $2
         AND f.consumed_at IS NULL AND f.expires_at > now() AND f.attempts < 5
         AND c.consumed_at IS NULL AND c.expires_at > now()
       RETURNING c.flow_id, c.challenge`,
      [digest(cookieToken), digest(csrfToken)],
    );
    return result.rows[0] ?? null;
  }
}

async function queuePasskeySecurityEmail(client: PoolClient, accountId: string, eventType: Extract<SecurityEmailEvent, "passkey_added" | "passkey_removed">): Promise<void> {
  const result = await client.query(
    `INSERT INTO account_security_email_outbox (account_id, recipient_email, event_type)
     SELECT id, email, $2 FROM accounts
      WHERE id = $1 AND email_verified_at IS NOT NULL AND deleted_at IS NULL`,
    [accountId, eventType],
  );
  if (result.rowCount !== 1) throw new Error("No se pudo registrar el aviso de seguridad.");
}

function toWebAuthnCredential(credential: StoredCredential): WebAuthnCredential {
  const publicKey = new Uint8Array(new ArrayBuffer(credential.public_key.byteLength));
  publicKey.set(credential.public_key);
  return {
    id: credential.credential_id,
    publicKey,
    counter: Number(credential.sign_count),
    transports: credential.transports,
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bearerToken(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  return match?.[1] ?? null;
}

function isOpaqueToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isSafeDisplayName(value: string): boolean {
  return value.trim().length >= 1 && value.length <= DISPLAY_NAME_MAX && !/[\r\n\u0000-\u001f\u007f]/.test(value);
}

function isValidCredentialTransports(transports: string[]): boolean {
  const allowed = new Set(["ble", "hybrid", "internal", "nfc", "usb"]);
  return transports.length <= 5 && transports.every((transport) => allowed.has(transport));
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function isValidAuthenticationResponse(value: unknown): value is AuthenticationResponseJSON {
  if (!isPlainObject(value) || value.type !== "public-key" || !isBase64Url(value.id) || value.id.length > 1024 || value.rawId !== value.id) return false;
  if (!isPlainObject(value.response)) return false;
  return isBase64Url(value.response.authenticatorData)
    && isBase64Url(value.response.clientDataJSON)
    && isBase64Url(value.response.signature)
    && (value.response.userHandle === null || isBase64Url(value.response.userHandle));
}

function isValidRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  if (!isPlainObject(value) || value.type !== "public-key" || !isBase64Url(value.id) || value.id.length > 1024 || value.rawId !== value.id) return false;
  if (!isPlainObject(value.response)) return false;
  return isBase64Url(value.response.attestationObject) && isBase64Url(value.response.clientDataJSON);
}

function isBase64Url(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 12_000 && /^[A-Za-z0-9_-]+$/.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
