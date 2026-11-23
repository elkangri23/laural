import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import type {
  AuthorizationRedirect,
  NativeAuthStore,
  NativeFlowParameters,
  NativeLoginCandidate,
} from "./native-auth.js";

export class PostgresNativeAuthStore implements NativeAuthStore {
  constructor(private readonly pool: Pool) {}

  async createFlow(input: NativeFlowParameters & { cookieDigest: string; csrfDigest: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO native_auth_flows
         (cookie_digest, csrf_digest, redirect_uri, state, code_challenge, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')`,
      [input.cookieDigest, input.csrfDigest, input.redirectUri, input.state, input.codeChallenge],
    );
  }

  async isFlowActive(cookieDigest: string, csrfDigest: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM native_auth_flows
        WHERE cookie_digest = $1 AND csrf_digest = $2
          AND consumed_at IS NULL AND expires_at > now() AND attempts < 5`,
      [cookieDigest, csrfDigest],
    );
    return result.rows.length > 0;
  }

  async findLoginCandidate(cookieDigest: string, csrfDigest: string, email: string): Promise<NativeLoginCandidate | null> {
    const flowResult = await this.pool.query<{
      id: string;
      redirect_uri: string;
      state: string;
      code_challenge: string;
    }>(
      `SELECT id, redirect_uri, state, code_challenge FROM native_auth_flows
        WHERE cookie_digest = $1 AND csrf_digest = $2
          AND consumed_at IS NULL AND expires_at > now() AND attempts < 5`,
      [cookieDigest, csrfDigest],
    );
    const flow = flowResult.rows[0];
    if (!flow) return null;

    const accountResult = await this.pool.query<{
      id: string;
      password_hash: string | null;
      email: string;
      email_verified_at: Date | null;
      mfa_enabled: boolean;
    }>(
      `SELECT a.id, a.email, a.password_hash, a.email_verified_at,
              EXISTS (SELECT 1 FROM account_totp_factors t WHERE t.account_id = a.id AND t.enabled_at IS NOT NULL) AS mfa_enabled
         FROM accounts a WHERE lower(a.email) = $1 AND a.deleted_at IS NULL`,
      [email],
    );
    const account = accountResult.rows[0];
    return {
      flowId: flow.id,
      redirectUri: flow.redirect_uri,
      state: flow.state,
      codeChallenge: flow.code_challenge,
      accountId: account?.id ?? null,
      passwordHash: account?.password_hash ?? null,
      emailVerified: account?.email_verified_at !== null && account !== undefined,
      mfaEnabled: account?.mfa_enabled ?? false,
      email: account?.email ?? email,
    };
  }

  async findPasskeyLoginCandidate(cookieDigest: string, csrfDigest: string, accountId: string): Promise<NativeLoginCandidate | null> {
    const result = await this.pool.query<{
      flow_id: string;
      redirect_uri: string;
      state: string;
      code_challenge: string;
      id: string;
      email: string;
      mfa_enabled: boolean;
    }>(
      `SELECT f.id AS flow_id, f.redirect_uri, f.state, f.code_challenge,
              a.id, a.email,
              EXISTS (SELECT 1 FROM account_totp_factors t WHERE t.account_id = a.id AND t.enabled_at IS NOT NULL) AS mfa_enabled
         FROM native_auth_flows f
         JOIN accounts a ON a.id = $3 AND a.deleted_at IS NULL AND a.email_verified_at IS NOT NULL
        WHERE f.cookie_digest = $1 AND f.csrf_digest = $2
          AND f.consumed_at IS NULL AND f.expires_at > now() AND f.attempts < 5`,
      [cookieDigest, csrfDigest, accountId],
    );
    const candidate = result.rows[0];
    return candidate ? {
      flowId: candidate.flow_id,
      redirectUri: candidate.redirect_uri,
      state: candidate.state,
      codeChallenge: candidate.code_challenge,
      accountId: candidate.id,
      email: candidate.email,
      passwordHash: null,
      emailVerified: true,
      mfaEnabled: candidate.mfa_enabled,
    } : null;
  }

  async failLogin(cookieDigest: string, csrfDigest: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const flow = await client.query<{ id: string }>(
        `SELECT id FROM native_auth_flows
          WHERE cookie_digest = $1 AND csrf_digest = $2
            AND consumed_at IS NULL AND expires_at > now() AND attempts < 5
          FOR UPDATE`,
        [cookieDigest, csrfDigest],
      );
      const row = flow.rows[0];
      if (row) {
        await client.query(
          `UPDATE native_auth_flows
              SET attempts = attempts + 1,
                  consumed_at = CASE WHEN attempts + 1 >= 5 THEN now() ELSE consumed_at END
            WHERE id = $1`,
          [row.id],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async requireMfa(input: { flowId: string; cookieDigest: string; csrfDigest: string; accountId: string }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE native_auth_flows AS f SET mfa_account_id = $4
        WHERE f.id = $1 AND f.cookie_digest = $2 AND f.csrf_digest = $3
          AND f.consumed_at IS NULL AND f.expires_at > now() AND f.attempts < 5
          AND EXISTS (SELECT 1 FROM account_totp_factors t WHERE t.account_id = $4 AND t.enabled_at IS NOT NULL)`,
      [input.flowId, input.cookieDigest, input.csrfDigest, input.accountId],
    );
    return result.rowCount === 1;
  }

