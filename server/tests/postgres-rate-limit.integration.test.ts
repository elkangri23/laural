import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg, { type Pool } from "pg";
import { createApp } from "../src/app.js";
import { applyMigrations, MIGRATION_FILES } from "../src/migration-runner.js";
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
});
