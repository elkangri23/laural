import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { AccountMfaService } from "../src/account-mfa.js";
import { encryptTotpSecret, totpCode, type EncryptedTotpSecret } from "../src/totp.js";

const accountId = "a3d2672e-9e68-4d57-9b9d-a2a3c84fd5c2";
const token = "t".repeat(43);
const authorization = `Bearer ${token}`;
const encryptionKey = Buffer.alloc(32, 17);
const recoveryPepper = "pepper-for-recovery-codes-that-is-long-enough";
const secret = "JBSWY3DPEHPK3PXP";

function testPool(respond: (sql: string, values?: unknown[]) => { rows: unknown[]; rowCount?: number }) {
  const statements: { sql: string; values?: unknown[] }[] = [];
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values });
    return respond(sql, values);
  });
  const client = { query, release } as unknown as PoolClient;
  return {
    pool: { query, connect: async () => client } as unknown as Pool,
    statements,
    release,
  };
}

describe("servicio MFA de cuenta", () => {
  it("valida secretos de configuración y rechaza una sesión que no es reciente", async () => {
    expect(() => new AccountMfaService({} as Pool, Buffer.alloc(31), recoveryPepper)).toThrow("32 bytes");
    expect(() => new AccountMfaService({} as Pool, encryptionKey, "short")).toThrow("32 bytes");
    const test = testPool(() => ({ rows: [] }));
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    await expect(service.startEnrollment(accountId, "Bearer invalid")).resolves.toBeNull();
    expect(test.statements).toHaveLength(0);
  });

  it("devuelve estado sin incluir secretos y solo inicia enrolamiento tras sesión reciente", async () => {
    const test = testPool((sql) => {
      if (sql.includes("AS totp_enabled")) return { rows: [{ totp_enabled: false, recovery_codes_remaining: "0", enrollment_pending: false }] };
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT email FROM accounts")) return { rows: [{ email: "user@example.test" }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("SELECT email FROM accounts")) return { rows: [{ email: "user@example.test" }] };
      return { rows: [] };
    });
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    await expect(service.status(accountId)).resolves.toEqual({ totpEnabled: false, recoveryCodesRemaining: 0, enrollmentPending: false });
    const enrollment = await service.startEnrollment(accountId, authorization);
    expect(enrollment?.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrollment?.provisioningUri).toContain("otpauth://totp/");
    const insert = test.statements.find(({ sql }) => sql.includes("INSERT INTO account_totp_enrollments"));
    expect(insert?.values?.[1]).not.toBe(enrollment?.secret);
    expect(JSON.stringify(test.statements)).not.toContain(enrollment?.secret);
  });

  it("rechaza un TOTP inválido y limita intentos del enrolamiento", async () => {
    const envelope = encryptTotpSecret(secret, encryptionKey, accountId);
    const test = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("FROM account_totp_enrollments")) return { rows: [{ encrypted_secret: envelope, attempts: 0 }] };
      return { rows: [] };
    });
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    await expect(service.confirmEnrollment(accountId, authorization, "not-a-code")).resolves.toBeNull();
    expect(test.statements.some(({ sql, values }) => sql.includes("attempts = $2::smallint") && values?.[1] === 1)).toBe(true);
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));
    expect(test.release).toHaveBeenCalledOnce();
  });

  it("deniega cambios sin factor, cuenta verificada o sesión reciente", async () => {
    const test = testPool((sql) => {
      if (sql.includes("AS totp_enabled")) return { rows: [] };
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT email FROM accounts")) return { rows: [] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("FROM account_totp_enrollments")) return { rows: [] };
      if (sql.includes("FROM account_totp_factors")) return { rows: [] };
      if (sql.includes("FROM account_recovery_codes")) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    await expect(service.status(accountId)).resolves.toEqual({ totpEnabled: false, recoveryCodesRemaining: 0, enrollmentPending: false });
    await expect(service.confirmEnrollment(accountId, "Bearer invalid", "123456")).resolves.toBeNull();
    await expect(service.acknowledgeRecoveryCodes(accountId, "Bearer invalid")).resolves.toBe(false);
    await expect(service.rotateRecoveryCodes(accountId, "Bearer invalid")).resolves.toBeNull();
    await expect(service.disableTotp(accountId, "Bearer invalid")).resolves.toBe(false);
    await expect(service.startEnrollment(accountId, authorization)).resolves.toBeNull();
    await expect(service.confirmEnrollment(accountId, authorization, "123456")).resolves.toBeNull();
    await expect(service.acknowledgeRecoveryCodes(accountId, authorization)).resolves.toBe(false);
    await expect(service.rotateRecoveryCodes(accountId, authorization)).resolves.toBeNull();
    await expect(service.disableTotp(accountId, authorization)).resolves.toBe(false);
    await service.cancelEnrollment(accountId, "Bearer invalid");
    await expect(service.requireMfaLogin({ flowId: "f", cookieDigest: "c", csrfDigest: "x", accountId })).resolves.toBe(false);
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));

    const validFlow = testPool(() => ({ rows: [], rowCount: 1 }));
    await expect(new AccountMfaService(validFlow.pool, encryptionKey, recoveryPepper).requireMfaLogin({ flowId: "f", cookieDigest: "c", csrfDigest: "x", accountId })).resolves.toBe(true);
  });

  it("finaliza sin revelar información cuando el flujo MFA ya no existe y revierte errores", async () => {
    const test = testPool((sql) => {
      if (sql.includes("FROM native_auth_flows f JOIN accounts")) return { rows: [] };
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      return { rows: [], rowCount: 1 };
    });
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    await expect(service.completeMfaLogin({ cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64), email: "user@example.test", proof: "123456", codeDigest: "c".repeat(64) })).resolves.toBeNull();
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));

    const failing = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("FROM native_auth_flows")) throw new Error("db failure");
      return { rows: [] };
    });
    const failingService = new AccountMfaService(failing.pool, encryptionKey, recoveryPepper);
    await expect(failingService.completeMfaLogin({ cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64), email: "user@example.test", proof: "123456", codeDigest: "c".repeat(64) })).rejects.toThrow("db failure");
    expect(failing.statements).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(failing.release).toHaveBeenCalledOnce();
  });

  it("rechaza un flujo MFA si el factor ya no está activo", async () => {
    const test = testPool((sql) => {
      if (sql.includes("FROM native_auth_flows f JOIN accounts")) return { rows: [{ id: "flow", account_id: accountId, redirect_uri: "http://127.0.0.1:49152/callback", state: "s".repeat(43), code_challenge: "c".repeat(43), attempts: 0 }] };
      return { rows: [] };
    });
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    await expect(service.completeMfaLogin({ cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64), email: "user@example.test", proof: "123456", codeDigest: "c".repeat(64) })).resolves.toBeNull();
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));
  });

  it("vuelve a validar la sesión dentro de cada transacción sensible", async () => {
    const test = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: sql.includes("FOR UPDATE") ? [] : [{ ok: 1 }] };
      return { rows: [{ id: accountId, email: "user@example.test" }], rowCount: 1 };
    });
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    await expect(service.startEnrollment(accountId, authorization)).resolves.toBeNull();
    await expect(service.confirmEnrollment(accountId, authorization, "123456")).resolves.toBeNull();
    await expect(service.acknowledgeRecoveryCodes(accountId, authorization)).resolves.toBe(false);
    await expect(service.rotateRecoveryCodes(accountId, authorization)).resolves.toBeNull();
    await expect(service.disableTotp(accountId, authorization)).resolves.toBe(false);
    await service.cancelEnrollment(accountId, authorization);
    expect(test.statements.filter(({ sql }) => sql === "ROLLBACK")).toHaveLength(6);
  });

  it("revierte y libera la conexión ante errores al iniciar un enrolamiento", async () => {
    const test = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT email FROM accounts")) throw new Error("database unavailable");
      return { rows: [{ ok: 1 }], rowCount: 1 };
    });
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    await expect(service.startEnrollment(accountId, authorization)).rejects.toThrow("database unavailable");
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(test.release).toHaveBeenCalledOnce();
  });

  it("genera códigos inactivos y los activa solo tras confirmación reciente", async () => {
    const envelope: EncryptedTotpSecret = encryptTotpSecret(secret, encryptionKey, accountId);
    const test = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("FROM account_totp_enrollments")) return { rows: [{ encrypted_secret: envelope, attempts: 0 }] };
      if (sql.includes("SELECT account_id, enabled_at")) return { rows: [{ account_id: accountId, enabled: false }] };
      if (sql.includes("FROM account_totp_factors")) return { rows: [] };
      if (sql.includes("SELECT 1 FROM account_recovery_codes")) return { rows: [{ ok: 1 }] };
      return { rows: [], rowCount: 1 };
    });
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    const code = totpCode(secret, Math.floor(Date.now() / 30_000));
    const recoveryCodes = await service.confirmEnrollment(accountId, authorization, code);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    const codeInserts = test.statements.filter(({ sql }) => sql.includes("INSERT INTO account_recovery_codes"));
    expect(codeInserts).toHaveLength(10);
    expect(codeInserts.every(({ sql }) => sql.includes("is_active) VALUES ($1, $2, false)"))).toBe(true);
    expect(JSON.stringify(test.statements)).not.toContain(recoveryCodes[0]);

    test.statements.length = 0;
    await expect(service.acknowledgeRecoveryCodes(accountId, authorization)).resolves.toBe(true);
    expect(test.statements.some(({ sql }) => sql.includes("SET is_active = true"))).toBe(true);
    expect(test.statements.some(({ sql }) => sql.includes("SET enabled_at = coalesce(enabled_at, now())"))).toBe(true);
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));
  });
});
