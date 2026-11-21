import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { cleanupExpiredRecords, RETENTION_INTERVAL_MS } from "../src/retention.js";

function createPool(query: (statement: string) => void | Promise<void> = () => undefined) {
  const statements: string[] = [];
  const release = vi.fn();
  const client = {
    query: vi.fn(async (statement: string) => {
      statements.push(statement);
      await query(statement);
      return { rows: [] };
    }),
    release,
  } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, "connect">;
  return { pool, statements, release };
}

describe("limpieza de retención PostgreSQL", () => {
  it("elimina datos temporales con plazos seguros dentro de una transacción", async () => {
    const { pool, statements, release } = createPool();
    await cleanupExpiredRecords(pool);

    expect(statements[0]).toBe("BEGIN");
    expect(statements).toContain("DELETE FROM email_verification_codes WHERE created_at < now() - interval '15 minutes'");
    expect(statements).toContain("DELETE FROM native_authorization_codes WHERE created_at < now() - interval '24 hours'");
    expect(statements).toContain("DELETE FROM native_auth_flows WHERE created_at < now() - interval '24 hours'");
    expect(statements).toContain("DELETE FROM account_sessions WHERE expires_at <= now() OR revoked_at IS NOT NULL");
    expect(statements).toContain("DELETE FROM preference_idempotency WHERE created_at < now() - interval '30 days'");
    expect(statements.at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
    expect(RETENTION_INTERVAL_MS).toBe(3_600_000);
  });

  it("revierte toda la pasada ante un error y libera la conexión", async () => {
    const { pool, statements, release } = createPool((statement) => {
      if (statement.startsWith("DELETE FROM account_sessions")) throw new Error("database failure");
    });

    await expect(cleanupExpiredRecords(pool)).rejects.toThrow("database failure");
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });
});