  async completeLogin(input: {
    flowId: string;
    cookieDigest: string;
    csrfDigest: string;
    accountId: string;
    codeDigest: string;
  }): Promise<AuthorizationRedirect | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const flowResult = await client.query<{
        redirect_uri: string;
        state: string;
        code_challenge: string;
      }>(
        `SELECT redirect_uri, state, code_challenge FROM native_auth_flows
          WHERE id = $1 AND cookie_digest = $2 AND csrf_digest = $3
            AND consumed_at IS NULL AND expires_at > now() AND attempts < 5
          FOR UPDATE`,
        [input.flowId, input.cookieDigest, input.csrfDigest],
      );
      const flow = flowResult.rows[0];
      if (!flow) {
        await client.query("ROLLBACK");
        return null;
      }
      const account = await client.query(
        `SELECT id FROM accounts
          WHERE id = $1 AND email_verified_at IS NOT NULL AND deleted_at IS NULL
          FOR UPDATE`,
        [input.accountId],
      );
      if (account.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `INSERT INTO native_authorization_codes
           (code_digest, flow_id, account_id, code_challenge, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '2 minutes')`,
        [input.codeDigest, input.flowId, input.accountId, flow.code_challenge],
      );
      await client.query("UPDATE native_auth_flows SET consumed_at = now() WHERE id = $1", [input.flowId]);
      await client.query("COMMIT");
      return { redirectUri: flow.redirect_uri, state: flow.state };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async exchangeCode(codeDigest: string, codeChallenge: string, sessionDigest: string): Promise<Date | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const codeResult = await client.query<{
        id: string;
        account_id: string;
        code_challenge: string;
        attempts: number;
      }>(
        `SELECT c.id, c.account_id, c.code_challenge, c.attempts FROM native_authorization_codes AS c
          JOIN accounts AS a ON a.id = c.account_id
          WHERE c.code_digest = $1 AND c.consumed_at IS NULL AND c.expires_at > now() AND c.attempts < 5
            AND a.email_verified_at IS NOT NULL AND a.deleted_at IS NULL
          FOR UPDATE OF c, a`,
        [codeDigest],
      );
      const code = codeResult.rows[0];
      if (!code) {
        await client.query("COMMIT");
        return null;
      }

      const supplied = Buffer.from(codeChallenge);
      const expected = Buffer.from(code.code_challenge);
      const matches = supplied.length === expected.length && timingSafeEqual(supplied, expected);
      if (!matches) {
        const attempts = code.attempts + 1;
        await client.query(
          `UPDATE native_authorization_codes
              SET attempts = $2, consumed_at = CASE WHEN $2 >= 5 THEN now() ELSE consumed_at END
            WHERE id = $1`,
          [code.id, attempts],
        );
        await client.query("COMMIT");
        return null;
      }

      const session = await client.query<{ expires_at: Date }>(
        `INSERT INTO account_sessions (account_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '30 days')
         RETURNING expires_at`,
        [code.account_id, sessionDigest],
      );
      await client.query("UPDATE native_authorization_codes SET consumed_at = now() WHERE id = $1", [code.id]);
      await client.query("COMMIT");
      return session.rows[0]?.expires_at ?? null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
