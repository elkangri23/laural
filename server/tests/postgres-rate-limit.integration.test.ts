import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg, { type Pool } from "pg";
import { PostgresRequestRateLimiter } from "../src/request-rate-limit.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const migrations = ["001_initial.sql", "002_email_verification.sql", "003_native_auth.sql", "004_request_rate_limits.sql"];
const schema = `laural_it_${randomUUID().replaceAll("-", "")}`;

describePostgres("integración real de PostgreSQL para rate limits", () => {
  let adminPool: Pool;
  let isolatedPool: Pool;

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    isolatedPool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await isolatedPool.query("CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");

    for (const migration of migrations) {
      const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8");
      await isolatedPool.query(sql);
      await isolatedPool.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration]);
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
