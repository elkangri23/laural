import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg, { type Pool } from "pg";
import { createApp } from "../src/app.js";
import { AccountDeletionService } from "../src/account-deletion.js";
import { createAccountSessionLister, createAccountSessionRevoker, createOtherSessionsRevoker, createSessionAuthenticator, createSessionRevoker } from "../src/auth.js";
import { AccountMfaService } from "../src/account-mfa.js";
import { EmailAuthService } from "../src/email-auth.js";
import { applyMigrations, MIGRATION_FILES } from "../src/migration-runner.js";
import { NativeAuthService } from "../src/native-auth.js";
import { PostgresEmailAuthStore } from "../src/postgres-email-auth-store.js";
import { PostgresNativeAuthStore } from "../src/postgres-native-auth-store.js";
import { PostgresPreferenceStore } from "../src/postgres-store.js";
import { PostgresRequestRateLimiter } from "../src/request-rate-limit.js";
import { cleanupExpiredRecords } from "../src/retention.js";
import { deliverSecurityEmailBatch } from "../src/security-email-outbox.js";
import { totpCode } from "../src/totp.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const schema = `laural_it_${randomUUID().replaceAll("-", "")}`;

describePostgres("integración real de PostgreSQL para rate limits", () => {
  let adminPool: Pool;
  let isolatedPool: Pool;

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    isolatedPool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    const client = await isolatedPool.connect();
    try {
      await applyMigrations(client);
      await applyMigrations(client);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await isolatedPool?.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  });

  it("aplica migraciones idempotentes y comparte límites atómicos entre instancias", async () => {
    const applied = await isolatedPool.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version");
    expect(applied.rows.map(({ version }) => version)).toEqual([...MIGRATION_FILES]);
    const firstInstance = new PostgresRequestRateLimiter(isolatedPool, "integracion-rate-limit-pepper-32-bytes-minimo");
    const secondInstance = new PostgresRequestRateLimiter(isolatedPool, "integracion-rate-limit-pepper-32-bytes-minimo");
    const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      (index % 2 === 0 ? firstInstance : secondInstance).consume("native-login", "203.0.113.42", 4, 60)));

    expect(attempts.filter(Boolean)).toHaveLength(4);
    expect(attempts.filter((allowed) => !allowed)).toHaveLength(8);
    expect(await firstInstance.consume("native-register", "203.0.113.42", 4, 60)).toBe(true);
    expect(await firstInstance.consume("native-login", "203.0.113.43", 4, 60)).toBe(true);

    await isolatedPool.query(
      "UPDATE request_rate_limits SET window_started_at = now() - interval '2 minutes' WHERE scope = $1",
      ["native-login"],
    );
    expect(await secondInstance.consume("native-login", "203.0.113.42", 4, 60)).toBe(true);
    const stored = await isolatedPool.query<{ key_digest: string; request_count: number }>(
      "SELECT key_digest, request_count FROM request_rate_limits WHERE scope = $1 ORDER BY key_digest",
      ["native-login"],
    );
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.every(({ key_digest }) => /^[a-f0-9]{64}$/.test(key_digest))).toBe(true);
    expect(stored.rows.every(({ request_count }) => request_count >= 1)).toBe(true);
  });

  it("purga como máximo 1.000 contadores expirados por lote", async () => {
    await isolatedPool.query(
      `INSERT INTO request_rate_limits (scope, key_digest, window_started_at, request_count)
       SELECT 'purge-integration', lpad(to_hex(value), 64, '0'), now() - interval '25 hours', 1
       FROM generate_series(1, 1001) AS generated(value)`,
    );
    const limiter = new PostgresRequestRateLimiter(isolatedPool, "integracion-rate-limit-pepper-32-bytes-minimo");

    for (let index = 0; index < 512; index += 1) {
      await limiter.consume("purge-integration", "203.0.113.99", 1000, 3600);
    }

    await vi.waitFor(async () => {
      const remaining = await isolatedPool.query<{ expired: string; total: string }>(
        `SELECT count(*) FILTER (WHERE window_started_at < now() - interval '24 hours') AS expired,
                count(*) AS total
         FROM request_rate_limits WHERE scope = 'purge-integration'`,
      );
      expect(remaining.rows[0]).toEqual({ expired: "1", total: "2" });
    });
  });

  it("reintenta avisos de seguridad pendientes y usa una entrega idempotente", async () => {
    const accountId = randomUUID();
    await isolatedPool.query(
      "INSERT INTO accounts (id, email, display_name, email_verified_at) VALUES ($1, $2, 'Avisos', now())",
      [accountId, `${accountId}@example.test`],
    );
    await isolatedPool.query(
      "INSERT INTO account_security_email_outbox (account_id, recipient_email, event_type) VALUES ($1, $2, 'totp_enabled')",
      [accountId, `${accountId}@example.test`],
    );
    let attempts = 0;
    const sender = {
      sendSecurityNotice: async (input: { email: string; eventType: string; notificationId: string }) => {
        attempts += 1;
        expect(input).toMatchObject({ email: `${accountId}@example.test`, eventType: "totp_enabled" });
        expect(input.notificationId).toMatch(/^[0-9a-f-]{36}$/);
        if (attempts === 1) throw new Error("simulated temporary provider failure");
      },
    };

    await expect(deliverSecurityEmailBatch(isolatedPool, sender)).resolves.toEqual({ delivered: 0, deferred: 1 });
    const waiting = await isolatedPool.query<{ attempts: number; claimed_at: Date | null; delivered_at: Date | null }>(
      "SELECT attempts, claimed_at, delivered_at FROM account_security_email_outbox WHERE account_id = $1",
      [accountId],
    );
    expect(waiting.rows[0]).toMatchObject({ attempts: 1, claimed_at: null, delivered_at: null });
    await isolatedPool.query("UPDATE account_security_email_outbox SET available_at = now() WHERE account_id = $1", [accountId]);

    await expect(deliverSecurityEmailBatch(isolatedPool, sender)).resolves.toEqual({ delivered: 1, deferred: 0 });
    const delivered = await isolatedPool.query<{ attempts: number; delivered_at: Date | null; abandoned_at: Date | null }>(
      "SELECT attempts, delivered_at, abandoned_at FROM account_security_email_outbox WHERE account_id = $1",
      [accountId],
    );
    expect(delivered.rows[0]).toMatchObject({ attempts: 2, abandoned_at: null });
    expect(delivered.rows[0]?.delivered_at).toBeInstanceOf(Date);

    await isolatedPool.query(
      "INSERT INTO account_security_email_outbox (account_id, recipient_email, event_type) VALUES ($1, $2, 'totp_disabled')",
      [accountId, `${accountId}@example.test`],
    );
    const failingSender = { sendSecurityNotice: async () => { throw new Error("simulated persistent provider failure"); } };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await deliverSecurityEmailBatch(isolatedPool, failingSender);
      expect(result).toEqual({ delivered: 0, deferred: 1 });
      await isolatedPool.query(
        "UPDATE account_security_email_outbox SET available_at = now() WHERE account_id = $1 AND event_type = 'totp_disabled'",
        [accountId],
      );
    }
    const abandoned = await isolatedPool.query<{ attempts: number; abandoned_at: Date | null }>(
      "SELECT attempts, abandoned_at FROM account_security_email_outbox WHERE account_id = $1 AND event_type = 'totp_disabled'",
      [accountId],
    );
    expect(abandoned.rows[0]?.attempts).toBe(8);
    expect(abandoned.rows[0]?.abandoned_at).toBeInstanceOf(Date);
    await expect(deliverSecurityEmailBatch(isolatedPool, failingSender)).resolves.toEqual({ delivered: 0, deferred: 0 });
  });

  it("acepta y entrega notificaciones de alta y baja de passkeys por la cola común", async () => {
    const accountId = randomUUID();
    const email = `${accountId}@example.test`;
    await isolatedPool.query(
      "INSERT INTO accounts (id, email, display_name, email_verified_at) VALUES ($1, $2, 'Passkeys', now())",
      [accountId, email],
    );
    await isolatedPool.query(
      `INSERT INTO account_security_email_outbox (account_id, recipient_email, event_type)
       VALUES ($1, $2, 'passkey_added'), ($1, $2, 'passkey_removed')`,
      [accountId, email],
    );
    const events: string[] = [];
    const sender = { sendSecurityNotice: async (input: { email: string; eventType: string }) => {
      expect(input.email).toBe(email);
      events.push(input.eventType);
    } };

    await expect(deliverSecurityEmailBatch(isolatedPool, sender)).resolves.toEqual({ delivered: 2, deferred: 0 });
    expect(events.sort()).toEqual(["passkey_added", "passkey_removed"]);
    const rows = await isolatedPool.query<{ event_type: string; delivered_at: Date | null }>(
      "SELECT event_type, delivered_at FROM account_security_email_outbox WHERE account_id = $1 ORDER BY event_type",
      [accountId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((row) => row.delivered_at instanceof Date)).toBe(true);
  });

  it("exige login reciente y borra en cascada solo la cuenta confirmada", async () => {
    const accountId = randomUUID();
    const otherAccountId = randomUUID();
    const email = `${accountId}@example.test`;
    const token = randomBytes(32).toString("base64url");
    await isolatedPool.query(
      `INSERT INTO accounts (id, email, display_name, email_verified_at)
       VALUES ($1, $2, 'Cuenta a borrar', now()), ($3, $4, 'Cuenta vecina', now())`,
      [accountId, email, otherAccountId, `${otherAccountId}@example.test`],
    );
    await isolatedPool.query(
      `INSERT INTO account_sessions (account_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, now() + interval '30 days', now() - interval '11 minutes')`,
      [accountId, createHash("sha256").update(token).digest("hex")],
    );
    const snapshot = { schemaVersion: 1, preferences: { themeId: "ocean", appearance: "dark", updateMode: "manual" }, activeProviderId: null, providers: [] };
    await isolatedPool.query("INSERT INTO account_preferences (account_id, snapshot, revision) VALUES ($1, $2::jsonb, 1)", [accountId, JSON.stringify(snapshot)]);
    await isolatedPool.query(
      "INSERT INTO preference_idempotency (account_id, idempotency_key, payload_digest, snapshot, revision) VALUES ($1, 'delete-test-key', repeat('a', 64), $2::jsonb, 1)",
      [accountId, JSON.stringify(snapshot)],
    );
    await isolatedPool.query("INSERT INTO account_totp_factors (account_id, encrypted_secret, enabled_at) VALUES ($1, '{}'::jsonb, now())", [accountId]);
    await isolatedPool.query("INSERT INTO account_recovery_codes (account_id, verifier_digest) VALUES ($1, repeat('b', 64))", [accountId]);
    await isolatedPool.query("INSERT INTO account_security_email_outbox (account_id, recipient_email, event_type) VALUES ($1, $2, 'totp_enabled')", [accountId, email]);
    const app = createApp({
      store: new PostgresPreferenceStore(isolatedPool),
      authenticate: createSessionAuthenticator(isolatedPool),
      revokeSession: createSessionRevoker(isolatedPool),
      listAccountSessions: createAccountSessionLister(isolatedPool),
      revokeAccountSession: createAccountSessionRevoker(isolatedPool),
      revokeOtherSessions: createOtherSessionsRevoker(isolatedPool),
      checkReadiness: async () => { await isolatedPool.query("SELECT 1"); },
      requestRateLimiter: new PostgresRequestRateLimiter(isolatedPool, "integracion-rate-limit-pepper-32-bytes-minimo"),
      accountDeletion: new AccountDeletionService(isolatedPool),
    });
    const headers = { authorization: `Bearer ${token}` };

    try {
      const stale = await app.inject({ method: "DELETE", url: "/v1/auth/account", headers, payload: { confirmation: "ELIMINAR" } });
      expect(stale.statusCode).toBe(403);
      expect(stale.json()).toEqual({ error: "recent_auth_required" });
      expect((await isolatedPool.query("SELECT id FROM accounts WHERE id = $1", [accountId])).rowCount).toBe(1);

      await isolatedPool.query("UPDATE account_sessions SET created_at = now() WHERE account_id = $1", [accountId]);
      const deleted = await app.inject({ method: "DELETE", url: "/v1/auth/account", headers, payload: { confirmation: "ELIMINAR" } });
      expect(deleted.statusCode).toBe(204);
      const [account, sessions, prefs, idempotency, factors, codes, outbox, neighbor] = await Promise.all([
        isolatedPool.query("SELECT id FROM accounts WHERE id = $1", [accountId]),
        isolatedPool.query("SELECT id FROM account_sessions WHERE account_id = $1", [accountId]),
        isolatedPool.query("SELECT account_id FROM account_preferences WHERE account_id = $1", [accountId]),
        isolatedPool.query("SELECT account_id FROM preference_idempotency WHERE account_id = $1", [accountId]),
        isolatedPool.query("SELECT account_id FROM account_totp_factors WHERE account_id = $1", [accountId]),
        isolatedPool.query("SELECT account_id FROM account_recovery_codes WHERE account_id = $1", [accountId]),
        isolatedPool.query("SELECT account_id FROM account_security_email_outbox WHERE account_id = $1", [accountId]),
        isolatedPool.query("SELECT id FROM accounts WHERE id = $1", [otherAccountId]),
      ]);
      expect([account, sessions, prefs, idempotency, factors, codes, outbox].map(({ rowCount }) => rowCount)).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(neighbor.rowCount).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("limpia registros caducados y conserva los que aún están dentro de su retención", async () => {
    const accountId = randomUUID();
    const expiredFlow = randomUUID();
    const activeFlow = randomUUID();
    await isolatedPool.query(
      "INSERT INTO accounts (id, email, display_name, email_verified_at) VALUES ($1, $2, 'Retención', now())",
      [accountId, `${accountId}@example.test`],
    );
    await isolatedPool.query(
      `INSERT INTO email_verification_codes (account_id, verifier_digest, expires_at, created_at)
       VALUES ($1, repeat('a', 64), now() - interval '20 minutes', now() - interval '20 minutes'),
              ($1, repeat('b', 64), now() + interval '4 minutes', now() - interval '1 minute')`,
      [accountId],
    );
    await isolatedPool.query(
      `INSERT INTO native_auth_flows
         (id, cookie_digest, csrf_digest, redirect_uri, state, code_challenge, expires_at, created_at)
       VALUES ($1, repeat('c', 64), repeat('d', 64), 'http://127.0.0.1:49152/callback', repeat('s', 43), repeat('e', 43), now() - interval '24 hours', now() - interval '25 hours'),
              ($2, repeat('f', 64), repeat('0', 64), 'http://127.0.0.1:49152/callback', repeat('t', 43), repeat('1', 43), now() + interval '10 minutes', now())`,
      [expiredFlow, activeFlow],
    );
    await isolatedPool.query(
      `INSERT INTO native_authorization_codes (code_digest, flow_id, account_id, code_challenge, expires_at, created_at)
       VALUES (repeat('2', 64), $1, $2, repeat('e', 43), now() - interval '24 hours', now() - interval '25 hours')`,
      [expiredFlow, accountId],
    );
    await isolatedPool.query(
      `INSERT INTO account_sessions (account_id, token_hash, expires_at, revoked_at)
       VALUES ($1, repeat('3', 64), now() - interval '1 minute', NULL),
              ($1, repeat('4', 64), now() + interval '1 day', now()),
              ($1, repeat('5', 64), now() + interval '1 day', NULL)`,
      [accountId],
    );
    await isolatedPool.query(
      `INSERT INTO preference_idempotency (account_id, idempotency_key, payload_digest, snapshot, revision, created_at)
       VALUES ($1, 'expired-retention-key', repeat('6', 64), '{}'::jsonb, 1, now() - interval '31 days'),
              ($1, 'fresh-retention-key', repeat('7', 64), '{}'::jsonb, 2, now())`,
      [accountId],
    );
    await isolatedPool.query(
      `INSERT INTO account_security_email_outbox
         (account_id, recipient_email, event_type, attempts, created_at, delivered_at, abandoned_at)
       VALUES ($1, $2, 'totp_enabled', 1, now() - interval '31 days', now() - interval '31 days', NULL),
              ($1, $2, 'totp_disabled', 8, now() - interval '31 days', NULL, now() - interval '31 days'),
              ($1, $2, 'totp_enabled', 1, now(), now(), NULL),
              ($1, $2, 'recovery_codes_rotated', 0, now() - interval '31 days', NULL, NULL)`,
      [accountId, `${accountId}@example.test`],
    );

    await cleanupExpiredRecords(isolatedPool);

    const [emailCodes, authFlows, authCodes, sessions, idempotency, securityEmails] = await Promise.all([
      isolatedPool.query("SELECT id FROM email_verification_codes WHERE account_id = $1", [accountId]),
      isolatedPool.query("SELECT id FROM native_auth_flows WHERE id = ANY($1::uuid[])", [[expiredFlow, activeFlow]]),
      isolatedPool.query("SELECT id FROM native_authorization_codes WHERE account_id = $1", [accountId]),
      isolatedPool.query("SELECT id FROM account_sessions WHERE account_id = $1", [accountId]),
      isolatedPool.query("SELECT idempotency_key FROM preference_idempotency WHERE account_id = $1 ORDER BY idempotency_key", [accountId]),
      isolatedPool.query<{ event_type: string; delivered_at: Date | null; abandoned_at: Date | null }>(
        "SELECT event_type, delivered_at, abandoned_at FROM account_security_email_outbox WHERE account_id = $1",
        [accountId],
      ),
    ]);
    expect(emailCodes.rows).toHaveLength(1);
    expect(authFlows.rows.map(({ id }) => id)).toEqual([activeFlow]);
    expect(authCodes.rows).toHaveLength(0);
    expect(sessions.rows).toHaveLength(1);
    expect(idempotency.rows.map(({ idempotency_key }) => idempotency_key)).toEqual(["fresh-retention-key"]);
    expect(securityEmails.rows).toHaveLength(2);
    expect(securityEmails.rows.filter(({ delivered_at, abandoned_at }) => delivered_at || abandoned_at)).toHaveLength(1);
  });

  it("sirve snapshots reales de PostgreSQL con aislamiento, revisión e idempotencia", async () => {
    const firstAccount = randomUUID();
    const secondAccount = randomUUID();
    await isolatedPool.query(
      `INSERT INTO accounts (id, email, display_name, email_verified_at)
       VALUES ($1, $2, 'Primera cuenta', now()), ($3, $4, 'Segunda cuenta', now())`,
      [firstAccount, `${firstAccount}@example.test`, secondAccount, `${secondAccount}@example.test`],
    );

    const app = createApp({
      store: new PostgresPreferenceStore(isolatedPool),
      authenticate: async (header) => header === "Bearer first" ? firstAccount : header === "Bearer second" ? secondAccount : null,
      revokeSession: async () => false,
      checkReadiness: async () => { await isolatedPool.query("SELECT 1"); },
      requestRateLimiter: new PostgresRequestRateLimiter(isolatedPool, "integracion-rate-limit-pepper-32-bytes-minimo"),
    });

    try {
      const headers = { authorization: "Bearer first" };
      expect((await app.inject({ method: "GET", url: "/v1/preferences/current" })).statusCode).toBe(401);

      const empty = await app.inject({ method: "GET", url: "/v1/preferences/current", headers });
      expect(empty.statusCode).toBe(200);
      expect(empty.headers.etag).toBe('"0"');
      expect(empty.json()).toEqual({ snapshot: null, revision: 0 });

      const snapshot = {
        schemaVersion: 1,
        preferences: { themeId: "ocean", appearance: "dark", updateMode: "manual" },
        activeProviderId: null,
        providers: [],
      };
      const writeHeaders = { ...headers, "if-match": '"0"', "idempotency-key": "pg-integration-write-0001" };
      const saved = await app.inject({ method: "PUT", url: "/v1/preferences/current", headers: writeHeaders, payload: snapshot });
      expect(saved.statusCode).toBe(200);
      expect(saved.headers.etag).toBe('"1"');
      expect(saved.json()).toEqual({ snapshot, revision: 1 });

      const replay = await app.inject({ method: "PUT", url: "/v1/preferences/current", headers: writeHeaders, payload: snapshot });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual({ snapshot, revision: 1 });

      const conflict = await app.inject({
        method: "PUT", url: "/v1/preferences/current",
        headers: { ...headers, "if-match": '"0"', "idempotency-key": "pg-integration-write-0002" },
        payload: { ...snapshot, preferences: { ...snapshot.preferences, themeId: "rose" } },
      });
      expect(conflict.statusCode).toBe(412);
      expect(conflict.json()).toEqual({ error: "revision_conflict", revision: 1 });

      const otherAccount = await app.inject({ method: "GET", url: "/v1/preferences/current", headers: { authorization: "Bearer second" } });
      expect(otherAccount.statusCode).toBe(200);
      expect(otherAccount.json()).toEqual({ snapshot: null, revision: 0 });

      const invalid = await app.inject({
        method: "PUT", url: "/v1/preferences/current",
        headers: { ...headers, "if-match": '"1"', "idempotency-key": "pg-integration-write-0003" },
        payload: { ...snapshot, secret: "must-not-be-accepted" },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({ error: "invalid_snapshot" });
    } finally {
      await app.close();
    }
  });

  it("registra, verifica, inicia sesión con PKCE y sincroniza usando almacenes PostgreSQL reales", async () => {
    const email = `${randomUUID()}@example.test`;
    const password = "contraseña segura para integración 2026";
    let deliveredPin = "";
    let deliveredResetPin = "";
    const emailAuth = new EmailAuthService(
      new PostgresEmailAuthStore(isolatedPool),
      {
        sendVerification: async ({ pin }) => { deliveredPin = pin; },
        sendPasswordReset: async ({ pin }) => { deliveredResetPin = pin; },
      },
      "integracion-email-pin-pepper-32-bytes-minimo",
    );
    const app = createApp({
      store: new PostgresPreferenceStore(isolatedPool),
      authenticate: createSessionAuthenticator(isolatedPool),
      revokeSession: createSessionRevoker(isolatedPool),
      listAccountSessions: createAccountSessionLister(isolatedPool),
      revokeAccountSession: createAccountSessionRevoker(isolatedPool),
      revokeOtherSessions: createOtherSessionsRevoker(isolatedPool),
      checkReadiness: async () => { await isolatedPool.query("SELECT 1"); },
      requestRateLimiter: new PostgresRequestRateLimiter(isolatedPool, "integracion-rate-limit-pepper-32-bytes-minimo"),
      emailAuth,
      nativeAuth: new NativeAuthService(new PostgresNativeAuthStore(isolatedPool)),
    });

    async function startNativeFlow(remoteAddress: string) {
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const state = randomBytes(32).toString("base64url");
      const response = await app.inject({
        method: "GET", remoteAddress,
        url: `/auth/native?${new URLSearchParams({
          redirect_uri: "http://127.0.0.1:49152/callback", state,
          code_challenge: challenge, code_challenge_method: "S256",
        })}`,
      });
      return {
        cookie: String(response.headers["set-cookie"]).split(";")[0] ?? "",
        csrf: /name="csrf" value="([^"]+)"/.exec(response.body)?.[1] ?? "",
      };
    }

    try {
      const throttledEmail = `${randomUUID()}@example.test`;
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const remoteAddress = `198.51.100.${attempt + 10}`;
        const flow = await startNativeFlow(remoteAddress);
        const response = await app.inject({
          method: "POST", url: "/auth/native/login", remoteAddress,
          headers: { cookie: flow.cookie, "content-type": "application/x-www-form-urlencoded" },
          payload: new URLSearchParams({
            csrf: flow.csrf, email: ` ${throttledEmail.toUpperCase()} `,
            password: "contraseña errónea de integración 2026",
          }).toString(),
        });
        expect(response.statusCode).toBe(attempt < 10 ? 400 : 429);
        if (attempt === 10) expect(response.headers["retry-after"]).toBe("60");
      }
      const loginLimitDigest = createHmac("sha256", "integracion-rate-limit-pepper-32-bytes-minimo")
        .update("native-login-email")
        .update("\0")
        .update(throttledEmail)
        .digest("hex");
      const storedLoginLimit = await isolatedPool.query<{ key_digest: string; request_count: number }>(
        "SELECT key_digest, request_count FROM request_rate_limits WHERE scope = $1",
        ["native-login-email"],
      );
      expect(storedLoginLimit.rows).toEqual([{ key_digest: loginLimitDigest, request_count: 11 }]);
      expect(JSON.stringify(storedLoginLimit.rows)).not.toContain(throttledEmail);

      const registered = await app.inject({
        method: "POST", url: "/v1/auth/register",
        payload: { displayName: "Cuenta de integración", email, password },
      });
      expect(registered.statusCode).toBe(202);
      expect(deliveredPin).toMatch(/^\d{6}$/);

      const verification = await app.inject({
        method: "POST", url: "/v1/auth/verification/confirm",
        payload: { email, pin: deliveredPin },
      });
      expect(verification.statusCode).toBe(202);
      expect(verification.headers.authorization).toBeUndefined();

      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const state = randomBytes(32).toString("base64url");
      const redirectUri = "http://127.0.0.1:49152/callback";
      const flow = await app.inject({
        method: "GET",
        url: `/auth/native?${new URLSearchParams({ redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: "S256" })}`,
      });
      expect(flow.statusCode).toBe(200);
      const cookie = String(flow.headers["set-cookie"]).split(";")[0];
      const csrf = flow.body.match(/name="csrf" value="([^"]+)"/)?.[1];
      expect(cookie).toContain("__Host-laural-flow=");
      expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const login = await app.inject({
        method: "POST", url: "/auth/native/login",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({ csrf: csrf!, email, password }).toString(),
      });
      expect(login.statusCode).toBe(303);
      const callback = new URL(String(login.headers.location));
      expect(callback.origin + callback.pathname).toBe(redirectUri);
      expect(callback.searchParams.get("state")).toBe(state);
      const code = callback.searchParams.get("code");
      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const exchange = await app.inject({
        method: "POST", url: "/v1/auth/native/exchange",
        payload: { code, codeVerifier: verifier },
      });
      expect(exchange.statusCode).toBe(200);
      const session = exchange.json<{ sessionToken: string; expiresAt: string }>();
      expect(session.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now());

      const sessionRecord = await isolatedPool.query<{ id: string; token_hash: string }>(
        "SELECT id, token_hash FROM account_sessions WHERE token_hash = $1",
        [createHash("sha256").update(session.sessionToken).digest("hex")],
      );
      expect(sessionRecord.rows).toHaveLength(1);
      expect(sessionRecord.rows[0]?.token_hash).not.toBe(session.sessionToken);

      const otherToken = randomBytes(32).toString("base64url");
      const otherTokenHash = createHash("sha256").update(otherToken).digest("hex");
      await isolatedPool.query(
        `INSERT INTO account_sessions (account_id, token_hash, expires_at)
         SELECT account_id, $2, now() + interval '30 days' FROM account_sessions WHERE token_hash = $1`,
        [createHash("sha256").update(session.sessionToken).digest("hex"), otherTokenHash],
      );
      const listedSessions = await app.inject({ method: "GET", url: "/v1/auth/sessions", headers: { authorization: `Bearer ${session.sessionToken}` } });
      expect(listedSessions.statusCode).toBe(200);
      expect(listedSessions.json<{ sessions: { id: string; current: boolean }[] }>().sessions).toHaveLength(2);
      const currentSession = listedSessions.json<{ sessions: { id: string; current: boolean }[] }>().sessions.find(({ current }) => current);
      expect(currentSession).toBeTruthy();
      const currentRevocation = await app.inject({ method: "DELETE", url: `/v1/auth/sessions/${currentSession?.id}`, headers: { authorization: `Bearer ${session.sessionToken}` } });
      expect(currentRevocation.statusCode).toBe(404);
      const otherSession = listedSessions.json<{ sessions: { id: string; current: boolean }[] }>().sessions.find(({ current }) => !current);
      expect(otherSession).toBeTruthy();
      const otherRevoked = await app.inject({ method: "DELETE", url: `/v1/auth/sessions/${otherSession?.id}`, headers: { authorization: `Bearer ${session.sessionToken}` } });
      expect(otherRevoked.statusCode).toBe(204);
      expect((await app.inject({ method: "GET", url: "/v1/preferences/current", headers: { authorization: `Bearer ${otherToken}` } })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/v1/preferences/current", headers: { authorization: `Bearer ${session.sessionToken}` } })).statusCode).toBe(200);

      const extraTokens = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
      const extraHashes = extraTokens.map((token) => createHash("sha256").update(token).digest("hex"));
      await isolatedPool.query(
        `INSERT INTO account_sessions (account_id, token_hash, expires_at)
         SELECT account_sessions.account_id, tokens.token_hash, now() + interval '30 days'
           FROM account_sessions CROSS JOIN unnest($2::text[]) AS tokens(token_hash)
          WHERE account_sessions.token_hash = $1`,
        [createHash("sha256").update(session.sessionToken).digest("hex"), extraHashes],
      );
      const revokedOthers = await app.inject({ method: "POST", url: "/v1/auth/sessions/revoke-others", headers: { authorization: `Bearer ${session.sessionToken}` } });
      expect(revokedOthers.statusCode).toBe(200);
      expect(revokedOthers.json()).toEqual({ revoked: 2 });
      for (const token of extraTokens) {
        expect((await app.inject({ method: "GET", url: "/v1/preferences/current", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
      }
      expect((await app.inject({ method: "GET", url: "/v1/preferences/current", headers: { authorization: `Bearer ${session.sessionToken}` } })).statusCode).toBe(200);

      const initial = await app.inject({
        method: "GET", url: "/v1/preferences/current",
        headers: { authorization: `Bearer ${session.sessionToken}` },
      });
      expect(initial.statusCode).toBe(200);
      expect(initial.json()).toEqual({ snapshot: null, revision: 0 });

      const snapshot = {
        schemaVersion: 1,
        preferences: { themeId: "indigo", appearance: "light", updateMode: "automatic" },
        activeProviderId: null,
        providers: [],
      };
      const saved = await app.inject({
        method: "PUT", url: "/v1/preferences/current",
        headers: { authorization: `Bearer ${session.sessionToken}`, "if-match": '"0"', "idempotency-key": "account-flow-write-0001" },
        payload: snapshot,
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toEqual({ snapshot, revision: 1 });

      const revoked = await app.inject({
        method: "POST", url: "/v1/auth/session/revoke",
        headers: { authorization: `Bearer ${session.sessionToken}` },
      });
      expect(revoked.statusCode).toBe(204);
      const deniedAfterRevoke = await app.inject({
        method: "GET", url: "/v1/preferences/current",
        headers: { authorization: `Bearer ${session.sessionToken}` },
      });
      expect(deniedAfterRevoke.statusCode).toBe(401);
      const revokedRecord = await isolatedPool.query<{ revoked_at: Date | null }>(
        "SELECT revoked_at FROM account_sessions WHERE token_hash = $1",
        [createHash("sha256").update(session.sessionToken).digest("hex")],
      );
      expect(revokedRecord.rows[0]?.revoked_at).toBeTruthy();

      const reusedCode = await app.inject({
        method: "POST", url: "/v1/auth/native/exchange",
        payload: { code, codeVerifier: verifier },
      });
      expect(reusedCode.statusCode).toBe(400);
      expect(reusedCode.json()).toEqual({ error: "invalid_or_expired_code" });

      const activeToken = randomBytes(32).toString("base64url");
      await isolatedPool.query(
        `INSERT INTO account_sessions (account_id, token_hash, expires_at)
         SELECT id, $2, now() + interval '30 days' FROM accounts WHERE email = $1`,
        [email, createHash("sha256").update(activeToken).digest("hex")],
      );
      let resetRequest: Awaited<ReturnType<typeof app.inject>> | undefined;
      for (const [index, value] of [email.toUpperCase(), ` ${email} `, email].entries()) {
        const response = await app.inject({
          method: "POST", url: "/v1/auth/password-reset/request", remoteAddress: `198.51.100.${41 + index}`,
          payload: { email: value },
        });
        expect(response.statusCode).toBe(202);
        if (index === 2) resetRequest = response;
      }
      expect(resetRequest?.json()).toEqual({ status: "accepted" });
      expect(deliveredResetPin).toMatch(/^\d{6}$/);

      const nativeFlow = await app.inject({
        method: "GET",
        url: `/auth/native?${new URLSearchParams({
          redirect_uri: "http://127.0.0.1:49152/callback",
          state: randomBytes(32).toString("base64url"),
          code_challenge: randomBytes(32).toString("base64url"),
          code_challenge_method: "S256",
        })}`,
      });
      const nativeCookie = String(nativeFlow.headers["set-cookie"]).split(";")[0] ?? "";
      const nativeCsrf = /name="csrf" value="([^"]+)"/.exec(nativeFlow.body)?.[1] ?? "";
      const sharedNativeLimit = await app.inject({
        method: "POST", url: "/auth/native/password-reset/request", remoteAddress: "198.51.100.44",
        headers: { cookie: nativeCookie, "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({ csrf: nativeCsrf, email }).toString(),
      });
      expect(sharedNativeLimit.statusCode).toBe(429);
      expect(sharedNativeLimit.headers["retry-after"]).toBe("900");

      const accountLimitDigest = createHmac("sha256", "integracion-rate-limit-pepper-32-bytes-minimo")
        .update("password-reset-request-email")
        .update("\0")
        .update(email)
        .digest("hex");
      const storedAccountLimit = await isolatedPool.query<{ key_digest: string; request_count: number }>(
        "SELECT key_digest, request_count FROM request_rate_limits WHERE scope = $1",
        ["password-reset-request-email"],
      );
      expect(storedAccountLimit.rows).toEqual([{ key_digest: accountLimitDigest, request_count: 4 }]);
      expect(JSON.stringify(storedAccountLimit.rows)).not.toContain(email);

      const invalidReset = await app.inject({ method: "POST", url: "/v1/auth/password-reset/confirm", payload: { email, pin: "999999" === deliveredResetPin ? "000000" : "999999", password: "nueva contraseña integración 2026" } });
      expect(invalidReset.statusCode).toBe(202);
      expect(invalidReset.json()).toEqual(resetRequest?.json());
      const reset = await app.inject({ method: "POST", url: "/v1/auth/password-reset/confirm", payload: { email, pin: deliveredResetPin, password: "nueva contraseña integración 2026" } });
      expect(reset.statusCode).toBe(202);
      expect(reset.json()).toEqual(resetRequest?.json());
      expect((await app.inject({ method: "GET", url: "/v1/preferences/current", headers: { authorization: `Bearer ${activeToken}` } })).statusCode).toBe(401);
      const passwordRecord = await isolatedPool.query<{ password_hash: string }>("SELECT password_hash FROM accounts WHERE email = $1", [email]);
      expect(passwordRecord.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    } finally {
      await app.close();
    }
  });

  it("activa TOTP y exige factor de un solo uso en el login nativo con PostgreSQL real", async () => {
    const accountId = randomUUID();
    const email = `${accountId}@example.test`;
    const passwordHash = await (await import("argon2")).default.hash("clave MFA integración segura 2026");
    await isolatedPool.query(
      "INSERT INTO accounts (id, email, display_name, password_hash, email_verified_at) VALUES ($1, $2, 'MFA integración', $3, now())",
      [accountId, email, passwordHash],
    );
    const mfa = new AccountMfaService(isolatedPool, Buffer.alloc(32, 29), "integracion-recovery-pepper-32-bytes-minimo");
    const emailAuth = new EmailAuthService(new PostgresEmailAuthStore(isolatedPool), {
      sendVerification: async () => undefined,
      sendPasswordReset: async () => undefined,
    }, "integracion-email-pin-pepper-32-bytes-minimo");
    const app = createApp({
      store: new PostgresPreferenceStore(isolatedPool),
      authenticate: createSessionAuthenticator(isolatedPool),
      revokeSession: createSessionRevoker(isolatedPool),
      listAccountSessions: createAccountSessionLister(isolatedPool),
      revokeAccountSession: createAccountSessionRevoker(isolatedPool),
      revokeOtherSessions: createOtherSessionsRevoker(isolatedPool),
      checkReadiness: async () => { await isolatedPool.query("SELECT 1"); },
      requestRateLimiter: new PostgresRequestRateLimiter(isolatedPool, "integracion-rate-limit-pepper-32-bytes-minimo"),
      accountMfa: mfa,
      emailAuth,
      nativeAuth: new NativeAuthService(new PostgresNativeAuthStore(isolatedPool), mfa),
    });

    async function newFlow(remoteAddress?: string) {
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const state = randomBytes(32).toString("base64url");
      const redirectUri = "http://127.0.0.1:49152/callback";
      const response = await app.inject({
        method: "GET", url: `/auth/native?${new URLSearchParams({ redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: "S256" })}`,
        ...(remoteAddress ? { remoteAddress } : {}),
      });
      return {
        verifier,
        state,
        redirectUri,
        cookie: String(response.headers["set-cookie"]).split(";")[0],
        csrf: response.body.match(/name="csrf" value="([^"]+)"/)?.[1] ?? "",
      };
    }

    async function passwordLogin(remoteAddress?: string) {
      const flow = await newFlow(remoteAddress);
      const response = await app.inject({
        method: "POST", url: "/auth/native/login",
        ...(remoteAddress ? { remoteAddress } : {}),
        headers: { cookie: flow.cookie, "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({ csrf: flow.csrf, email, password: "clave MFA integración segura 2026" }).toString(),
      });
      return { flow, response };
    }

    async function completeMfa(flow: Awaited<ReturnType<typeof newFlow>>, proof: string, remoteAddress?: string) {
      return app.inject({
        method: "POST", url: "/auth/native/login/mfa",
        ...(remoteAddress ? { remoteAddress } : {}),
        headers: { cookie: flow.cookie, "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({ csrf: flow.csrf, email, proof }).toString(),
      });
    }

    try {
      const { flow: initialFlow, response: initialLogin } = await passwordLogin();
      expect(initialLogin.statusCode).toBe(303);
      const initialCode = new URL(String(initialLogin.headers.location)).searchParams.get("code")!;
      const session = await app.inject({ method: "POST", url: "/v1/auth/native/exchange", payload: { code: initialCode, codeVerifier: initialFlow.verifier } });
      const sessionToken = session.json<{ sessionToken: string }>().sessionToken;
      const enrollmentResponse = await app.inject({ method: "POST", url: "/v1/auth/mfa/totp/enrollment", headers: { authorization: `Bearer ${sessionToken}` } });
      expect(enrollmentResponse.statusCode).toBe(200);
      const { secret } = enrollmentResponse.json<{ secret: string; provisioningUri: string }>();
      const enrollmentCode = totpCode(secret, Math.floor(Date.now() / 30_000));
      const codesResponse = await app.inject({ method: "POST", url: "/v1/auth/mfa/totp/enrollment/confirm", headers: { authorization: `Bearer ${sessionToken}` }, payload: { code: enrollmentCode } });
      expect(codesResponse.statusCode).toBe(200);
      const recoveryCodes = codesResponse.json<{ recoveryCodes: string[] }>().recoveryCodes;
      expect((await mfa.status(accountId))).toMatchObject({ totpEnabled: false, recoveryCodesRemaining: 0 });
      expect((await app.inject({ method: "POST", url: "/v1/auth/mfa/totp/enrollment/complete", headers: { authorization: `Bearer ${sessionToken}` } })).statusCode).toBe(204);
      expect((await app.inject({ method: "POST", url: "/v1/auth/mfa/totp/enrollment/complete", headers: { authorization: `Bearer ${sessionToken}` } })).statusCode).toBe(204);
      expect((await mfa.status(accountId))).toMatchObject({ totpEnabled: true, recoveryCodesRemaining: 10 });

      const mfaFlow = await passwordLogin();
      expect(mfaFlow.response.statusCode).toBe(200);
      expect(mfaFlow.response.body).toContain("Verifica tu identidad");
      expect(mfaFlow.response.headers.location).toBeUndefined();
      const nextCounter = Math.floor(Date.now() / 30_000) + 1;
      const loginCode = totpCode(secret, nextCounter);
      expect((await completeMfa(mfaFlow.flow, loginCode)).statusCode).toBe(303);

      const replayFlow = await passwordLogin();
      expect((await completeMfa(replayFlow.flow, loginCode)).statusCode).toBe(400);
      const backupFlow = await passwordLogin();
      expect((await completeMfa(backupFlow.flow, recoveryCodes[0]!)).statusCode).toBe(303);
      const backupReplayFlow = await passwordLogin();
      expect((await completeMfa(backupReplayFlow.flow, recoveryCodes[0]!)).statusCode).toBe(400);
      expect((await mfa.status(accountId)).recoveryCodesRemaining).toBe(9);

      await isolatedPool.query(
        "UPDATE request_rate_limits SET window_started_at = now() - interval '10 minutes' WHERE scope = $1",
        ["native-login-email"],
      );
      for (let attempt = 0; attempt < 7; attempt += 1) {
        const remoteAddress = `198.51.100.${attempt + 30}`;
        const pending = await passwordLogin(remoteAddress);
        expect(pending.response.statusCode).toBe(200);
        const response = await completeMfa(pending.flow, "000000", remoteAddress);
        expect(response.statusCode).toBe(attempt < 6 ? 400 : 429);
        if (attempt === 6) expect(response.headers["retry-after"]).toBe("300");
      }
      const mfaLimitDigest = createHmac("sha256", "integracion-rate-limit-pepper-32-bytes-minimo")
        .update("native-mfa-account")
        .update("\0")
        .update(accountId)
        .digest("hex");
      const storedMfaLimit = await isolatedPool.query<{ key_digest: string; request_count: number }>(
        "SELECT key_digest, request_count FROM request_rate_limits WHERE scope = $1",
        ["native-mfa-account"],
      );
      expect(storedMfaLimit.rows).toEqual([{ key_digest: mfaLimitDigest, request_count: 11 }]);
      expect(JSON.stringify(storedMfaLimit.rows)).not.toContain(accountId);

      const pendingCodes = await app.inject({ method: "POST", url: "/v1/auth/mfa/recovery-codes/rotate", headers: { authorization: `Bearer ${sessionToken}` } });
      expect(pendingCodes.statusCode).toBe(200);
      expect((await mfa.status(accountId)).recoveryCodesRemaining).toBe(9);
      expect((await app.inject({ method: "DELETE", url: "/v1/auth/mfa/totp/enrollment", headers: { authorization: `Bearer ${sessionToken}` } })).statusCode).toBe(204);
      expect((await mfa.status(accountId)).recoveryCodesRemaining).toBe(9);

      const replacementCodes = await app.inject({ method: "POST", url: "/v1/auth/mfa/recovery-codes/rotate", headers: { authorization: `Bearer ${sessionToken}` } });
      expect(replacementCodes.statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/v1/auth/mfa/totp/enrollment/complete", headers: { authorization: `Bearer ${sessionToken}` } })).statusCode).toBe(204);
      expect((await app.inject({ method: "POST", url: "/v1/auth/mfa/totp/enrollment/complete", headers: { authorization: `Bearer ${sessionToken}` } })).statusCode).toBe(204);
      expect((await mfa.status(accountId))).toMatchObject({ totpEnabled: true, recoveryCodesRemaining: 10 });

      expect((await app.inject({ method: "DELETE", url: "/v1/auth/mfa/totp", headers: { authorization: `Bearer ${sessionToken}` } })).statusCode).toBe(204);
      expect((await mfa.status(accountId))).toMatchObject({ totpEnabled: false, recoveryCodesRemaining: 0 });
      const securityEvents = await isolatedPool.query<{ event_type: string }>(
        "SELECT event_type FROM account_security_email_outbox WHERE account_id = $1 ORDER BY created_at, id",
        [accountId],
      );
      expect(securityEvents.rows.map(({ event_type }) => event_type).sort()).toEqual([
        "totp_enabled", "recovery_codes_rotated", "totp_disabled",
      ].sort());
      expect((await app.inject({ method: "POST", url: "/v1/auth/mfa/totp/enrollment", headers: { authorization: `Bearer ${sessionToken}` } })).statusCode).toBe(200);
      expect((await mfa.status(accountId)).enrollmentPending).toBe(true);
      expect((await app.inject({ method: "DELETE", url: "/v1/auth/mfa/totp/enrollment", headers: { authorization: `Bearer ${sessionToken}` } })).statusCode).toBe(204);
      expect(await mfa.status(accountId)).toMatchObject({ totpEnabled: false, recoveryCodesRemaining: 0, enrollmentPending: false });
    } finally {
      await app.close();
    }
  });
});
