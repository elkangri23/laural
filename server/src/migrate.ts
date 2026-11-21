import pg from "pg";
import { readConfig } from "./config.js";
import { applyMigrations } from "./migration-runner.js";

const config = readConfig(process.env);
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
const client = await pool.connect();
try {
  await applyMigrations(client);
} finally {
  client.release();
  await pool.end();
}
