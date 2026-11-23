import type { Pool } from "pg";

const RETENTION_POLICIES = [
  "DELETE FROM email_verification_codes WHERE created_at < now() - interval '15 minutes'",
  "DELETE FROM account_password_reset_codes WHERE created_at < now() - interval '15 minutes'",
  "DELETE FROM native_authorization_codes WHERE created_at < now() - interval '24 hours'",
  "DELETE FROM google_oauth_transactions WHERE expires_at <= now() OR created_at < now() - interval '24 hours'",
  "DELETE FROM native_auth_flows WHERE created_at < now() - interval '24 hours'",
  "DELETE FROM passkey_management_tickets WHERE expires_at <= now() OR consumed_at IS NOT NULL",
  "DELETE FROM passkey_management_sessions WHERE expires_at <= now()",
  "DELETE FROM passkey_management_challenges WHERE expires_at <= now() OR consumed_at IS NOT NULL",
  "DELETE FROM passkey_login_challenges WHERE expires_at <= now() OR consumed_at IS NOT NULL",
  "DELETE FROM account_sessions WHERE expires_at <= now() OR revoked_at IS NOT NULL",
  "DELETE FROM preference_idempotency WHERE created_at < now() - interval '30 days'",
  "DELETE FROM account_security_email_outbox WHERE created_at < now() - interval '30 days' AND (delivered_at IS NOT NULL OR abandoned_at IS NOT NULL)",
  "DELETE FROM account_recovery_notice_outbox WHERE created_at < now() - interval '30 days' AND (delivered_at IS NOT NULL OR abandoned_at IS NOT NULL)",
  "DELETE FROM account_recovery_cases WHERE (consumed_at IS NOT NULL AND created_at < now() - interval '90 days') OR (consumed_at IS NULL AND expires_at < now() - interval '15 minutes')",
] as const;

export async function cleanupExpiredRecords(pool: Pick<Pool, "connect">): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of RETENTION_POLICIES) await client.query(statement);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const RETENTION_INTERVAL_MS = 60 * 60 * 1000;
