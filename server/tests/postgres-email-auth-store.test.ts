import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresEmailAuthStore } from "../src/postgres-email-auth-store.js";

function fakePool(respond: (sql: string, values?: unknown[]) => { rows: unknown[] }) {
  const queries: string[] = [];
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    queries.push(sql);
    return respond(sql, values);
  });
  const client = { query, release };
  return {
    pool: { query, connect: async () => client } as unknown as Pool,
    queries,
    release,
  };
}

const digest = createHmac("sha256", "test-pepper")
  .update("email-verification\0user@example.test\0")
  .update("012345")
  .digest("hex");
const resetDigest = createHmac("sha256", "test-pepper")
  .update("password-reset\0user@example.test\0")
  .update("012345")
  .digest("hex");

describe("almacén PostgreSQL de autenticación por correo", () => {
  it("crea cuentas con queries parametrizadas y devuelve null si el email ya existe", async () => {
    const created = fakePool(() => ({ rows: [{ id: "account-1" }] }));
    const store = new PostgresEmailAuthStore(created.pool);
    await expect(store.createUnverifiedAccount({ displayName: "A", email: "a@example.test", passwordHash: "argon" }))
      .resolves.toEqual({ id: "account-1" });
    expect(created.queries[0]).toContain("ON CONFLICT (lower(email)) DO NOTHING");

    const existing = fakePool(() => ({ rows: [] }));
    await expect(new PostgresEmailAuthStore(existing.pool).createUnverifiedAccount({ displayName: "A", email: "a@example.test", passwordHash: "argon" }))
      .resolves.toBeNull();
  });

  it("emite un challenge de cinco minutos y consume el anterior bajo bloqueo de cuenta", async () => {
    const test = fakePool((sql) => {
      if (sql.includes("FROM accounts")) return { rows: [{ id: "account-1", display_name: "A" }] };
      if (sql.includes("FROM email_verification_codes")) return { rows: [{ recent_count: "0", cooldown: false }] };
      if (sql.includes("INSERT INTO email_verification_codes")) return { rows: [{ id: "challenge-1" }] };
      return { rows: [] };
    });
    const store = new PostgresEmailAuthStore(test.pool);
    await expect(store.createVerification("user@example.test", digest)).resolves.toEqual({
      accountId: "account-1", displayName: "A", challengeId: "challenge-1",
    });
    expect(test.queries[0]).toBe("BEGIN");
    expect(test.queries.some((sql) => sql.includes("FOR UPDATE"))).toBe(true);
    expect(test.queries.some((sql) => sql.includes("SET consumed_at = now()"))).toBe(true);
    expect(test.queries).toContain("COMMIT");
    expect(test.release).toHaveBeenCalledOnce();
  });

  it("no emite PIN para una cuenta inexistente, verificada o bajo cooldown/límite", async () => {
    const noAccount = fakePool(() => ({ rows: [] }));
    await expect(new PostgresEmailAuthStore(noAccount.pool).createVerification("missing@example.test", digest)).resolves.toBeNull();

    const throttled = fakePool((sql) => {
      if (sql.includes("FROM accounts")) return { rows: [{ id: "account-1", display_name: "A" }] };
      return { rows: [{ recent_count: "3", cooldown: true }] };
    });
    await expect(new PostgresEmailAuthStore(throttled.pool).createVerification("user@example.test", digest)).resolves.toBeNull();
    expect(throttled.queries.some((sql) => sql.includes("INSERT INTO email_verification_codes"))).toBe(false);

    const cooldownOnly = fakePool((sql) => sql.includes("FROM accounts")
      ? { rows: [{ id: "account-1", display_name: "A" }] }
      : { rows: [{ recent_count: "1", cooldown: true }] });
    await expect(new PostgresEmailAuthStore(cooldownOnly.pool).createVerification("user@example.test", digest)).resolves.toBeNull();
  });

  it("rechaza intentos erróneos y consume el challenge al quinto intento", async () => {
    const test = fakePool((sql) => {
      if (sql.includes("FROM accounts")) return { rows: [{ id: "account-1", email_verified_at: null }] };
      if (sql.includes("FROM email_verification_codes")) return { rows: [{ id: "challenge-1", verifier_digest: digest, attempts: 4, is_expired: false }] };
      return { rows: [] };
    });
    await expect(new PostgresEmailAuthStore(test.pool).verifyEmail("user@example.test", "f".repeat(64))).resolves.toBe(false);
    expect(test.queries.some((sql) => sql.includes("attempts = $2, consumed_at = CASE WHEN $2 >= 5"))).toBe(true);
    expect(test.queries).toContain("COMMIT");
  });

  it("verifica el PIN una sola vez y marca correo en la misma transacción", async () => {
    const test = fakePool((sql) => {
      if (sql.includes("FROM accounts")) return { rows: [{ id: "account-1", email_verified_at: null }] };
      if (sql.includes("FROM email_verification_codes")) return { rows: [{ id: "challenge-1", verifier_digest: digest, attempts: 0, is_expired: false }] };
      return { rows: [] };
    });
    await expect(new PostgresEmailAuthStore(test.pool).verifyEmail("user@example.test", digest)).resolves.toBe(true);
    expect(test.queries.some((sql) => sql.includes("UPDATE accounts SET email_verified_at"))).toBe(true);
    expect(test.queries).toContain("COMMIT");
  });

  it("rechaza PIN ausente/caducado y deja una cuenta ya verificada en estado idempotente", async () => {
    const noAccount = fakePool(() => ({ rows: [] }));
    await expect(new PostgresEmailAuthStore(noAccount.pool).verifyEmail("missing@example.test", digest)).resolves.toBe(false);

    const verified = fakePool((sql) => sql.includes("FROM accounts")
      ? { rows: [{ id: "account-1", email_verified_at: new Date() }] }
      : { rows: [] });
    await expect(new PostgresEmailAuthStore(verified.pool).verifyEmail("user@example.test", digest)).resolves.toBe(true);

    const absentCode = fakePool((sql) => sql.includes("FROM accounts")
      ? { rows: [{ id: "account-1", email_verified_at: null }] }
      : { rows: [] });
    await expect(new PostgresEmailAuthStore(absentCode.pool).verifyEmail("user@example.test", digest)).resolves.toBe(false);

    const expired = fakePool((sql) => sql.includes("FROM accounts")
      ? { rows: [{ id: "account-1", email_verified_at: null }] }
      : sql.includes("FROM email_verification_codes")
        ? { rows: [{ id: "challenge-1", verifier_digest: digest, attempts: 0, is_expired: true }] }
        : { rows: [] });
    await expect(new PostgresEmailAuthStore(expired.pool).verifyEmail("user@example.test", digest)).resolves.toBe(false);
    expect(expired.queries.some((sql) => sql.includes("UPDATE email_verification_codes SET consumed_at"))).toBe(true);
  });

  it("revierte transacciones si PostgreSQL falla", async () => {
    const test = fakePool((sql) => {
      if (sql.includes("FROM accounts")) throw new Error("database internal detail");
      return { rows: [] };
    });
    await expect(new PostgresEmailAuthStore(test.pool).verifyEmail("user@example.test", digest)).rejects.toThrow("database internal detail");
    expect(test.queries).toContain("ROLLBACK");
    expect(test.release).toHaveBeenCalledOnce();
  });

  it("crea PIN de restablecimiento limitado por cuenta y no emite para cuentas desconocidas", async () => {
    const test = fakePool((sql) => {
      if (sql.includes("FROM accounts")) return { rows: [{ id: "account-1", display_name: "A" }] };
      if (sql.includes("FROM account_password_reset_codes")) return { rows: [{ recent_count: "0", cooldown: false }] };
      if (sql.includes("INSERT INTO account_password_reset_codes")) return { rows: [{ id: "reset-1" }] };
      return { rows: [] };
    });
    await expect(new PostgresEmailAuthStore(test.pool).createPasswordReset("user@example.test", resetDigest)).resolves.toEqual({
      accountId: "account-1", displayName: "A", challengeId: "reset-1",
    });
    expect(test.queries.some((sql) => sql.includes("interval '5 minutes'"))).toBe(true);
    expect(test.queries.some((sql) => sql.includes("FOR UPDATE"))).toBe(true);

    const missing = fakePool(() => ({ rows: [] }));
    await expect(new PostgresEmailAuthStore(missing.pool).createPasswordReset("missing@example.test", resetDigest)).resolves.toBeNull();
  });

  it("cuenta PIN incorrectos y consume el challenge en el quinto intento", async () => {
    const test = fakePool((sql) => sql.includes("FROM accounts")
      ? { rows: [{ id: "account-1" }] }
      : { rows: [{ id: "reset-1", verifier_digest: resetDigest, attempts: 4, is_expired: false }] });
    await expect(new PostgresEmailAuthStore(test.pool).checkPasswordReset("user@example.test", "f".repeat(64))).resolves.toBe(false);
    expect(test.queries.some((sql) => sql.includes("attempts = $2, consumed_at = CASE WHEN $2 >= 5"))).toBe(true);
    expect(test.queries).toContain("COMMIT");
  });

  it("cambia contraseña, consume todos los PINs y revoca sesiones en una transacción", async () => {
    const test = fakePool((sql) => sql.includes("FROM accounts")
      ? { rows: [{ id: "account-1" }] }
      : { rows: [{ id: "reset-1", verifier_digest: resetDigest, attempts: 0, is_expired: false }] });
    await expect(new PostgresEmailAuthStore(test.pool).resetPassword("user@example.test", resetDigest, "argon2-hash"))
      .resolves.toBe(true);
    expect(test.queries.some((sql) => sql.includes("UPDATE accounts SET password_hash"))).toBe(true);
    expect(test.queries.some((sql) => sql.includes("UPDATE account_sessions SET revoked_at"))).toBe(true);
    expect(test.queries.at(-1)).toBe("COMMIT");
  });
});
