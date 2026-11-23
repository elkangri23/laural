import pg from "pg";
import { createApp } from "./app.js";
import { createAccountSessionLister, createAccountSessionRevoker, createOtherSessionsRevoker, createSessionAuthenticator, createSessionRevoker } from "./auth.js";
import { AccountMfaService } from "./account-mfa.js";
import { AccountDeletionService } from "./account-deletion.js";
import { readConfig, readEmailAuthConfig, readGoogleOAuthConfig, readPasskeyConfig } from "./config.js";
import { EmailAuthService } from "./email-auth.js";
import { PostgresEmailAuthStore } from "./postgres-email-auth-store.js";
import { NativeAuthService } from "./native-auth.js";
import { PostgresNativeAuthStore } from "./postgres-native-auth-store.js";
import { PostgresPreferenceStore } from "./postgres-store.js";
import { PostgresRequestRateLimiter } from "./request-rate-limit.js";
import { AccountPasskeyService } from "./account-passkeys.js";
import { cleanupExpiredRecords, RETENTION_INTERVAL_MS } from "./retention.js";
import { ResendMailer } from "./resend-mailer.js";
import { deliverSecurityEmailBatch } from "./security-email-outbox.js";
import { GoogleOAuthService } from "./google-oauth.js";
import { deliverAccountRecoveryNoticeBatch } from "./account-recovery-outbox.js";
import { AccountRecoveryService } from "./account-recovery.js";
import { deliverAccountRecoveryGrantBatch } from "./account-recovery-grant-outbox.js";

const config = readConfig(process.env);
const emailAuthConfig = readEmailAuthConfig(process.env);
const passkeyConfig = readPasskeyConfig(process.env, emailAuthConfig !== null);
const googleOAuthConfig = readGoogleOAuthConfig(process.env, emailAuthConfig !== null);
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
const preferenceStore = new PostgresPreferenceStore(pool);
const resendMailer = emailAuthConfig
  ? new ResendMailer({ apiKey: emailAuthConfig.resendApiKey, from: emailAuthConfig.resendFrom,
    ...(emailAuthConfig.recoveryAdminEmail ? { recoveryAdminEmail: emailAuthConfig.recoveryAdminEmail } : {}),
    ...(emailAuthConfig.recoveryBaseUrl ? { recoveryBaseUrl: emailAuthConfig.recoveryBaseUrl } : {}) })
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
const accountPasskeys = passkeyConfig ? new AccountPasskeyService(pool, passkeyConfig) : undefined;
const googleOAuth = googleOAuthConfig ? new GoogleOAuthService(pool, googleOAuthConfig) : undefined;
const accountRecovery = emailAuthConfig?.recoveryAdminEmail && emailAuthConfig.recoveryBaseUrl
  ? new AccountRecoveryService(pool, emailAuthConfig.totpEncryptionKey, emailAuthConfig.recoveryPepper)
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
  ...(accountPasskeys ? { accountPasskeys } : {}),
  ...(googleOAuth ? { googleOAuth } : {}),
  accountRecoveryEnabled: Boolean(emailAuthConfig?.recoveryAdminEmail),
  ...(accountRecovery ? { accountRecovery } : {}),
  accountDeletion: new AccountDeletionService(pool),
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

let deliveringRecoveryNotices = false;
async function runRecoveryNoticeDelivery(): Promise<void> {
  if (!resendMailer || !emailAuthConfig?.recoveryAdminEmail || deliveringRecoveryNotices) return;
  deliveringRecoveryNotices = true;
  try {
    const result = await deliverAccountRecoveryNoticeBatch(pool, resendMailer);
    if (result.deferred > 0) console.error("Uno o varios avisos de recuperación quedaron pendientes de reintento.");
  } catch {
    console.error("Falló el procesamiento de avisos administrativos de recuperación.");
  } finally { deliveringRecoveryNotices = false; }
}

void runRecoveryNoticeDelivery();
const recoveryNoticeTimer = setInterval(() => { void runRecoveryNoticeDelivery(); }, 15_000);
recoveryNoticeTimer.unref();

let deliveringRecoveryGrants = false;
async function runRecoveryGrantDelivery(): Promise<void> {
  if (!resendMailer || !emailAuthConfig?.recoveryAdminEmail || !emailAuthConfig.recoveryBaseUrl || deliveringRecoveryGrants) return;
  deliveringRecoveryGrants = true;
  try {
    const result = await deliverAccountRecoveryGrantBatch(pool, resendMailer, emailAuthConfig.recoveryPepper);
    if (result.deferred > 0) console.error("Uno o varios enlaces de recuperación quedaron pendientes de reintento.");
  } catch {
    console.error("Falló el procesamiento de enlaces de recuperación.");
  } finally { deliveringRecoveryGrants = false; }
}

void runRecoveryGrantDelivery();
const recoveryGrantTimer = setInterval(() => { void runRecoveryGrantDelivery(); }, 15_000);
recoveryGrantTimer.unref();

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(retentionTimer);
  clearInterval(securityEmailTimer);
  clearInterval(recoveryNoticeTimer);
  clearInterval(recoveryGrantTimer);
  await app.close();
  await pool.end();
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
