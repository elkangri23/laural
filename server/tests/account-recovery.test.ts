import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { AccountRecoveryService } from "../src/account-recovery.js";
import { encryptTotpSecret, totpCode, type EncryptedTotpSecret } from "../src/totp.js";

const accountId = "2f970cb2-66a0-4f78-a3d5-628e95c90e3e";
const grantId = "53918188-650d-40aa-9f88-f6fd5b92f36c";
const caseId = "d673af10-e1a6-4e72-b723-4e0afddfc2da";
const ticket = "t".repeat(43);
const cookie = "c".repeat(43);
const csrf = "s".repeat(43);
const key = Buffer.alloc(32, 19);
const pepper = "account-recovery-test-pepper-with-more-than-32-bytes";
const secret = "JBSWY3DPEHPK3PXP";
const envelope: EncryptedTotpSecret = encryptTotpSecret(secret, key, accountId);

function createPool(handler: (sql: string, values?: unknown[]) => { rows?: unknown[]; rowCount?: number } = () => ({ rows: [], rowCount: 1 })) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    queries.push({ sql, values });
    return { rows: [], rowCount: 1, ...handler(sql, values) };
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, client, queries };
}

function enrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: "enrollment-id", grant_id: grantId, account_id: accountId, email: "user@example.test",
    encrypted_secret: envelope, attempts: 0, is_expired: false, completed: false, ...overrides,
  };
}

