import pg from "pg";
import { createApp } from "./app.js";
import { createSessionAuthenticator } from "./auth.js";
import { readConfig } from "./config.js";
import { PostgresPreferenceStore } from "./postgres-store.js";

const config = readConfig(process.env);
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
const app = createApp({
  store: new PostgresPreferenceStore(pool),
  authenticate: createSessionAuthenticator(pool),
  checkReadiness: async () => { await pool.query("SELECT 1"); },
});

await app.listen({ host: config.host, port: config.port });

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await app.close();
  await pool.end();
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
