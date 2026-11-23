import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

export const MIGRATION_FILES = [
  "001_initial.sql",
  "002_email_verification.sql",
  "003_native_auth.sql",
  "004_request_rate_limits.sql",
  "005_password_reset.sql",
  "006_account_mfa.sql",
  "007_security_email_outbox.sql",
  "008_account_passkeys.sql",
  "009_passkey_security_notices.sql",
  "010_preference_snapshot_history.sql",
  "011_google_oauth.sql",
  "012_account_recovery.sql",
] as const;

export async function applyMigrations(client: PoolClient): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(1768848492)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");

    for (const migration of MIGRATION_FILES) {
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [migration]);
      if (applied.rowCount === 0) {
        const path = fileURLToPath(new URL(`../migrations/${migration}`, import.meta.url));
        await client.query(await readFile(path, "utf8"));
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
