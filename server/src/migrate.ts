import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readConfig } from "./config.js";

const config = readConfig(process.env);
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(1768848492)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const migration of ["001_initial.sql", "002_email_verification.sql"]) {
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
} finally {
  client.release();
  await pool.end();
}