describe("recuperación segura de factores", () => {
  it("valida los secretos de configuración", () => {
    expect(() => new AccountRecoveryService({} as Pool, Buffer.alloc(31), pepper)).toThrow("32 bytes");
    expect(() => new AccountRecoveryService({} as Pool, key, "short")).toThrow("32 bytes");
  });

  it("ignora tickets mal formados y revierte si el grant no es válido", async () => {
    const invalid = createPool();
    await expect(new AccountRecoveryService(invalid.pool, key, pepper).startEnrollment("bad-ticket")).resolves.toBeNull();
    expect(invalid.pool.connect).not.toHaveBeenCalled();

    const absent = createPool(() => ({ rows: [], rowCount: 0 }));
    await expect(new AccountRecoveryService(absent.pool, key, pepper).startEnrollment(ticket)).resolves.toBeNull();
    expect(absent.queries).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(absent.client.release).toHaveBeenCalledOnce();
  });

  it("emite tokens opacos y cifra el secreto del nuevo TOTP antes de consumir el ticket", async () => {
    const db = createPool((sql) => sql.includes("SELECT g.id AS grant_id")
      ? { rows: [{ grant_id: grantId, account_id: accountId, email: "user@example.test" }] }
      : sql.includes("INSERT INTO account_recovery_enrollments") ? { rows: [], rowCount: 1 }
        : { rows: [], rowCount: 1 });
    const result = await new AccountRecoveryService(db.pool, key, pepper).startEnrollment(ticket);
    expect(result?.cookieToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(result?.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(result?.secret).toMatch(/^[A-Z2-7]{32}$/u);
    expect(result?.provisioningUri).toContain("otpauth://totp/Laural%3Auser%40example.test");
    const insert = db.queries.find(({ sql }) => sql.includes("INSERT INTO account_recovery_enrollments"));
    expect(insert?.values?.[4]).not.toBe(result?.secret);
    expect(JSON.stringify(db.queries)).not.toContain(result?.secret);
    expect(db.queries.findIndex(({ sql }) => sql.includes("UPDATE account_recovery_grants SET consumed_at")))
      .toBeGreaterThan(db.queries.findIndex(({ sql }) => sql.includes("INSERT INTO account_recovery_enrollments")));
    expect(db.queries).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));
  });

  it("no devuelve enrolamiento si la inserción no afectó una fila y revierte fallos", async () => {
    const notInserted = createPool((sql) => sql.includes("SELECT g.id AS grant_id")
      ? { rows: [{ grant_id: grantId, account_id: accountId, email: "user@example.test" }] }
      : sql.includes("INSERT INTO account_recovery_enrollments") ? { rows: [], rowCount: 0 }
        : { rows: [], rowCount: 1 });
    await expect(new AccountRecoveryService(notInserted.pool, key, pepper).startEnrollment(ticket)).resolves.toBeNull();
    expect(notInserted.queries).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));

    const broken = createPool((sql) => {
      if (sql.includes("SELECT g.id AS grant_id")) throw new Error("grant lookup failed");
      return { rows: [], rowCount: 1 };
    });
    await expect(new AccountRecoveryService(broken.pool, key, pepper).startEnrollment(ticket)).rejects.toThrow("grant lookup failed");
    expect(broken.queries).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(broken.client.release).toHaveBeenCalledOnce();
  });

  it("rechaza tokens o códigos con formato incorrecto sin abrir transacción", async () => {
    const db = createPool();
    const service = new AccountRecoveryService(db.pool, key, pepper);
    await expect(service.confirmEnrollment("bad", csrf, "123456")).resolves.toBeNull();
    await expect(service.confirmEnrollment(cookie, "bad", "123456")).resolves.toBeNull();
    await expect(service.confirmEnrollment(cookie, csrf, "abcdef")).resolves.toBeNull();
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it("cierra enrolamientos ausentes, expirados, agotados o ya completados", async () => {
    const scenarios = [
      { row: null, consume: false },
      { row: enrollment({ is_expired: true }), consume: true },
      { row: enrollment({ attempts: 5 }), consume: true },
      { row: enrollment({ completed: true }), consume: false },
    ];
    for (const scenario of scenarios) {
      const db = createPool((sql) => sql.includes("SELECT e.id, e.grant_id")
        ? { rows: scenario.row ? [scenario.row] : [], rowCount: scenario.row ? 1 : 0 }
        : { rows: [], rowCount: 1 });
      await expect(new AccountRecoveryService(db.pool, key, pepper).confirmEnrollment(cookie, csrf, "123456"))
        .resolves.toBeNull();
      expect(db.queries).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));
      expect(db.queries.some(({ sql }) => sql.includes("SET consumed_at = now() WHERE id = $1"))).toBe(scenario.consume);
      expect(db.client.release).toHaveBeenCalledOnce();
    }
  });

  it("incrementa el contador cuando el TOTP no coincide", async () => {
    const db = createPool((sql) => sql.includes("SELECT e.id, e.grant_id")
      ? { rows: [enrollment()], rowCount: 1 }
      : { rows: [], rowCount: 1 });
    await expect(new AccountRecoveryService(db.pool, key, pepper).confirmEnrollment(cookie, csrf, "000000"))
      .resolves.toBeNull();
    expect(db.queries.find(({ sql }) => sql.includes("SET attempts = $2::smallint"))?.values).toEqual(["enrollment-id", 1]);
    expect(db.queries).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));
    expect(db.queries.some(({ sql }) => sql.includes("INSERT INTO account_totp_factors"))).toBe(false);
  });

  it("sustituye los factores en una transacción y revoca sesiones y códigos pendientes", async () => {
    const db = createPool((sql) => {
      if (sql.includes("SELECT e.id, e.grant_id")) return { rows: [enrollment()], rowCount: 1 };
      if (sql.includes("UPDATE native_authorization_codes")) return { rows: [{ flow_id: "flow-a" }, { flow_id: "flow-b" }], rowCount: 2 };
      return { rows: [], rowCount: 1 };
    });
    const code = totpCode(secret, Math.floor(Date.now() / 30_000));
    const codes = await new AccountRecoveryService(db.pool, key, pepper).confirmEnrollment(cookie, csrf, code);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const table of ["account_totp_factors", "account_recovery_codes", "account_passkeys", "account_totp_enrollments", "passkey_management_tickets", "passkey_management_sessions"]) {
      expect(db.queries.some(({ sql }) => sql.includes(`DELETE FROM ${table}`))).toBe(true);
    }
    expect(db.queries.filter(({ sql }) => sql.includes("INSERT INTO account_recovery_codes"))).toHaveLength(10);
    expect(db.queries.some(({ sql }) => sql.includes("UPDATE account_sessions SET revoked_at"))).toBe(true);
    expect(db.queries.find(({ sql }) => sql.includes("UPDATE native_auth_flows SET consumed_at"))?.values)
      .toEqual([accountId, ["flow-a", "flow-b"]]);
    expect(db.queries.some(({ sql }) => sql.includes("UPDATE account_recovery_cases SET recovery_completed_at"))).toBe(true);
    expect(db.queries.find(({ sql }) => sql.includes("INSERT INTO account_security_email_outbox"))?.values)
      .toEqual([accountId, "user@example.test"]);
    expect(JSON.stringify(db.queries)).not.toContain(codes[0]);
    expect(db.queries).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));
    expect(db.client.release).toHaveBeenCalledOnce();
  });

  it("revierte la confirmación si falla una operación de sustitución", async () => {
    const db = createPool((sql) => {
      if (sql.includes("SELECT e.id, e.grant_id")) return { rows: [enrollment()], rowCount: 1 };
      if (sql.includes("DELETE FROM account_passkeys")) throw new Error("factor replacement failed");
      return { rows: [], rowCount: 1 };
    });
    const code = totpCode(secret, Math.floor(Date.now() / 30_000));
    await expect(new AccountRecoveryService(db.pool, key, pepper).confirmEnrollment(cookie, csrf, code))
      .rejects.toThrow("factor replacement failed");
    expect(db.queries).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(db.client.release).toHaveBeenCalledOnce();
  });
});
