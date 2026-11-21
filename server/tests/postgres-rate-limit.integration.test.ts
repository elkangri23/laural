import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg, { type Pool } from "pg";
import { applyMigrations, MIGRATION_FILES } from "../src/migration-runner.js";
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
});
