import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { applyMigrations, MIGRATION_FILES } from "../src/migration-runner.js";

function createClient(
  appliedMigrations: Set<string>,
  fail: (statement: string) => Error | null = () => null,
) {
  const client = {
    query: vi.fn(async (statement: string, values?: unknown[]) => {
      const error = fail(statement);
      if (error) throw error;
      if (statement === "SELECT 1 FROM schema_migrations WHERE version = $1") {
        return { rows: [], rowCount: appliedMigrations.has(String(values?.[0])) ? 1 : 0 };
      }
      return { rows: [], rowCount: 1 };
    }),
  } as unknown as PoolClient & { query: ReturnType<typeof vi.fn> };
  return client;
}

describe("ejecutor crítico de migraciones", () => {
  it("aplica en orden todas las migraciones nuevas dentro de una transacción", async () => {
    const client = createClient(new Set());

    await applyMigrations(client);

    const calls = client.query.mock.calls as Array<[string, unknown[]?]>;
    expect(calls[0]?.[0]).toBe("BEGIN");
    expect(calls[1]?.[0]).toContain("pg_advisory_xact_lock");
    expect(calls.at(-1)?.[0]).toBe("COMMIT");
    expect(calls).toHaveLength(3 + MIGRATION_FILES.length * 3 + 1);
    expect(calls.filter(([statement]) => statement === "SELECT 1 FROM schema_migrations WHERE version = $1")
      .map(([, values]) => values?.[0])).toEqual([...MIGRATION_FILES]);
    expect(calls.filter(([statement]) => statement === "INSERT INTO schema_migrations (version) VALUES ($1)")
      .map(([, values]) => values?.[0])).toEqual([...MIGRATION_FILES]);
    expect(calls.some(([statement]) => statement.includes("CREATE TABLE accounts"))).toBe(true);
  });

  it("omite las migraciones ya aplicadas y confirma sin volver a ejecutar SQL", async () => {
    const client = createClient(new Set(MIGRATION_FILES));

    await applyMigrations(client);

    const calls = client.query.mock.calls as Array<[string, unknown[]?]>;
    expect(calls.filter(([statement]) => statement === "SELECT 1 FROM schema_migrations WHERE version = $1")).toHaveLength(MIGRATION_FILES.length);
    expect(calls.some(([statement]) => statement === "INSERT INTO schema_migrations (version) VALUES ($1)")).toBe(false);
    expect(calls.at(-1)?.[0]).toBe("COMMIT");
    expect(calls).toHaveLength(3 + MIGRATION_FILES.length + 1);
  });

  it("revierte y conserva el error si falla una migración", async () => {
    const migrationError = new Error("fallo al aplicar migración");
    let queryIndex = 0;
    const client = createClient(new Set(), () => ++queryIndex === 5 ? migrationError : null);

    await expect(applyMigrations(client)).rejects.toBe(migrationError);
    const calls = client.query.mock.calls as Array<[string, unknown[]?]>;
    expect(calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(calls.some(([statement]) => statement === "COMMIT")).toBe(false);
  });

  it("revierte si no se puede confirmar la transacción", async () => {
    const commitError = new Error("fallo al confirmar");
    const client = createClient(new Set(MIGRATION_FILES), (statement) => statement === "COMMIT" ? commitError : null);

    await expect(applyMigrations(client)).rejects.toBe(commitError);
    const calls = client.query.mock.calls as Array<[string, unknown[]?]>;
    expect(calls.at(-2)?.[0]).toBe("COMMIT");
    expect(calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
});
