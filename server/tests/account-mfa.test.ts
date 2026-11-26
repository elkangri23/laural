import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { AccountMfaService } from "../src/account-mfa.js";
import { createRecoveryCodes, encryptTotpSecret, recoveryCodeDigest, totpCode, type EncryptedTotpSecret } from "../src/totp.js";

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
  it("resuelve la cuenta MFA solo desde un flujo activo ligado a la identidad almacenada", async () => {
    const test = testPool((sql) => sql.includes("FROM native_auth_flows")
      ? { rows: [{ account_id: accountId }] }
      : { rows: [] });
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    await expect(service.pendingMfaLoginAccountId(token, "c".repeat(43), " USER@EXAMPLE.TEST ")).resolves.toBe(accountId);
    expect(test.statements[0]?.sql).toContain("f.mfa_account_id IS NOT NULL");
    expect(test.statements[0]?.sql).toContain("f.attempts < 5");
    expect(test.statements[0]?.sql).toContain("t.enabled_at IS NOT NULL");
    expect(test.statements[0]?.values?.[0]).not.toBe(token);
    expect(test.statements[0]?.values?.[1]).not.toBe("c".repeat(43));
    expect(test.statements[0]?.values?.[2]).toBe("user@example.test");

    await expect(service.pendingMfaLoginAccountId("bad", "c".repeat(43), "user@example.test")).resolves.toBeNull();
    expect(test.statements).toHaveLength(1);
  });

  it("valida secretos de configuración y rechaza una sesión que no es reciente", async () => {
    expect(() => new AccountMfaService({} as Pool, Buffer.alloc(31), recoveryPepper)).toThrow("32 bytes");
    expect(() => new AccountMfaService({} as Pool, encryptionKey, "short")).toThrow("32 bytes");
    const test = testPool(() => ({ rows: [] }));
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    await expect(service.startEnrollment(accountId, "Bearer invalid")).resolves.toBeNull();
    expect(test.statements).toHaveLength(0);
  });

  it("devuelve valores seguros cuando la consulta de estado no contiene fila", async () => {
    const test = testPool(() => ({ rows: [] }));
    await expect(new AccountMfaService(test.pool, encryptionKey, recoveryPepper).status(accountId))
      .resolves.toEqual({ totpEnabled: false, recoveryCodesRemaining: 0, enrollmentPending: false });
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

  it("rechaza el inicio del enrolamiento si ya hay un factor activo", async () => {
    const test = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("SELECT email FROM accounts")) return { rows: [{ email: "user@example.test" }] };
      if (sql.includes("FROM account_totp_factors")) return { rows: [{ ok: 1 }] };
      return { rows: [], rowCount: 0 };
    });
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    await expect(service.startEnrollment(accountId, authorization)).resolves.toBeNull();
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(test.statements.some(({ sql }) => sql.includes("INSERT INTO account_totp_enrollments"))).toBe(false);
    expect(test.release).toHaveBeenCalledOnce();
  });

  it("no crea enrolamiento para una cuenta sin correo verificado disponible", async () => {
    const test = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("SELECT email FROM accounts")) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    await expect(new AccountMfaService(test.pool, encryptionKey, recoveryPepper).startEnrollment(accountId, authorization))
      .resolves.toBeNull();
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(test.statements.some(({ sql }) => sql.includes("DELETE FROM account_totp_factors"))).toBe(false);
  });

  it("rota códigos solo si TOTP está activo y revoca las otras sesiones", async () => {
    const test = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("SELECT 1 FROM account_totp_factors")) return { rows: [{ ok: 1 }] };
      return { rows: [], rowCount: 1 };
    });
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    const codes = await service.rotateRecoveryCodes(accountId, authorization);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(test.statements.filter(({ sql }) => sql.includes("INSERT INTO account_recovery_codes"))).toHaveLength(10);
    expect(test.statements.some(({ sql }) => sql.includes("UPDATE account_sessions"))).toBe(true);
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));

    const inactive = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      return { rows: [] };
    });
    await expect(new AccountMfaService(inactive.pool, encryptionKey, recoveryPepper).rotateRecoveryCodes(accountId, authorization))
      .resolves.toBeNull();
    expect(inactive.statements).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(inactive.statements.some(({ sql }) => sql.includes("INSERT INTO account_recovery_codes"))).toBe(false);
  });

  it("confirma que el enrolamiento aún existe antes de aceptar un código válido", async () => {
    const test = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("FROM account_totp_enrollments")) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });
    await expect(new AccountMfaService(test.pool, encryptionKey, recoveryPepper).confirmEnrollment(accountId, authorization, "123456"))
      .resolves.toBeNull();
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));
    expect(test.statements.some(({ sql }) => sql.includes("INSERT INTO account_totp_factors"))).toBe(false);
  });

  it("no reemplaza un factor activo si una carrera ocurre durante la confirmación", async () => {
    const envelope = encryptTotpSecret(secret, encryptionKey, accountId);
    const test = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("FROM account_totp_enrollments")) return { rows: [{ encrypted_secret: envelope, attempts: 0 }] };
      if (sql.includes("SELECT 1 FROM account_totp_factors")) return { rows: [{ ok: 1 }] };
      return { rows: [], rowCount: 1 };
    });
    const code = totpCode(secret, Math.floor(Date.now() / 30_000));
    await expect(new AccountMfaService(test.pool, encryptionKey, recoveryPepper).confirmEnrollment(accountId, authorization, code))
      .resolves.toBeNull();
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(test.statements.some(({ sql }) => sql.includes("INSERT INTO account_recovery_codes"))).toBe(false);
  });

  it("no confirma ni inicia transacciones si la cuenta no tiene factor MFA que acusar", async () => {
    const test = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      return { rows: [] };
    });
    await expect(new AccountMfaService(test.pool, encryptionKey, recoveryPepper).acknowledgeRecoveryCodes(accountId, authorization))
      .resolves.toBe(false);
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(test.statements.some(({ sql }) => sql.includes("UPDATE account_recovery_codes"))).toBe(false);
  });

  it("aborta las operaciones sensibles si la cuenta dejó de ser válida", async () => {
    const cases = [
      { name: "inicio de enrolamiento", run: (service: AccountMfaService) => service.startEnrollment(accountId, authorization), result: null },
      { name: "confirmación de enrolamiento", run: (service: AccountMfaService) => service.confirmEnrollment(accountId, authorization, "123456"), result: null },
      { name: "acuse de recuperación", run: (service: AccountMfaService) => service.acknowledgeRecoveryCodes(accountId, authorization), result: false },
      { name: "rotación de códigos", run: (service: AccountMfaService) => service.rotateRecoveryCodes(accountId, authorization), result: null },
      { name: "desactivación TOTP", run: (service: AccountMfaService) => service.disableTotp(accountId, authorization), result: false },
      { name: "cancelación de enrolamiento", run: (service: AccountMfaService) => service.cancelEnrollment(accountId, authorization), result: undefined },
    ];
    for (const scenario of cases) {
      const test = testPool((sql) => {
        if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
        if (sql.includes("SELECT id FROM accounts")) return { rows: [] };
        return { rows: [] };
      });
      const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
      await expect(scenario.run(service), scenario.name).resolves.toBe(scenario.result);
      expect(test.statements).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
      expect(test.release).toHaveBeenCalledOnce();
    }
  });

  it("revierte y libera conexiones ante errores de rotación, confirmación y cancelación", async () => {
    const failingCases = [
      {
        run: (service: AccountMfaService) => service.rotateRecoveryCodes(accountId, authorization),
        respond: (sql: string) => sql.includes("FROM account_sessions") || sql.includes("SELECT id FROM accounts") || sql.includes("SELECT 1 FROM account_totp_factors")
          ? { rows: [{ ok: 1, id: accountId }] }
          : sql.includes("INSERT INTO account_recovery_codes") ? (() => { throw new Error("insert failed"); })() : { rows: [], rowCount: 1 },
      },
      {
        run: (service: AccountMfaService) => service.confirmEnrollment(accountId, authorization, "123456"),
        respond: (sql: string) => sql.includes("FROM account_sessions") || sql.includes("SELECT id FROM accounts")
          ? { rows: [{ ok: 1, id: accountId }] }
          : sql.includes("FROM account_totp_enrollments") ? (() => { throw new Error("enrollment lookup failed"); })() : { rows: [], rowCount: 1 },
      },
      {
        run: (service: AccountMfaService) => service.cancelEnrollment(accountId, authorization),
        respond: (sql: string) => sql.includes("FROM account_sessions") || sql.includes("SELECT id FROM accounts")
          ? { rows: [{ ok: 1, id: accountId }] }
          : sql.includes("DELETE FROM account_totp_enrollments") ? (() => { throw new Error("delete failed"); })() : { rows: [], rowCount: 1 },
      },
    ];
    for (const scenario of failingCases) {
      const test = testPool(scenario.respond);
      const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
      await expect(scenario.run(service)).rejects.toThrow(/failed/);
      expect(test.statements).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
      expect(test.release).toHaveBeenCalledOnce();
    }
  });

  it("cancela un enrolamiento pendiente tras volver a comprobar sesión y cuenta", async () => {
    const test = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      return { rows: [], rowCount: 1 };
    });
    await new AccountMfaService(test.pool, encryptionKey, recoveryPepper).cancelEnrollment(accountId, authorization);
    expect(test.statements.some(({ sql }) => sql.includes("DELETE FROM account_totp_enrollments"))).toBe(true);
    expect(test.statements.some(({ sql }) => sql.includes("DELETE FROM account_totp_factors"))).toBe(true);
    expect(test.statements.some(({ sql }) => sql.includes("DELETE FROM account_recovery_codes"))).toBe(true);
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));
    expect(test.release).toHaveBeenCalledOnce();
  });

  it("solo confirma códigos de recuperación pendientes y permite repetir el acuse ya activo", async () => {
    for (const scenario of [
      { enabled: true, pending: false, expected: true, transaction: "COMMIT" },
      { enabled: false, pending: false, expected: false, transaction: "ROLLBACK" },
      { enabled: false, pending: true, expected: true, transaction: "COMMIT" },
      { enabled: true, pending: true, expected: true, transaction: "COMMIT" },
    ]) {
      const test = testPool((sql) => {
        if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
        if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
        if (sql.includes("SELECT account_id, enabled_at")) return { rows: [{ account_id: accountId, enabled: scenario.enabled }] };
        if (sql.includes("SELECT 1 FROM account_recovery_codes")) return { rows: scenario.pending ? [{ ok: 1 }] : [] };
        if (sql.includes("INSERT INTO account_security_email_outbox")) return { rows: [{ account_id: accountId }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      });
      const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
      await expect(service.acknowledgeRecoveryCodes(accountId, authorization)).resolves.toBe(scenario.expected);
      expect(test.statements).toContainEqual(expect.objectContaining({ sql: scenario.transaction }));
      expect(test.release).toHaveBeenCalledOnce();
      if (!scenario.pending) {
        expect(test.statements.some(({ sql }) => sql.includes("INSERT INTO account_security_email_outbox"))).toBe(false);
      }
    }
  });

  it("desactiva TOTP de forma transaccional y rechaza errores al registrar el aviso", async () => {
    const test = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("DELETE FROM account_totp_factors")) return { rows: [{ account_id: accountId }] };
      if (sql.includes("INSERT INTO account_security_email_outbox")) return { rows: [{ account_id: accountId }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    await expect(service.disableTotp(accountId, authorization)).resolves.toBe(true);
    expect(test.statements.some(({ sql }) => sql.includes("DELETE FROM account_recovery_codes"))).toBe(true);
    expect(test.statements.some(({ sql, values }) => sql.includes("UPDATE account_sessions") && values?.[0] === accountId)).toBe(true);
    expect(test.statements.find(({ sql }) => sql.includes("INSERT INTO account_security_email_outbox"))?.values?.[1]).toBe("totp_disabled");
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));

    const failed = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("DELETE FROM account_totp_factors")) return { rows: [{ account_id: accountId }] };
      if (sql.includes("INSERT INTO account_security_email_outbox")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    await expect(new AccountMfaService(failed.pool, encryptionKey, recoveryPepper).disableTotp(accountId, authorization)).rejects.toThrow("No se pudo registrar el aviso");
    expect(failed.statements).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(failed.release).toHaveBeenCalledOnce();
  });

  it("consume un TOTP una sola vez antes de completar el flujo MFA", async () => {
    const envelope = encryptTotpSecret(secret, encryptionKey, accountId);
    const counter = Math.floor(Date.now() / 30_000);
    const test = testPool((sql) => {
      if (sql.includes("FROM native_auth_flows f JOIN accounts")) {
        return { rows: [{ id: "flow-1", account_id: accountId, redirect_uri: "http://127.0.0.1:49152/callback", state: "s".repeat(43), code_challenge: "c".repeat(43), attempts: 0 }] };
      }
      if (sql.includes("FROM account_totp_factors")) return { rows: [{ encrypted_secret: envelope, last_used_counter: String(counter - 1) }] };
      if (sql.includes("SET last_used_counter")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
    await expect(service.completeMfaLogin({
      cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64), email: " USER@EXAMPLE.TEST ",
      proof: totpCode(secret, counter), codeDigest: "d".repeat(64),
    })).resolves.toEqual({ redirectUri: "http://127.0.0.1:49152/callback", state: "s".repeat(43) });
    expect(test.statements.some(({ sql }) => sql.includes("INSERT INTO native_authorization_codes"))).toBe(true);
    expect(test.statements.some(({ sql }) => sql.includes("SET consumed_at = now()"))).toBe(true);
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));
    expect(test.release).toHaveBeenCalledOnce();
  });

  it("permite un código de recuperación de un solo uso y limita pruebas inválidas", async () => {
    const code = createRecoveryCodes(1)[0]!;
    const envelope = encryptTotpSecret(secret, encryptionKey, accountId);
    const run = async (attempts: number, proof: string, consumedRows: number) => {
      const test = testPool((sql) => {
        if (sql.includes("FROM native_auth_flows f JOIN accounts")) {
          return { rows: [{ id: "flow-1", account_id: accountId, redirect_uri: "http://127.0.0.1:49152/callback", state: "s".repeat(43), code_challenge: "c".repeat(43), attempts }] };
        }
        if (sql.includes("FROM account_totp_factors")) return { rows: [{ encrypted_secret: envelope, last_used_counter: String(Math.floor(Date.now() / 30_000) + 1) }] };
        if (sql.includes("UPDATE account_recovery_codes")) return { rows: consumedRows ? [{ account_id: accountId }] : [], rowCount: consumedRows };
        return { rows: [], rowCount: 1 };
      });
      const service = new AccountMfaService(test.pool, encryptionKey, recoveryPepper);
      const result = await service.completeMfaLogin({
        cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64), email: "user@example.test", proof,
        codeDigest: "d".repeat(64),
      });
      return { result, test };
    };

    const accepted = await run(0, code, 1);
    expect(accepted.result).toEqual({ redirectUri: "http://127.0.0.1:49152/callback", state: "s".repeat(43) });
    expect(accepted.test.statements.some(({ sql }) => sql.includes("UPDATE account_recovery_codes"))).toBe(true);

    const rejected = await run(4, "not-a-recovery-code", 0);
    expect(rejected.result).toBeNull();
    expect(rejected.test.statements.find(({ sql }) => sql.includes("UPDATE native_auth_flows SET attempts"))?.values?.[1]).toBe(5);
    expect(rejected.test.statements.some(({ sql }) => sql.includes("consumed_at = CASE WHEN $2::smallint >= 5"))).toBe(true);
    expect(rejected.test.statements).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));
  });

  it("devuelve null cuando no existe un flujo MFA pendiente para los tokens válidos", async () => {
    const test = testPool(() => ({ rows: [] }));
    await expect(new AccountMfaService(test.pool, encryptionKey, recoveryPepper)
      .pendingMfaLoginAccountId(token, "c".repeat(43), "user@example.test"))
      .resolves.toBeNull();
  });

  it("mantiene defensas internas para sesión ausente o revocada durante la transacción", async () => {
    type MfaInternals = {
      assertRecentSession(client: PoolClient, id: string, header: string | undefined): Promise<boolean>;
      revokeOtherSessions(client: PoolClient, id: string, header: string | undefined): Promise<void>;
    };
    const client = { query: vi.fn(async () => ({ rows: [] })) } as unknown as PoolClient;
    const service = new AccountMfaService({} as Pool, encryptionKey, recoveryPepper) as unknown as MfaInternals;
    await expect(service.assertRecentSession(client, accountId, undefined)).resolves.toBe(false);
    await expect(service.revokeOtherSessions(client, accountId, undefined)).rejects.toThrow("La sesión actual no es válida.");
    await expect(service.revokeOtherSessions(client, accountId, authorization)).rejects.toThrow("La sesión actual no es válida o ha caducado.");
  });

  it("revierte el acuse si no puede guardar el aviso de seguridad", async () => {
    const test = testPool((sql) => {
      if (sql.includes("FROM account_sessions")) return { rows: [{ ok: 1 }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("SELECT account_id, enabled_at")) return { rows: [{ account_id: accountId, enabled: false }] };
      if (sql.includes("SELECT 1 FROM account_recovery_codes")) return { rows: [{ ok: 1 }] };
      if (sql.includes("INSERT INTO account_security_email_outbox")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    await expect(new AccountMfaService(test.pool, encryptionKey, recoveryPepper).acknowledgeRecoveryCodes(accountId, authorization))
      .rejects.toThrow("No se pudo registrar el aviso");
    expect(test.statements).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(test.release).toHaveBeenCalledOnce();
  });
});
