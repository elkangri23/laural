import pg from "pg";
import { createApp } from "./app.js";
import { createAccountSessionLister, createAccountSessionRevoker, createOtherSessionsRevoker, createSessionAuthenticator, createSessionRevoker } from "./auth.js";
import { readConfig, readEmailAuthConfig } from "./config.js";
import { EmailAuthService } from "./email-auth.js";
import { PostgresEmailAuthStore } from "./postgres-email-auth-store.js";
import { NativeAuthService } from "./native-auth.js";
import { PostgresNativeAuthStore } from "./postgres-native-auth-store.js";
import { PostgresPreferenceStore } from "./postgres-store.js";
import { PostgresRequestRateLimiter } from "./request-rate-limit.js";
import { cleanupExpiredRecords, RETENTION_INTERVAL_MS } from "./retention.js";
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
const nativeAuth = emailAuthConfig ? new NativeAuthService(new PostgresNativeAuthStore(pool)) : undefined;
const app = createApp({
  store: preferenceStore,
  authenticate: createSessionAuthenticator(pool),
  revokeSession: createSessionRevoker(pool),
  listAccountSessions: createAccountSessionLister(pool),
  revokeAccountSession: createAccountSessionRevoker(pool),
  revokeOtherSessions: createOtherSessionsRevoker(pool),
  checkReadiness: async () => { await pool.query("SELECT 1"); },
  requestRateLimiter: new PostgresRequestRateLimiter(pool, config.rateLimitPepper),
  ...(emailAuth ? { emailAuth } : {}),
  ...(nativeAuth ? { nativeAuth } : {}),
});

await app.listen({ host: config.host, port: config.port });

function runRetentionCleanup(): void {
  void cleanupExpiredRecords(pool).catch(() => {
    console.error("Falló la limpieza periódica de retención del servicio sync.");
  });
}

runRetentionCleanup();
const retentionTimer = setInterval(runRetentionCleanup, RETENTION_INTERVAL_MS);
retentionTimer.unref();

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(retentionTimer);
  await app.close();
  await pool.end();
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
