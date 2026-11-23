import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  createRecoveryCodes,
  createTotpSecret,
  createTotpUri,
  decryptTotpSecret,
  encryptTotpSecret,
  matchingTotpCounter,
  recoveryCodeDigest,
  type EncryptedTotpSecret,
} from "./totp.js";
import type { AuthorizationRedirect } from "./native-auth.js";

const RECENT_AUTH_WINDOW = "10 minutes";

export type MfaStatus = { totpEnabled: boolean; recoveryCodesRemaining: number; enrollmentPending: boolean };

export class AccountMfaService {
  constructor(private readonly pool: Pool, private readonly encryptionKey: Buffer, private readonly recoveryPepper: string) {
    if (encryptionKey.length !== 32) throw new Error("TOTP_ENCRYPTION_KEY debe ser una clave de 32 bytes.");
    if (Buffer.byteLength(recoveryPepper, "utf8") < 32) throw new Error("AUTH_RECOVERY_PEPPER debe tener al menos 32 bytes.");
  }

  async status(accountId: string): Promise<MfaStatus> {
    const result = await this.pool.query<{ totp_enabled: boolean; recovery_codes_remaining: string; enrollment_pending: boolean }>(
      `SELECT EXISTS (
                SELECT 1 FROM account_totp_factors WHERE account_id = $1 AND enabled_at IS NOT NULL
              ) AS totp_enabled,
              (SELECT count(*)::text FROM account_recovery_codes WHERE account_id = $1 AND is_active AND consumed_at IS NULL) AS recovery_codes_remaining,
              EXISTS (
                SELECT 1 FROM account_totp_enrollments WHERE account_id = $1 AND expires_at > now()
              ) AS enrollment_pending`,
      [accountId],
    );
    const row = result.rows[0];
    return {
      totpEnabled: row?.totp_enabled ?? false,
      recoveryCodesRemaining: Number(row?.recovery_codes_remaining ?? 0),
      enrollmentPending: row?.enrollment_pending ?? false,
    };
  }

