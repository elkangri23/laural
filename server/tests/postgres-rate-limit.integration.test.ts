import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg, { type Pool } from "pg";
import { createApp } from "../src/app.js";
import { createSessionAuthenticator, createSessionRevoker } from "../src/auth.js";
import { EmailAuthService } from "../src/email-auth.js";
import { applyMigrations, MIGRATION_FILES } from "../src/migration-runner.js";
import { NativeAuthService } from "../src/native-auth.js";
import { PostgresEmailAuthStore } from "../src/postgres-email-auth-store.js";
import { PostgresNativeAuthStore } from "../src/postgres-native-auth-store.js";
import { PostgresPreferenceStore } from "../src/postgres-store.js";
import { PostgresRequestRateLimiter } from "../src/request-rate-limit.js";

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

  it("aplica las cuatro migraciones y comparte límites atómicos entre instancias", async () => {
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
    const emailAuth = new EmailAuthService(
      new PostgresEmailAuthStore(isolatedPool),
      { sendVerification: async ({ pin }) => { deliveredPin = pin; } },
      "integracion-email-pin-pepper-32-bytes-minimo",
    );
    const app = createApp({
      store: new PostgresPreferenceStore(isolatedPool),
      authenticate: createSessionAuthenticator(isolatedPool),
      revokeSession: createSessionRevoker(isolatedPool),
      checkReadiness: async () => { await isolatedPool.query("SELECT 1"); },
      requestRateLimiter: new PostgresRequestRateLimiter(isolatedPool, "integracion-rate-limit-pepper-32-bytes-minimo"),
      emailAuth,
      nativeAuth: new NativeAuthService(new PostgresNativeAuthStore(isolatedPool)),
    });

    try {
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

      const sessionRecord = await isolatedPool.query<{ token_hash: string }>(
        "SELECT token_hash FROM account_sessions WHERE token_hash = $1",
        [createHash("sha256").update(session.sessionToken).digest("hex")],
      );
      expect(sessionRecord.rows).toHaveLength(1);
      expect(sessionRecord.rows[0]?.token_hash).not.toBe(session.sessionToken);

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
    } finally {
      await app.close();
    }
  });
});
