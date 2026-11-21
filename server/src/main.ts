import pg from "pg";
import { createApp } from "./app.js";
import { createSessionAuthenticator } from "./auth.js";
import { readConfig, readEmailAuthConfig } from "./config.js";
import { EmailAuthService } from "./email-auth.js";
import { PostgresEmailAuthStore } from "./postgres-email-auth-store.js";
import { PostgresPreferenceStore } from "./postgres-store.js";
import { ResendMailer } from "./resend-mailer.js";

const config = readConfig(process.env);
const emailAuthConfig = readEmailAuthConfig(process.env);
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
const preferenceStore = new PostgresPreferenceStore(pool);
const emailAuth = emailAuthConfig
  ? new EmailAuthService(
    new PostgresEmailAuthStore(pool),
    new ResendMailer({ apiKey: emailAuthConfig.resendApiKey, from: emailAuthConfig.resendFrom }),
    emailAuthConfig.pinPepper,
  )
  : undefined;
const app = createApp({
  store: preferenceStore,
  authenticate: createSessionAuthenticator(pool),
  checkReadiness: async () => { await pool.query("SELECT 1"); },
  ...(emailAuth ? { emailAuth } : {}),
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
