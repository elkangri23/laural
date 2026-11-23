import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { createRecoveryCodes, createTotpSecret, createTotpUri, decryptTotpSecret, encryptTotpSecret, matchingTotpCounter, recoveryCodeDigest, type EncryptedTotpSecret } from "./totp.js";

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type RecoveryEnrollment = { cookieToken: string; csrfToken: string; secret: string; provisioningUri: string };

export class AccountRecoveryService {
  constructor(private readonly pool: Pool, private readonly totpKey: Buffer, private readonly recoveryPepper: string) {
    if (totpKey.length !== 32) throw new Error("TOTP_ENCRYPTION_KEY debe ser una clave de 32 bytes.");
    if (Buffer.byteLength(recoveryPepper, "utf8") < 32) throw new Error("AUTH_RECOVERY_PEPPER debe tener al menos 32 bytes.");
  }

  async startEnrollment(ticket: string): Promise<RecoveryEnrollment | null> {
    if (!TICKET_PATTERN.test(ticket)) return null;
    const cookieToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ grant_id: string; account_id: string; email: string }>(
        `SELECT g.id AS grant_id, c.account_id, a.email
           FROM account_recovery_grants g
           JOIN account_recovery_cases c ON c.id = g.case_id
           JOIN accounts a ON a.id = c.account_id
          WHERE g.token_digest = $1 AND g.consumed_at IS NULL AND g.expires_at > now()
            AND c.review_decision = 'approved' AND c.recovery_completed_at IS NULL
            AND a.email_verified_at IS NOT NULL AND a.deleted_at IS NULL
          FOR UPDATE OF g, c, a`, [sha256(ticket)],
      );
      const grant = result.rows[0];
      if (!grant) { await client.query("ROLLBACK"); return null; }
      const secret = createTotpSecret();
      const encryptedSecret = encryptTotpSecret(secret, this.totpKey, grant.account_id);
      const inserted = await client.query(
        `INSERT INTO account_recovery_enrollments
           (grant_id, account_id, cookie_digest, csrf_digest, encrypted_secret, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '15 minutes')`,
        [grant.grant_id, grant.account_id, sha256(cookieToken), sha256(csrfToken), encryptedSecret],
      );
      await client.query("UPDATE account_recovery_grants SET consumed_at = now() WHERE id = $1", [grant.grant_id]);
      await client.query("UPDATE account_recovery_grant_outbox SET encrypted_ticket = NULL, abandoned_at = COALESCE(abandoned_at, now()), claimed_at = NULL WHERE grant_id = $1 AND delivered_at IS NULL AND abandoned_at IS NULL", [grant.grant_id]);
      await client.query("COMMIT");
      if (inserted.rowCount !== 1) return null;
      return { cookieToken, csrfToken, secret, provisioningUri: createTotpUri(secret, grant.email) };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async confirmEnrollment(cookieToken: string, csrfToken: string, code: string): Promise<string[] | null> {
    if (!TOKEN_PATTERN.test(cookieToken) || !TOKEN_PATTERN.test(csrfToken) || !/^\d{6}$/.test(code)) return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const enrollmentResult = await client.query<{
        id: string; grant_id: string; account_id: string; email: string; encrypted_secret: EncryptedTotpSecret;
        attempts: number; is_expired: boolean; completed: boolean;
      }>(
        `SELECT e.id, e.grant_id, e.account_id, a.email, e.encrypted_secret, e.attempts,
                e.expires_at <= now() AS is_expired, c.recovery_completed_at IS NOT NULL AS completed
           FROM account_recovery_enrollments e
           JOIN account_recovery_grants g ON g.id = e.grant_id
           JOIN account_recovery_cases c ON c.id = g.case_id AND c.account_id = e.account_id
           JOIN accounts a ON a.id = e.account_id
          WHERE e.cookie_digest = $1 AND e.csrf_digest = $2 AND e.consumed_at IS NULL
            AND g.consumed_at IS NOT NULL AND c.review_decision = 'approved'
            AND a.email_verified_at IS NOT NULL AND a.deleted_at IS NULL
          FOR UPDATE OF e, c, a`, [sha256(cookieToken), sha256(csrfToken)],
      );
      const enrollment = enrollmentResult.rows[0];
      if (!enrollment || enrollment.is_expired || enrollment.attempts >= 5 || enrollment.completed) {
        if (enrollment && (enrollment.is_expired || enrollment.attempts >= 5)) await client.query("UPDATE account_recovery_enrollments SET consumed_at = now() WHERE id = $1", [enrollment.id]);
        await client.query("COMMIT");
        return null;
      }
      const secret = decryptTotpSecret(enrollment.encrypted_secret, this.totpKey, enrollment.account_id);
      const counter = matchingTotpCounter(secret, code, Date.now());
      if (counter === null) {
        await client.query(
          `UPDATE account_recovery_enrollments SET attempts = $2::smallint,
             expires_at = CASE WHEN $2::smallint >= 5 THEN now() ELSE expires_at END WHERE id = $1`,
          [enrollment.id, enrollment.attempts + 1],
        );
        await client.query("COMMIT");
        return null;
      }

      const codes = createRecoveryCodes();
      const digests = codes.map((recoveryCode) => recoveryCodeDigest(recoveryCode, enrollment.account_id, this.recoveryPepper));
      await client.query("DELETE FROM account_totp_factors WHERE account_id = $1", [enrollment.account_id]);
      await client.query("DELETE FROM account_recovery_codes WHERE account_id = $1", [enrollment.account_id]);
      await client.query("DELETE FROM account_passkeys WHERE account_id = $1", [enrollment.account_id]);
      await client.query("DELETE FROM account_totp_enrollments WHERE account_id = $1", [enrollment.account_id]);
      await client.query("DELETE FROM passkey_management_tickets WHERE account_id = $1", [enrollment.account_id]);
      await client.query("DELETE FROM passkey_management_sessions WHERE account_id = $1", [enrollment.account_id]);
      await client.query(
        `INSERT INTO account_totp_factors (account_id, encrypted_secret, last_used_counter, enabled_at)
         VALUES ($1, $2, $3, now())`, [enrollment.account_id, enrollment.encrypted_secret, counter],
      );
      for (const digest of digests) {
        await client.query("INSERT INTO account_recovery_codes (account_id, verifier_digest, is_active) VALUES ($1, $2, true)", [enrollment.account_id, digest]);
      }
      await client.query("UPDATE account_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL", [enrollment.account_id]);
      const codesResult = await client.query<{ flow_id: string }>(
        `UPDATE native_authorization_codes SET consumed_at = now()
          WHERE account_id = $1 AND consumed_at IS NULL RETURNING flow_id`, [enrollment.account_id],
      );
      const flowIds = codesResult.rows.map(({ flow_id }) => flow_id);
      await client.query(
        `UPDATE native_auth_flows SET consumed_at = now()
          WHERE mfa_account_id = $1 OR id = ANY($2::uuid[])`, [enrollment.account_id, flowIds],
      );
      await client.query("UPDATE account_recovery_enrollments SET consumed_at = now() WHERE id = $1", [enrollment.id]);
      await client.query("UPDATE account_recovery_cases SET recovery_completed_at = now() WHERE id = (SELECT case_id FROM account_recovery_grants WHERE id = $1)", [enrollment.grant_id]);
      await client.query(
        `INSERT INTO account_security_email_outbox (account_id, recipient_email, event_type)
         VALUES ($1, $2, 'account_recovered')`, [enrollment.account_id, enrollment.email],
      );
      await client.query("COMMIT");
      return codes;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
