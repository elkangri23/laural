import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresNativeAuthStore } from "../src/postgres-native-auth-store.js";

function fakePool(respond: (sql: string, values?: unknown[]) => { rows: unknown[] }) {
  const queries: string[] = [];
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    queries.push(sql);
    return respond(sql, values);
  });
  const client = { query, release };
  return { pool: { query, connect: async () => client } as unknown as Pool, queries, release };
}

const flow = {
  redirect_uri: "http://127.0.0.1:49152/callback",
  state: "state-value",
  code_challenge: "c".repeat(43),
};

describe("almacén PostgreSQL de autenticación nativa", () => {
  it("guarda el challenge con hashes y devuelve el estado de flow activo", async () => {
    const test = fakePool(() => ({ rows: [{ id: "flow-id" }] }));
    const store = new PostgresNativeAuthStore(test.pool);
    await store.createFlow({
      redirectUri: flow.redirect_uri, state: flow.state, codeChallenge: flow.code_challenge,
      cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64),
    });
    expect(test.queries[0]).toContain("now() + interval '10 minutes'");
    expect(await store.isFlowActive("a".repeat(64), "b".repeat(64))).toBe(true);
  });

  it("carga el flujo y credenciales de cuenta con parámetros separados", async () => {
    const test = fakePool((sql) => sql.includes("FROM native_auth_flows")
      ? { rows: [{ id: "flow-id", ...flow }] }
      : { rows: [{ id: "account-id", password_hash: "argon-hash", email_verified_at: new Date() }] });
    const store = new PostgresNativeAuthStore(test.pool);
    await expect(store.findLoginCandidate("cookie", "csrf", "user@example.test")).resolves.toEqual({
      flowId: "flow-id", redirectUri: flow.redirect_uri, state: flow.state,
      codeChallenge: flow.code_challenge, accountId: "account-id", passwordHash: "argon-hash", emailVerified: true, mfaEnabled: false,
    });
    expect(test.queries).toHaveLength(2);

    const noAccount = fakePool((sql) => sql.includes("FROM native_auth_flows")
      ? { rows: [{ id: "flow-id", ...flow }] }
      : { rows: [] });
    await expect(new PostgresNativeAuthStore(noAccount.pool).findLoginCandidate("cookie", "csrf", "unknown@example.test"))
      .resolves.toMatchObject({ accountId: null, passwordHash: null, emailVerified: false, mfaEnabled: false });
    expect(test.queries[1]).toContain("account_totp_factors");
  });

  it("no devuelve credenciales si el flow ya expiró o no coincide", async () => {
    const test = fakePool(() => ({ rows: [] }));
    const store = new PostgresNativeAuthStore(test.pool);
    expect(await store.isFlowActive("cookie", "csrf")).toBe(false);
    await expect(store.findLoginCandidate("cookie", "csrf", "user@example.test")).resolves.toBeNull();
  });

  it("consume los intentos de login en una transacción y revoca el flow al quinto", async () => {
    const test = fakePool((sql) => sql.includes("SELECT id, attempts FROM native_auth_flows")
      ? { rows: [{ id: "flow-id", attempts: 4 }] }
      : { rows: [] });
    await new PostgresNativeAuthStore(test.pool).failLogin("cookie", "csrf");
    expect(test.queries.some((sql) => sql.includes("consumed_at = CASE WHEN $2 >= 5"))).toBe(true);
    expect(test.queries).toContain("COMMIT");

    const absent = fakePool(() => ({ rows: [] }));
    await new PostgresNativeAuthStore(absent.pool).failLogin("cookie", "csrf");
    expect(absent.queries).toContain("COMMIT");
  });

  it("guarda el código de un solo uso y consume el flujo al autenticar", async () => {
    const test = fakePool((sql) => {
      if (sql.includes("FROM native_auth_flows")) return { rows: [flow] };
      if (sql.includes("FROM accounts")) return { rows: [{ id: "account-id" }] };
      return { rows: [] };
    });
    const store = new PostgresNativeAuthStore(test.pool);
    await expect(store.completeLogin({
      flowId: "flow-id", cookieDigest: "cookie-hash", csrfDigest: "csrf-hash",
      accountId: "account-id", codeDigest: "code-hash",
    })).resolves.toEqual({ redirectUri: flow.redirect_uri, state: flow.state });
    expect(test.queries.some((sql) => sql.includes("interval '2 minutes'"))).toBe(true);
    expect(test.queries.some((sql) => sql.includes("UPDATE native_auth_flows SET consumed_at"))).toBe(true);
    expect(test.queries).toContain("COMMIT");
  });

  it("deniega flujos agotados y cuentas no verificadas", async () => {
    const noFlow = fakePool(() => ({ rows: [] }));
    await expect(new PostgresNativeAuthStore(noFlow.pool).completeLogin({
      flowId: "flow-id", cookieDigest: "cookie", csrfDigest: "csrf", accountId: "account-id", codeDigest: "code",
    })).resolves.toBeNull();
    expect(noFlow.queries).toContain("ROLLBACK");

    const unverified = fakePool((sql) => sql.includes("FROM native_auth_flows")
      ? { rows: [flow] }
      : { rows: [] });
    await expect(new PostgresNativeAuthStore(unverified.pool).completeLogin({
      flowId: "flow-id", cookieDigest: "cookie", csrfDigest: "csrf", accountId: "account-id", codeDigest: "code",
    })).resolves.toBeNull();
    expect(unverified.queries).toContain("ROLLBACK");
  });

  it("intercambia un código válido una sola vez y guarda solo hash del token de sesión", async () => {
    const challenge = createHash("sha256").update("v".repeat(43)).digest("base64url");
    const test = fakePool((sql) => sql.includes("FROM native_authorization_codes")
      ? { rows: [{ id: "code-id", account_id: "account-id", code_challenge: challenge, attempts: 0 }] }
      : sql.includes("RETURNING expires_at")
        ? { rows: [{ expires_at: new Date("2026-12-01T00:00:00.000Z") }] }
        : { rows: [] });
    await expect(new PostgresNativeAuthStore(test.pool).exchangeCode("code-hash", challenge, "session-hash"))
      .resolves.toEqual(new Date("2026-12-01T00:00:00.000Z"));
    expect(test.queries.some((sql) => sql.includes("interval '30 days'"))).toBe(true);
    expect(test.queries.some((sql) => sql.includes("UPDATE native_authorization_codes SET consumed_at"))).toBe(true);
  });

  it("rechaza challenge incorrecto y códigos inexistentes o caducados", async () => {
    const invalid = fakePool((sql) => sql.includes("FROM native_authorization_codes")
      ? { rows: [{ id: "code-id", account_id: "account-id", code_challenge: "expected", attempts: 0 }] }
      : { rows: [] });
    await expect(new PostgresNativeAuthStore(invalid.pool).exchangeCode("code-hash", "wrong", "session-hash")).resolves.toBeNull();
    expect(invalid.queries.some((sql) => sql.includes("attempts = $2, consumed_at = CASE WHEN $2 >= 5"))).toBe(true);

    const absent = fakePool(() => ({ rows: [] }));
    await expect(new PostgresNativeAuthStore(absent.pool).exchangeCode("missing", "challenge", "session-hash")).resolves.toBeNull();
    expect(absent.queries).toContain("COMMIT");
  });

  it("revierte errores de base de datos y libera la conexión", async () => {
    const test = fakePool((sql) => {
      if (sql.includes("FROM native_authorization_codes")) throw new Error("private database error");
      return { rows: [] };
    });
    await expect(new PostgresNativeAuthStore(test.pool).exchangeCode("code", "challenge", "token"))
      .rejects.toThrow("private database error");
    expect(test.queries).toContain("ROLLBACK");
    expect(test.release).toHaveBeenCalledOnce();
  });
});
