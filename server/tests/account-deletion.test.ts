import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { AccountDeletionService } from "../src/account-deletion.js";

const accountId = "account-123";
const token = "a".repeat(43);
const authorization = `Bearer ${token}`;

function createPool(responses: Array<unknown | Error>) {
  const client = {
    query: vi.fn(async () => {
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, client };
}

describe("AccountDeletionService", () => {
  it("rechaza bearer ausente o malformado antes de conectar a PostgreSQL", async () => {
    const { pool } = createPool([]);
    const service = new AccountDeletionService(pool);

    await expect(service.deleteAccount(accountId, undefined)).resolves.toBe("unauthorized");
    await expect(service.deleteAccount(accountId, "Basic credentials")).resolves.toBe("unauthorized");
    await expect(service.deleteAccount(accountId, `Bearer ${"x".repeat(42)}`)).resolves.toBe("unauthorized");
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("revierte y libera la conexión si la sesión no existe", async () => {
    const { pool, client } = createPool([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const service = new AccountDeletionService(pool);

    await expect(service.deleteAccount(accountId, authorization)).resolves.toBe("unauthorized");
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("SELECT s.created_at"),
      "ROLLBACK",
    ]);
    expect(client.query.mock.calls[1]?.[1]).toEqual([
      accountId,
      createHash("sha256").update(token).digest("hex"),
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("conserva la cuenta cuando la autenticación reciente no está acreditada", async () => {
    const { pool, client } = createPool([
      { rows: [] },
      { rows: [{ recent_auth: false }] },
      { rows: [] },
    ]);
    const service = new AccountDeletionService(pool);

    await expect(service.deleteAccount(accountId, authorization)).resolves.toBe("recent_auth_required");
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("SELECT s.created_at"),
      "COMMIT",
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("elimina y confirma únicamente una cuenta con sesión reciente", async () => {
    const { pool, client } = createPool([
      { rows: [] },
      { rows: [{ recent_auth: true }] },
      { rows: [{ id: accountId }], rowCount: 1 },
      { rows: [] },
    ]);
    const service = new AccountDeletionService(pool);

    await expect(service.deleteAccount(accountId, authorization)).resolves.toBe("deleted");
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("SELECT s.created_at"),
      "DELETE FROM accounts WHERE id = $1 RETURNING id",
      "COMMIT",
    ]);
    expect(client.query.mock.calls[2]?.[1]).toEqual([accountId]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("revierte si la cuenta deja de existir antes del borrado", async () => {
    const { pool, client } = createPool([
      { rows: [] },
      { rows: [{ recent_auth: true }] },
      { rows: [], rowCount: 0 },
      { rows: [] },
    ]);
    const service = new AccountDeletionService(pool);

    await expect(service.deleteAccount(accountId, authorization)).resolves.toBe("unauthorized");
    expect(client.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("revierte y libera la conexión si falla una consulta", async () => {
    const databaseError = new Error("fallo de base de datos");
    const { pool, client } = createPool([{ rows: [] }, databaseError, { rows: [] }]);
    const service = new AccountDeletionService(pool);

    await expect(service.deleteAccount(accountId, authorization)).rejects.toBe(databaseError);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("SELECT s.created_at"),
      "ROLLBACK",
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("propaga el error de conexión antes de abrir una transacción", async () => {
    const connectionError = new Error("sin conexión");
    const pool = { connect: vi.fn().mockRejectedValue(connectionError) } as unknown as Pool;
    const service = new AccountDeletionService(pool);

    await expect(service.deleteAccount(accountId, authorization)).rejects.toBe(connectionError);
    expect(pool.connect).toHaveBeenCalledOnce();
  });
});
