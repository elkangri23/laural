import pg from "pg";
import { createApp } from "./app.js";
import { createAccountSessionLister, createAccountSessionRevoker, createOtherSessionsRevoker, createSessionAuthenticator, createSessionRevoker } from "./auth.js";
import { AccountMfaService } from "./account-mfa.js";
import { readConfig, readEmailAuthConfig } from "./config.js";
import { EmailAuthService } from "./email-auth.js";
import { PostgresEmailAuthStore } from "./postgres-email-auth-store.js";
import { NativeAuthService } from "./native-auth.js";
import { PostgresNativeAuthStore } from "./postgres-native-auth-store.js";
import { PostgresPreferenceStore } from "./postgres-store.js";
import { PostgresRequestRateLimiter } from "./request-rate-limit.js";
import { cleanupExpiredRecords, RETENTION_INTERVAL_MS } from "./retention.js";
import { ResendMailer } from "./resend-mailer.js";
import { deliverSecurityEmailBatch } from "./security-email-outbox.js";

const config = readConfig(process.env);
const emailAuthConfig = readEmailAuthConfig(process.env);
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
const preferenceStore = new PostgresPreferenceStore(pool);
const resendMailer = emailAuthConfig
  ? new ResendMailer({ apiKey: emailAuthConfig.resendApiKey, from: emailAuthConfig.resendFrom })
  : undefined;
const emailAuth = emailAuthConfig && resendMailer
  ? new EmailAuthService(
    new PostgresEmailAuthStore(pool),
    resendMailer,
    emailAuthConfig.pinPepper,
  )
  : undefined;
const accountMfa = emailAuthConfig
  ? new AccountMfaService(pool, emailAuthConfig.totpEncryptionKey, emailAuthConfig.recoveryPepper)
  : undefined;
const nativeAuth = emailAuthConfig && accountMfa
  ? new NativeAuthService(new PostgresNativeAuthStore(pool), accountMfa)
  : undefined;
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
  ...(accountMfa ? { accountMfa } : {}),
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

let deliveringSecurityEmails = false;
async function runSecurityEmailDelivery(): Promise<void> {
  if (!resendMailer || deliveringSecurityEmails) return;
  deliveringSecurityEmails = true;
  try {
    const result = await deliverSecurityEmailBatch(pool, resendMailer);
    if (result.deferred > 0) console.error("Uno o varios avisos de seguridad de correo quedaron pendientes de reintento.");
  } catch {
    console.error("Falló el procesamiento de avisos de seguridad de correo.");
  } finally {
    deliveringSecurityEmails = false;
  }
}

void runSecurityEmailDelivery();
const securityEmailTimer = setInterval(() => { void runSecurityEmailDelivery(); }, 15_000);
securityEmailTimer.unref();

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(retentionTimer);
  clearInterval(securityEmailTimer);
  await app.close();
  await pool.end();
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
