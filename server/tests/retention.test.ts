import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { cleanupExpiredRecords, RETENTION_INTERVAL_MS } from "../src/retention.js";

function createPool(query: (statement: string) => Promise<unknown>) {
  const client = { query: vi.fn(query), release: vi.fn() };
  return { pool: { connect: vi.fn(async () => client) } as unknown as Pool, client };
}

describe("limpieza de retención crítica", () => {
  it("ejecuta todas las políticas en una transacción y confirma al final", async () => {
    const { pool, client } = createPool(async () => ({ rows: [] }));

    await cleanupExpiredRecords(pool);

    const statements = client.query.mock.calls.map(([statement]) => statement);
    expect(statements[0]).toBe("BEGIN");
    expect(statements.at(-1)).toBe("COMMIT");
    expect(statements).toHaveLength(20);
    expect(statements.some((statement) => statement.includes("DELETE FROM email_verification_codes"))).toBe(true);
    expect(statements.some((statement) => statement.includes("DELETE FROM account_sessions"))).toBe(true);
    expect(statements.some((statement) => statement.includes("UPDATE account_recovery_grant_outbox"))).toBe(true);
    expect(statements.some((statement) => statement.includes("encrypted_ticket = NULL"))).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
    expect(RETENTION_INTERVAL_MS).toBe(60 * 60 * 1000);
  });

  it("revierte la transacción y libera el cliente si falla una política", async () => {
    const databaseError = new Error("fallo de limpieza");
    const { pool, client } = createPool(async (statement) => {
      if (statement.includes("DELETE FROM account_sessions")) throw databaseError;
      return { rows: [] };
    });

    await expect(cleanupExpiredRecords(pool)).rejects.toBe(databaseError);

    const statements = client.query.mock.calls.map(([statement]) => statement);
    expect(statements[0]).toBe("BEGIN");
    expect(statements.some((statement) => statement.includes("DELETE FROM account_sessions"))).toBe(true);
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("propaga el error de conexión antes de iniciar la transacción", async () => {
    const connectionError = new Error("sin conexión");
    const pool = { connect: vi.fn().mockRejectedValue(connectionError) } as unknown as Pool;

    await expect(cleanupExpiredRecords(pool)).rejects.toBe(connectionError);
    expect(pool.connect).toHaveBeenCalledOnce();
  });
});
