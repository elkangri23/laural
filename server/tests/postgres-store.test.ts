import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { PreferenceSnapshot } from "../src/contracts.js";
import { snapshotDigest } from "../src/app.js";
import { PostgresPreferenceStore } from "../src/postgres-store.js";

const snapshot: PreferenceSnapshot = {
  schemaVersion: 1,
  preferences: { themeId: "laurel", appearance: "dark", updateMode: "manual" },
  activeProviderId: null,
  providers: [],
};

function createPool(respond: (sql: string, values?: unknown[]) => { rows: unknown[] }): { pool: Pool; queries: string[]; release: ReturnType<typeof vi.fn> } {
  const queries: string[] = [];
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    queries.push(sql);
    return respond(sql, values);
  });
  const client = { query, release };
  const pool = { query, connect: async () => client } as unknown as Pool;
  return { pool, queries, release };
}

describe("almacén PostgreSQL de preferencias", () => {
  it("devuelve un snapshot vacío cuando la cuenta aún no ha sincronizado", async () => {
    const { pool } = createPool(() => ({ rows: [] }));
    const store = new PostgresPreferenceStore(pool);
    await expect(store.get("account-id")).resolves.toEqual({ snapshot: null, revision: 0 });
  });

  it("lee el snapshot y convierte la revisión de bigint", async () => {
    const { pool } = createPool(() => ({ rows: [{ snapshot, revision: "7" }] }));
    const store = new PostgresPreferenceStore(pool);
    await expect(store.get("account-id")).resolves.toEqual({ snapshot, revision: 7 });
  });

  it("pagina, obtiene y elimina únicamente el historial de la cuenta", async () => {
    const createdAt = new Date("2026-11-22T12:00:00.000Z");
    const { pool, queries } = createPool((sql) => {
      if (sql.includes("DELETE FROM preference_snapshot_history")) return { rows: [], rowCount: 1 };
      if (sql.includes("SELECT h.snapshot")) return { rows: [{ snapshot, revision: "4", created_at: createdAt }] };
      return { rows: [{ revision: "4", created_at: createdAt }] };
    });
    const store = new PostgresPreferenceStore(pool);
    await expect(store.listHistory("account-id", 5, 25)).resolves.toEqual([{ revision: 4, createdAt: createdAt.toISOString() }]);
    await expect(store.getHistory("account-id", 4)).resolves.toEqual({ revision: 4, createdAt: createdAt.toISOString(), snapshot });
    await expect(store.deleteHistory("account-id", 4)).resolves.toBe(true);
    expect(queries.every((sql) => sql.includes("account_id = $1"))).toBe(true);
  });

  it("devuelve ausencia para una versión borrada o inexistente", async () => {
    const { pool } = createPool(() => ({ rows: [], rowCount: 0 }));
    const store = new PostgresPreferenceStore(pool);
    await expect(store.getHistory("account-id", 99)).resolves.toBeNull();
    await expect(store.deleteHistory("account-id", 99)).resolves.toBe(false);
    await expect(store.listHistory("account-id", undefined, 25)).resolves.toEqual([]);
  });

  it("escribe en una transacción y guarda una idempotencia", async () => {
    const { pool, queries, release } = createPool((sql) => {
      if (sql.includes("FROM accounts")) return { rows: [{ id: "account-id" }] };
      if (sql.includes("FROM preference_idempotency")) return { rows: [] };
      if (sql.includes("FROM account_preferences")) return { rows: [{ revision: "3", snapshot, updated_at: new Date("2026-11-22T12:00:00.000Z") }] };
      return { rows: [] };
    });
    const store = new PostgresPreferenceStore(pool);
    await expect(store.put("account-id", 3, "request-key-000001", snapshot))
      .resolves.toEqual({ kind: "saved", snapshot, revision: 4 });
    expect(queries[0]).toBe("BEGIN");
    expect(queries).toContain("COMMIT");
    expect(queries.some((sql) => sql.includes("INSERT INTO preference_idempotency"))).toBe(true);
    expect(queries.some((sql) => sql.includes("INSERT INTO preference_snapshot_history"))).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("responde con conflicto si la revisión cambió", async () => {
    const { pool, queries } = createPool((sql) => {
      if (sql.includes("FROM accounts")) return { rows: [{ id: "account-id" }] };
      if (sql.includes("FROM preference_idempotency")) return { rows: [] };
      if (sql.includes("FROM account_preferences")) return { rows: [{ revision: "9" }] };
      return { rows: [] };
    });
    const store = new PostgresPreferenceStore(pool);
    await expect(store.put("account-id", 8, "request-key-000001", snapshot))
      .resolves.toEqual({ kind: "conflict", revision: 9 });
    expect(queries).toContain("COMMIT");
    expect(queries.some((sql) => sql.includes("INSERT INTO account_preferences"))).toBe(false);
  });

  it("reproduce una petición idempotente ya completada", async () => {
    const { pool } = createPool((sql) => {
      if (sql.includes("FROM accounts")) return { rows: [{ id: "account-id" }] };
      return sql.includes("FROM preference_idempotency")
        ? { rows: [{ payload_digest: snapshotDigest(snapshot), snapshot, revision: "5" }] }
        : { rows: [] };
    });
    const store = new PostgresPreferenceStore(pool);
    await expect(store.put("account-id", 0, "request-key-000001", snapshot))
      .resolves.toEqual({ kind: "replayed", snapshot, revision: 5 });
  });

  it("detecta la reutilización de la clave con otro contenido y revierte ante errores", async () => {
    const { pool } = createPool((sql) => {
      if (sql.includes("FROM accounts")) return { rows: [{ id: "account-id" }] };
      return sql.includes("FROM preference_idempotency")
        ? { rows: [{ payload_digest: "different", snapshot, revision: "2" }] }
        : { rows: [] };
    });
    const store = new PostgresPreferenceStore(pool);
    await expect(store.put("account-id", 0, "request-key-000001", snapshot))
      .resolves.toEqual({ kind: "idempotency_key_reused" });

    const broken = createPool((sql) => {
      if (sql === "BEGIN") return { rows: [] };
      if (sql.includes("SELECT id FROM accounts")) throw new Error("db unavailable");
      return { rows: [] };
    });
    await expect(new PostgresPreferenceStore(broken.pool).put("account-id", 0, "request-key-000001", snapshot))
      .rejects.toThrow("db unavailable");
    expect(broken.queries).toContain("ROLLBACK");
    expect(broken.release).toHaveBeenCalledOnce();
  });

  it("bloquea la escritura si la cuenta ya no es activa o verificada", async () => {
    const { pool, queries } = createPool(() => ({ rows: [] }));
    await expect(new PostgresPreferenceStore(pool).put("account-id", 0, "request-key-000001", snapshot))
      .resolves.toEqual({ kind: "unauthorized" });
    expect(queries).toContain("ROLLBACK");
    expect(queries.some((sql) => sql.includes("INSERT INTO account_preferences"))).toBe(false);
  });
});