  async startEnrollment(accountId: string, authorization: string | undefined): Promise<{ secret: string; provisioningUri: string } | null> {
    if (!await this.hasRecentSession(accountId, authorization)) return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (!await this.assertRecentSession(client, accountId, authorization)) {
        await client.query("ROLLBACK");
        return null;
      }
      const account = await client.query<{ email: string }>(
        "SELECT email FROM accounts WHERE id = $1 AND email_verified_at IS NOT NULL AND deleted_at IS NULL FOR UPDATE",
        [accountId],
      );
      const email = account.rows[0]?.email;
      const factor = await client.query(
        "SELECT 1 FROM account_totp_factors WHERE account_id = $1 AND enabled_at IS NOT NULL FOR UPDATE",
        [accountId],
      );
      if (!email || factor.rows.length) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query("DELETE FROM account_totp_factors WHERE account_id = $1 AND enabled_at IS NULL", [accountId]);
      await client.query("DELETE FROM account_recovery_codes WHERE account_id = $1 AND NOT is_active", [accountId]);
      const secret = createTotpSecret();
      const encryptedSecret = encryptTotpSecret(secret, this.encryptionKey, accountId);
      await client.query(
        `INSERT INTO account_totp_enrollments (account_id, encrypted_secret, expires_at)
         VALUES ($1, $2, now() + interval '15 minutes')
         ON CONFLICT (account_id) DO UPDATE
           SET encrypted_secret = EXCLUDED.encrypted_secret, attempts = 0,
               expires_at = EXCLUDED.expires_at, created_at = now()`,
        [accountId, encryptedSecret],
      );
      await client.query("COMMIT");
      return { secret, provisioningUri: createTotpUri(secret, email) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async confirmEnrollment(accountId: string, authorization: string | undefined, code: string): Promise<string[] | null> {
    if (!await this.hasRecentSession(accountId, authorization)) return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (!await this.assertRecentSession(client, accountId, authorization)) {
        await client.query("ROLLBACK");
        return null;
      }
      if (!await this.lockAccount(client, accountId)) {
        await client.query("ROLLBACK");
        return null;
      }
      const enrollment = await client.query<{ encrypted_secret: EncryptedTotpSecret; attempts: number }>(
        `SELECT encrypted_secret, attempts FROM account_totp_enrollments
          WHERE account_id = $1 AND expires_at > now() AND attempts < 5 FOR UPDATE`,
        [accountId],
      );
      const row = enrollment.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      const secret = decryptTotpSecret(row.encrypted_secret, this.encryptionKey, accountId);
      const counter = matchingTotpCounter(secret, code, Date.now());
      if (counter === null) {
        await client.query(
          `UPDATE account_totp_enrollments SET attempts = $2::smallint,
             expires_at = CASE WHEN $2::smallint >= 5 THEN now() ELSE expires_at END
           WHERE account_id = $1`,
          [accountId, row.attempts + 1],
        );
        await client.query("COMMIT");
        return null;
      }
      const existing = await client.query(
        "SELECT 1 FROM account_totp_factors WHERE account_id = $1 AND enabled_at IS NOT NULL FOR UPDATE",
        [accountId],
      );
      if (existing.rows.length) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `INSERT INTO account_totp_factors (account_id, encrypted_secret, last_used_counter, enabled_at)
         VALUES ($1, $2, $3, NULL)
         ON CONFLICT (account_id) DO UPDATE SET encrypted_secret = EXCLUDED.encrypted_secret,
           last_used_counter = EXCLUDED.last_used_counter, enabled_at = NULL, created_at = now()`,
        [accountId, row.encrypted_secret, counter],
      );
      const recoveryCodes = createRecoveryCodes();
      for (const recoveryCode of recoveryCodes) {
        await client.query(
          "INSERT INTO account_recovery_codes (account_id, verifier_digest, is_active) VALUES ($1, $2, false)",
          [accountId, recoveryCodeDigest(recoveryCode, accountId, this.recoveryPepper)],
        );
      }
      await client.query("DELETE FROM account_totp_enrollments WHERE account_id = $1", [accountId]);
      await client.query("COMMIT");
      return recoveryCodes;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async acknowledgeRecoveryCodes(accountId: string, authorization: string | undefined): Promise<boolean> {
    if (!await this.hasRecentSession(accountId, authorization)) return false;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (!await this.assertRecentSession(client, accountId, authorization)) {
        await client.query("ROLLBACK");
        return false;
      }
      if (!await this.lockAccount(client, accountId)) {
        await client.query("ROLLBACK");
        return false;
      }
      const result = await client.query<{ account_id: string; enabled: boolean }>(
        `SELECT account_id, enabled_at IS NOT NULL AS enabled FROM account_totp_factors WHERE account_id = $1 FOR UPDATE`,
        [accountId],
      );
      const pendingCodes = await client.query(
        `SELECT 1 FROM account_recovery_codes WHERE account_id = $1 AND NOT is_active AND consumed_at IS NULL LIMIT 1 FOR UPDATE`,
        [accountId],
      );
      const factor = result.rows[0];
      if (!factor) {
        await client.query("ROLLBACK");
        return false;
      }
      if (!pendingCodes.rows.length) {
        if (factor.enabled) {
          await client.query("COMMIT");
          return true;
        }
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `UPDATE account_recovery_codes SET consumed_at = now()
          WHERE account_id = $1 AND is_active AND consumed_at IS NULL`,
        [accountId],
      );
      await client.query(
        `UPDATE account_recovery_codes SET is_active = true
          WHERE account_id = $1 AND NOT is_active AND consumed_at IS NULL`,
        [accountId],
      );
      await client.query("UPDATE account_totp_factors SET enabled_at = coalesce(enabled_at, now()) WHERE account_id = $1", [accountId]);
      await this.revokeOtherSessions(client, accountId, authorization);
      await this.queueSecurityEmail(client, accountId, factor.enabled ? "recovery_codes_rotated" : "totp_enabled");
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async rotateRecoveryCodes(accountId: string, authorization: string | undefined): Promise<string[] | null> {
    if (!await this.hasRecentSession(accountId, authorization)) return null;
    const codes = createRecoveryCodes();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (!await this.assertRecentSession(client, accountId, authorization)) {
        await client.query("ROLLBACK");
        return null;
      }
      if (!await this.lockAccount(client, accountId)) {
        await client.query("ROLLBACK");
        return null;
      }
      const factor = await client.query(
        "SELECT 1 FROM account_totp_factors WHERE account_id = $1 AND enabled_at IS NOT NULL FOR UPDATE",
        [accountId],
      );
      if (!factor.rows.length) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("DELETE FROM account_recovery_codes WHERE account_id = $1 AND NOT is_active", [accountId]);
      for (const code of codes) {
        await client.query("INSERT INTO account_recovery_codes (account_id, verifier_digest, is_active) VALUES ($1, $2, false)", [accountId, recoveryCodeDigest(code, accountId, this.recoveryPepper)]);
      }
      await this.revokeOtherSessions(client, accountId, authorization);
      await client.query("COMMIT");
      return codes;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async disableTotp(accountId: string, authorization: string | undefined): Promise<boolean> {
    if (!await this.hasRecentSession(accountId, authorization)) return false;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (!await this.assertRecentSession(client, accountId, authorization)) {
        await client.query("ROLLBACK");
        return false;
      }
      if (!await this.lockAccount(client, accountId)) {
        await client.query("ROLLBACK");
        return false;
      }
      const result = await client.query(
        "DELETE FROM account_totp_factors WHERE account_id = $1 AND enabled_at IS NOT NULL RETURNING account_id",
        [accountId],
      );
      if (!result.rows.length) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query("DELETE FROM account_recovery_codes WHERE account_id = $1", [accountId]);
      await this.revokeOtherSessions(client, accountId, authorization);
      await this.queueSecurityEmail(client, accountId, "totp_disabled");
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelEnrollment(accountId: string, authorization: string | undefined): Promise<void> {
    if (!await this.hasRecentSession(accountId, authorization)) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (!await this.assertRecentSession(client, accountId, authorization)) {
        await client.query("ROLLBACK");
        return;
      }
      if (!await this.lockAccount(client, accountId)) {
        await client.query("ROLLBACK");
        return;
      }
      await client.query("DELETE FROM account_totp_enrollments WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM account_totp_factors WHERE account_id = $1 AND enabled_at IS NULL", [accountId]);
      await client.query("DELETE FROM account_recovery_codes WHERE account_id = $1 AND NOT is_active", [accountId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async requireMfaLogin(input: { flowId: string; cookieDigest: string; csrfDigest: string; accountId: string }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE native_auth_flows AS f SET mfa_account_id = $4
        WHERE f.id = $1 AND f.cookie_digest = $2 AND f.csrf_digest = $3
          AND f.consumed_at IS NULL AND f.expires_at > now() AND f.attempts < 5
          AND EXISTS (SELECT 1 FROM account_totp_factors t WHERE t.account_id = $4 AND t.enabled_at IS NOT NULL)`,
      [input.flowId, input.cookieDigest, input.csrfDigest, input.accountId],
    );
    return result.rowCount === 1;
  }

  async pendingMfaLoginAccountId(cookieToken: string, csrfToken: string, email: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(cookieToken) || !/^[A-Za-z0-9_-]{43}$/.test(csrfToken)) return null;
    const cookieDigest = createHash("sha256").update(cookieToken).digest("hex");
    const csrfDigest = createHash("sha256").update(csrfToken).digest("hex");
    const result = await this.pool.query<{ account_id: string }>(
      `SELECT f.mfa_account_id AS account_id
         FROM native_auth_flows f
         JOIN accounts a ON a.id = f.mfa_account_id
         JOIN account_totp_factors t ON t.account_id = a.id AND t.enabled_at IS NOT NULL
        WHERE f.cookie_digest = $1 AND f.csrf_digest = $2 AND lower(a.email) = $3
          AND f.mfa_account_id IS NOT NULL AND f.consumed_at IS NULL AND f.expires_at > now()
          AND f.attempts < 5 AND a.email_verified_at IS NOT NULL AND a.deleted_at IS NULL`,
      [cookieDigest, csrfDigest, email.trim().toLowerCase()],
    );
    return result.rows[0]?.account_id ?? null;
  }

  async completeMfaLogin(input: { cookieDigest: string; csrfDigest: string; email: string; proof: string; codeDigest: string }): Promise<AuthorizationRedirect | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const flowResult = await client.query<{
        id: string; account_id: string; redirect_uri: string; state: string; code_challenge: string; attempts: number;
      }>(
        `SELECT f.id, f.mfa_account_id AS account_id, f.redirect_uri, f.state, f.code_challenge, f.attempts
           FROM native_auth_flows f JOIN accounts a ON a.id = f.mfa_account_id
          WHERE f.cookie_digest = $1 AND f.csrf_digest = $2 AND lower(a.email) = $3
            AND f.mfa_account_id IS NOT NULL AND f.consumed_at IS NULL AND f.expires_at > now()
            AND f.attempts < 5 AND a.email_verified_at IS NOT NULL AND a.deleted_at IS NULL
          FOR UPDATE OF f, a`,
        [input.cookieDigest, input.csrfDigest, input.email.trim().toLowerCase()],
      );
      const flow = flowResult.rows[0];
      if (!flow) {
        await client.query("COMMIT");
        return null;
      }
      const factorResult = await client.query<{ encrypted_secret: EncryptedTotpSecret; last_used_counter: string }>(
        `SELECT encrypted_secret, last_used_counter::text FROM account_totp_factors
          WHERE account_id = $1 AND enabled_at IS NOT NULL FOR UPDATE`,
        [flow.account_id],
      );
      const factor = factorResult.rows[0];
      if (!factor) {
        await client.query("COMMIT");
        return null;
      }
      const secret = decryptTotpSecret(factor.encrypted_secret, this.encryptionKey, flow.account_id);
      const counter = matchingTotpCounter(secret, input.proof, Date.now(), Number(factor.last_used_counter));
      let authenticated = false;
      if (counter !== null) {
        const update = await client.query(
          `UPDATE account_totp_factors SET last_used_counter = $2
            WHERE account_id = $1 AND last_used_counter < $2`,
          [flow.account_id, counter],
        );
        authenticated = update.rowCount === 1;
      } else {
        try {
          const digest = recoveryCodeDigest(input.proof, flow.account_id, this.recoveryPepper);
          const consumed = await client.query(
            `UPDATE account_recovery_codes SET consumed_at = now()
              WHERE account_id = $1 AND verifier_digest = $2 AND consumed_at IS NULL RETURNING account_id`,
            [flow.account_id, digest],
          );
          authenticated = consumed.rowCount === 1;
        } catch {
          authenticated = false;
        }
      }
      if (!authenticated) {
        const attempts = flow.attempts + 1;
        await client.query(
          `UPDATE native_auth_flows SET attempts = $2::smallint,
             consumed_at = CASE WHEN $2::smallint >= 5 THEN now() ELSE consumed_at END
           WHERE id = $1`,
          [flow.id, attempts],
        );
        await client.query("COMMIT");
        return null;
      }
      await client.query(
        `INSERT INTO native_authorization_codes (code_digest, flow_id, account_id, code_challenge, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '2 minutes')`,
        [input.codeDigest, flow.id, flow.account_id, flow.code_challenge],
      );
      await client.query("UPDATE native_auth_flows SET consumed_at = now() WHERE id = $1", [flow.id]);
      await client.query("COMMIT");
      return { redirectUri: flow.redirect_uri, state: flow.state };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async hasRecentSession(accountId: string, authorization: string | undefined): Promise<boolean> {
    const token = sessionTokenFromHeader(authorization);
    if (!token) return false;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await this.pool.query(
      `SELECT 1 FROM account_sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.account_id = $1 AND s.token_hash = $2 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND s.created_at > now() - interval '${RECENT_AUTH_WINDOW}'
          AND a.email_verified_at IS NOT NULL AND a.deleted_at IS NULL`,
      [accountId, tokenHash],
    );
    return result.rows.length === 1;
  }

  private async assertRecentSession(client: import("pg").PoolClient, accountId: string, authorization: string | undefined): Promise<boolean> {
    const token = sessionTokenFromHeader(authorization);
    if (!token) return false;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await client.query(
      `SELECT 1 FROM account_sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.account_id = $1 AND s.token_hash = $2 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND s.created_at > now() - interval '${RECENT_AUTH_WINDOW}'
          AND a.email_verified_at IS NOT NULL AND a.deleted_at IS NULL FOR UPDATE OF s`,
      [accountId, tokenHash],
    );
    return result.rows.length === 1;
  }

  private async lockAccount(client: import("pg").PoolClient, accountId: string): Promise<boolean> {
    const result = await client.query(
      "SELECT id FROM accounts WHERE id = $1 AND email_verified_at IS NOT NULL AND deleted_at IS NULL FOR UPDATE",
      [accountId],
    );
    return result.rows.length === 1;
  }

  private async queueSecurityEmail(
    client: import("pg").PoolClient,
    accountId: string,
    eventType: "totp_enabled" | "recovery_codes_rotated" | "totp_disabled",
  ): Promise<void> {
    const result = await client.query(
      `INSERT INTO account_security_email_outbox (account_id, recipient_email, event_type)
       SELECT id, email, $2 FROM accounts
        WHERE id = $1 AND email_verified_at IS NOT NULL AND deleted_at IS NULL`,
      [accountId, eventType],
    );
    if (result.rowCount !== 1) throw new Error("No se pudo registrar el aviso de seguridad.");
  }

  private async revokeOtherSessions(client: import("pg").PoolClient, accountId: string, authorization: string | undefined): Promise<void> {
    const token = sessionTokenFromHeader(authorization);
    if (!token) throw new Error("La sesión actual no es válida.");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    if (!await this.assertRecentSession(client, accountId, authorization)) throw new Error("La sesión actual no es válida o ha caducado.");
    await client.query(
      `UPDATE account_sessions SET revoked_at = now()
        WHERE account_id = $1 AND token_hash <> $2 AND revoked_at IS NULL AND expires_at > now()
          AND EXISTS (SELECT 1 FROM account_sessions current_session WHERE current_session.account_id = $1
            AND current_session.token_hash = $2 AND current_session.revoked_at IS NULL AND current_session.expires_at > now())`,
      [accountId, tokenHash],
    );
  }
}

function sessionTokenFromHeader(authorization: string | undefined): string | null {
  return authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] ?? null;
}
