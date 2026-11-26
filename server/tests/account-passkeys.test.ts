import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

const webauthn = vi.hoisted(() => ({
  generateAuthenticationOptions: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));
vi.mock("@simplewebauthn/server", () => webauthn);

import { AccountPasskeyService } from "../src/account-passkeys.js";
import type { PasskeyConfig } from "../src/config.js";

const config: PasskeyConfig = { rpName: "Laural", rpId: "sync.example.test", origin: "https://sync.example.test" };
const accountId = "account-id";
const cookie = "a".repeat(43);
const csrf = "b".repeat(43);
const credentialResponse = {
  id: "Y3JlZC1pZA", rawId: "Y3JlZC1pZA", type: "public-key",
  response: { authenticatorData: "YQ", clientDataJSON: "YQ", signature: "YQ", userHandle: Buffer.from(accountId).toString("base64url") },
} as never;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createPool(handler: (sql: string, values?: unknown[]) => { rows?: unknown[]; rowCount?: number } = () => ({ rows: [] })) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    queries.push({ sql, values });
    return { rows: [], rowCount: null, ...handler(sql, values) };
  });
  const client = { query, release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, queries, query, client };
}

beforeEach(() => {
  webauthn.generateAuthenticationOptions.mockReset().mockResolvedValue({ challenge: "login-challenge" });
  webauthn.generateRegistrationOptions.mockReset().mockResolvedValue({ challenge: "registration-challenge" });
  webauthn.verifyAuthenticationResponse.mockReset().mockResolvedValue({
    verified: true,
    authenticationInfo: { newCounter: 3 },
  });
  webauthn.verifyRegistrationResponse.mockReset().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: { id: "credential-id", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] },
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true,
    },
  });
});

describe("gestión y login de passkeys", () => {
  it("emite ticket solo con sesión reciente y almacena su hash", async () => {
    const { pool, queries } = createPool((sql) => sql.includes("FROM account_sessions") ? { rows: [{ ok: 1 }] } : { rows: [] });
    const service = new AccountPasskeyService(pool, config);

    const ticket = await service.createManagementTicket(accountId, `Bearer ${cookie}`);

    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(queries[0]?.sql).toContain("created_at > now() - interval '10 minutes'");
    expect(queries[0]?.values?.[1]).toBe(digest(cookie));
    expect(queries[1]?.sql).toContain("INSERT INTO passkey_management_tickets");
    expect(queries[1]?.values).toEqual([digest(ticket), accountId]);
    expect(service.managementUrl(ticket)).toBe(`https://sync.example.test/auth/passkeys/manage#ticket=${ticket}`);
    expect(JSON.stringify(queries)).not.toContain(ticket);
  });

  it("no emite ticket para sesiones antiguas ni tokens de formato incorrecto", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const service = new AccountPasskeyService({ query } as unknown as Pool, config);
    await expect(service.createManagementTicket(accountId, "Bearer invalid")).resolves.toBeNull();
    await expect(service.createManagementTicket(accountId, `Bearer ${cookie}`)).resolves.toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });

  it("canjea ticket una sola vez y enlaza una sesión de gestión con CSRF", async () => {
    const { pool, queries, client } = createPool((sql) => sql.includes("UPDATE passkey_management_tickets") ? { rows: [{ account_id: accountId }] } : { rows: [] });
    const service = new AccountPasskeyService(pool, config);
    const session = await service.consumeManagementTicket("c".repeat(43));

    expect(session?.cookieToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(session?.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(queries[1]?.values?.[0]).toBe(digest("c".repeat(43)));
    expect(queries[2]?.values).toEqual([digest(session!.cookieToken), digest(session!.csrfToken), accountId]);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("genera y verifica login discoverable, ligado al flujo y user handle", async () => {
    const { pool, queries } = createPool((sql) => {
      if (sql.includes("SELECT id FROM native_auth_flows")) return { rows: [{ id: "flow-1" }] };
      if (sql.includes("UPDATE passkey_login_challenges")) return { rows: [{ flow_id: "flow-1", challenge: "login-challenge" }] };
      if (sql.includes("FROM account_passkeys p JOIN accounts")) return { rows: [{
        id: "key-1", account_id: accountId, credential_id: "Y3JlZC1pZA", public_key: Buffer.from([4, 5]), sign_count: "2", transports: ["internal"],
      }] };
      return { rows: [] };
    });
    const service = new AccountPasskeyService(pool, config);
    const options = await service.createLoginOptions(cookie, csrf);
    const result = await service.verifyLogin(cookie, csrf, credentialResponse);

    expect(options).toEqual({ challenge: "login-challenge" });
    expect(webauthn.generateAuthenticationOptions).toHaveBeenCalledWith(expect.objectContaining({ rpID: config.rpId, userVerification: "required" }));
    expect(webauthn.verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedChallenge: "login-challenge", expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: true,
    }));
    expect(result).toEqual({ accountId });
    expect(queries.at(-2)?.sql).toContain("UPDATE account_passkeys SET sign_count");
  });

  it("rechaza respuesta, user handle, credencial y firma inválidos", async () => {
    const { pool } = createPool((sql) => {
      if (sql.includes("UPDATE passkey_login_challenges")) return { rows: [{ flow_id: "flow-1", challenge: "challenge" }] };
      if (sql.includes("FROM account_passkeys p JOIN accounts")) return { rows: [{ id: "key", account_id: accountId, credential_id: "id", public_key: Buffer.from([1]), sign_count: "0", transports: [] }] };
      return { rows: [] };
    });
    const service = new AccountPasskeyService(pool, config);
    await expect(service.verifyLogin("bad", csrf, credentialResponse)).resolves.toBeNull();
    await expect(service.verifyLogin(cookie, csrf, { ...credentialResponse, response: { ...credentialResponse.response, userHandle: "d3Jvbmc" } })).resolves.toBeNull();
    webauthn.verifyAuthenticationResponse.mockRejectedValueOnce(new Error("invalid signature"));
    await expect(service.verifyLogin(cookie, csrf, credentialResponse)).resolves.toBeNull();
    webauthn.verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false });
    await expect(service.verifyLogin(cookie, csrf, credentialResponse)).resolves.toBeNull();
  });

  it("crea opciones y guarda passkey tras verificarla, serializando el máximo por cuenta", async () => {
    const now = new Date("2026-11-23T10:00:00.000Z");
    const { pool, queries } = createPool((sql) => {
      if (sql.includes("SELECT account_id FROM passkey_management_sessions")) return { rows: [{ account_id: accountId }] };
      if (sql.includes("SELECT a.id, a.email")) return { rows: [{ id: accountId, email: "user@example.test" }] };
      if (sql.includes("SELECT credential_id, transports")) return { rows: [] };
      if (sql.includes("UPDATE passkey_management_challenges")) return { rows: [{ account_id: accountId, challenge: "registration-challenge", display_name: "Portátil" }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("SELECT count(*)")) return { rows: [{ count: "0" }] };
      if (sql.includes("SELECT id, display_name")) return { rows: [{ id: "key-id", display_name: "Portátil", created_at: now, last_used_at: null }] };
      if (sql.startsWith("DELETE FROM account_passkeys")) return { rows: [{ id: "key-id" }], rowCount: 1 };
      if (sql.includes("INSERT INTO account_security_email_outbox")) return { rows: [], rowCount: 1 };
      return { rows: [] };
    });
    const service = new AccountPasskeyService(pool, config);
    const options = await service.createRegistrationOptions(cookie, csrf, "Portátil");
    const registered = await service.verifyRegistration(cookie, csrf, {
      id: "Y3JlZA", rawId: "Y3JlZA", type: "public-key", response: { attestationObject: "YQ", clientDataJSON: "YQ" },
    } as never);
    const list = await service.listManagementPasskeys(cookie, csrf);
    const removed = await service.removeManagementPasskey(cookie, csrf, "00000000-0000-4000-8000-000000000001");

    expect(options).toEqual({ challenge: "registration-challenge" });
    expect(webauthn.generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    }));
    expect(registered).toBe(true);
    expect(queries.some(({ sql }) => sql.includes("FOR UPDATE"))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes("INSERT INTO account_passkeys"))).toBe(true);
    expect(queries.find(({ sql }) => sql.includes("INSERT INTO account_security_email_outbox"))?.values).toEqual([accountId, "passkey_added"]);
    expect(list).toEqual([{ id: "key-id", name: "Portátil", createdAt: now.toISOString(), lastUsedAt: null }]);
    expect(removed).toBe(true);
    expect(queries.find(({ sql, values }) => sql.includes("INSERT INTO account_security_email_outbox") && values?.[1] === "passkey_removed")?.values).toEqual([accountId, "passkey_removed"]);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("rechaza sesión/CSRF caducados, entradas inseguras y el límite de credenciales", async () => {
    const { pool } = createPool((sql) => {
      if (sql.includes("SELECT account_id FROM passkey_management_sessions")) return { rows: [] };
      if (sql.includes("SELECT a.id, a.email")) return { rows: [{ id: accountId, email: "user@example.test" }] };
      if (sql.includes("SELECT credential_id, transports")) return { rows: Array.from({ length: 10 }, () => ({ credential_id: "key", transports: [] })) };
      if (sql.includes("UPDATE passkey_management_challenges")) return { rows: [{ account_id: accountId, challenge: "challenge", display_name: "Nombre" }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("SELECT count(*)")) return { rows: [{ count: "10" }] };
      return { rows: [] };
    });
    const service = new AccountPasskeyService(pool, config);
    await expect(service.createLoginOptions("bad", csrf)).resolves.toBeNull();
    await expect(service.createRegistrationOptions(cookie, csrf, "\nXSS")).resolves.toBeNull();
    await expect(service.createRegistrationOptions(cookie, csrf, "Nombre")).resolves.toBeNull();
    await expect(service.listManagementPasskeys(cookie, csrf)).resolves.toBeNull();
    await expect(service.removeManagementPasskey(cookie, csrf, "../../otra-cuenta")).resolves.toBe(false);
    await expect(service.removeManagementPasskey(cookie, csrf, "00000000-0000-4000-8000-000000000001")).resolves.toBe(false);
    webauthn.verifyRegistrationResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo: { credential: { id: "credential-id", publicKey: new Uint8Array([1]), counter: 0 }, credentialDeviceType: "singleDevice", credentialBackedUp: false },
    });
    await expect(service.verifyRegistration(cookie, csrf, { id: "YQ", rawId: "YQ", type: "public-key", response: { attestationObject: "YQ", clientDataJSON: "YQ" } } as never)).resolves.toBe(false);
  });

  it("consume retos inválidos, trata credenciales duplicadas sin filtrar errores y libera conexiones", async () => {
    const validRegistration = {
      id: "YQ", rawId: "YQ", type: "public-key",
      response: { attestationObject: "YQ", clientDataJSON: "YQ" },
    } as never;
    const initial = createPool((sql) => sql.includes("UPDATE passkey_management_challenges")
      ? { rows: [{ account_id: accountId, challenge: "registration-challenge", display_name: "Passkey" }] }
      : sql.includes("SELECT id FROM accounts") ? { rows: [{ id: accountId }] }
        : sql.includes("SELECT count(*)") ? { rows: [{ count: "0" }] }
          : { rows: [] });
    const failed = new AccountPasskeyService(initial.pool, config);
    webauthn.verifyRegistrationResponse.mockResolvedValueOnce({ verified: false });
    await expect(failed.verifyRegistration(cookie, csrf, validRegistration)).resolves.toBe(false);
    await expect(failed.consumeManagementTicket("short")).resolves.toBeNull();
    expect(initial.client.release).toHaveBeenCalledOnce();

    const duplicate = createPool((sql) => {
      if (sql.includes("UPDATE passkey_management_challenges")) return { rows: [{ account_id: accountId, challenge: "registration-challenge", display_name: "Passkey" }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("SELECT count(*)")) return { rows: [{ count: "0" }] };
      if (sql.includes("INSERT INTO account_passkeys")) throw Object.assign(new Error("duplicate credential"), { code: "23505" });
      return { rows: [] };
    });
    await expect(new AccountPasskeyService(duplicate.pool, config).verifyRegistration(cookie, csrf, validRegistration)).resolves.toBe(false);
    expect(duplicate.queries.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rechaza todos los campos WebAuthn fuera del formato acotado", async () => {
    const service = new AccountPasskeyService({ query: vi.fn() } as unknown as Pool, config);
    const validAuth = { ...credentialResponse, response: { ...credentialResponse.response } };
    const invalidAuth = [
      null,
      { ...validAuth, type: "other" },
      { ...validAuth, id: "bad id" },
      { ...validAuth, rawId: "different" },
      { ...validAuth, response: null },
      { ...validAuth, response: { ...validAuth.response, signature: "!" } },
      { ...validAuth, response: { ...validAuth.response, userHandle: "!" } },
    ];
    for (const response of invalidAuth) await expect(service.verifyLogin(cookie, csrf, response as never)).resolves.toBeNull();
    const invalidRegistration = [
      null,
      { id: "YQ", rawId: "YQ", type: "other", response: {} },
      { id: "YQ", rawId: "Yg", type: "public-key", response: {} },
      { id: "YQ", rawId: "YQ", type: "public-key", response: null },
      { id: "YQ", rawId: "YQ", type: "public-key", response: { attestationObject: "!", clientDataJSON: "YQ" } },
    ];
    for (const response of invalidRegistration) await expect(service.verifyRegistration(cookie, csrf, response as never)).resolves.toBe(false);

    const pool = createPool((sql) => sql.includes("UPDATE passkey_management_challenges")
      ? { rows: [{ account_id: accountId, challenge: "challenge", display_name: "Passkey" }] }
      : { rows: [] });
    webauthn.verifyRegistrationResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo: { credential: { id: "credential-id", publicKey: new Uint8Array([1]), counter: 0, transports: ["unknown"] }, credentialDeviceType: "singleDevice", credentialBackedUp: false },
    });
    await expect(new AccountPasskeyService(pool.pool, config).verifyRegistration(cookie, csrf, {
      id: "YQ", rawId: "YQ", type: "public-key", response: { attestationObject: "YQ", clientDataJSON: "YQ" },
    } as never)).resolves.toBe(false);
  });

  it("revierte la retirada si no puede registrar el aviso en la misma transacción", async () => {
    const pool = createPool((sql) => {
      if (sql.includes("SELECT account_id FROM passkey_management_sessions")) return { rows: [{ account_id: accountId }] };
      if (sql.startsWith("DELETE FROM account_passkeys")) return { rows: [{ id: "key-id" }], rowCount: 1 };
      if (sql.includes("INSERT INTO account_security_email_outbox")) return { rows: [], rowCount: 0 };
      return { rows: [] };
    });

    await expect(new AccountPasskeyService(pool.pool, config).removeManagementPasskey(
      cookie, csrf, "00000000-0000-4000-8000-000000000001",
    )).rejects.toThrow("No se pudo registrar el aviso de seguridad.");
    expect(pool.queries.at(-1)?.sql).toBe("ROLLBACK");
    expect(pool.client.release).toHaveBeenCalledOnce();
  });

  it("rechaza tickets usados o caducados y revierte fallos del canje", async () => {
    const expired = createPool(() => ({ rows: [] }));
    await expect(new AccountPasskeyService(expired.pool, config).consumeManagementTicket(cookie)).resolves.toBeNull();
    expect(expired.queries).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(expired.client.release).toHaveBeenCalledOnce();

    const broken = createPool((sql) => {
      if (sql.includes("UPDATE passkey_management_tickets")) throw new Error("ticket storage unavailable");
      return { rows: [] };
    });
    await expect(new AccountPasskeyService(broken.pool, config).consumeManagementTicket(cookie)).rejects.toThrow("ticket storage unavailable");
    expect(broken.queries).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(broken.client.release).toHaveBeenCalledOnce();
  });

  it("no genera opciones ni autentica cuando el flujo o reto ya no existe", async () => {
    const pool = createPool(() => ({ rows: [] }));
    const service = new AccountPasskeyService(pool.pool, config);
    await expect(service.createLoginOptions(cookie, csrf)).resolves.toBeNull();
    await expect(service.verifyLogin(cookie, csrf, credentialResponse)).resolves.toBeNull();
    expect(pool.queries).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(webauthn.generateAuthenticationOptions).not.toHaveBeenCalled();
    expect(webauthn.verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("excluye credenciales registradas al preparar otra passkey", async () => {
    const existing = [{ credential_id: "existing-key", transports: ["internal", "hybrid"] }];
    const pool = createPool((sql) => sql.includes("SELECT account_id FROM passkey_management_sessions")
      ? { rows: [{ account_id: accountId }] }
      : sql.includes("SELECT a.id, a.email") ? { rows: [{ id: accountId, email: "user@example.test" }] }
        : sql.includes("SELECT credential_id, transports") ? { rows: existing }
          : { rows: [] });
    await new AccountPasskeyService(pool.pool, config).createRegistrationOptions(cookie, csrf, "Llave secundaria");
    expect(webauthn.generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      excludeCredentials: [{ id: "existing-key", transports: ["internal", "hybrid"] }],
    }));
  });

  it("revierte login al fallar la consulta del reto", async () => {
    const pool = createPool((sql) => {
      if (sql.includes("UPDATE passkey_login_challenges")) throw new Error("challenge storage unavailable");
      return { rows: [] };
    });
    await expect(new AccountPasskeyService(pool.pool, config).verifyLogin(cookie, csrf, credentialResponse))
      .rejects.toThrow("challenge storage unavailable");
    expect(pool.queries).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(pool.client.release).toHaveBeenCalledOnce();
  });

  it("rechaza el alta si la cuenta desapareció o expiró la sesión de administración", async () => {
    const accountMissing = createPool((sql) => sql.includes("SELECT account_id FROM passkey_management_sessions")
      ? { rows: [{ account_id: accountId }] }
      : sql.includes("SELECT a.id, a.email") ? { rows: [] }
        : { rows: [] });
    await expect(new AccountPasskeyService(accountMissing.pool, config).createRegistrationOptions(cookie, csrf, "Portátil"))
      .resolves.toBeNull();
    expect(webauthn.generateRegistrationOptions).not.toHaveBeenCalled();

    const sessionExpired = createPool(() => ({ rows: [] }));
    await expect(new AccountPasskeyService(sessionExpired.pool, config).createRegistrationOptions(cookie, csrf, "Portátil"))
      .resolves.toBeNull();
    expect(sessionExpired.query).toHaveBeenCalledOnce();
  });

  it("rechaza retos de registro inexistentes y excepciones de verificación sin persistir credenciales", async () => {
    const registration = {
      id: "YQ", rawId: "YQ", type: "public-key",
      response: { attestationObject: "YQ", clientDataJSON: "YQ" },
    } as never;
    const absent = createPool(() => ({ rows: [] }));
    await expect(new AccountPasskeyService(absent.pool, config).verifyRegistration(cookie, csrf, registration)).resolves.toBe(false);
    expect(absent.queries).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));

    const thrown = createPool((sql) => sql.includes("UPDATE passkey_management_challenges")
      ? { rows: [{ account_id: accountId, challenge: "challenge", display_name: "Portátil" }] }
      : { rows: [] });
    webauthn.verifyRegistrationResponse.mockRejectedValueOnce(new Error("invalid attestation"));
    await expect(new AccountPasskeyService(thrown.pool, config).verifyRegistration(cookie, csrf, registration)).resolves.toBe(false);
    expect(thrown.queries).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));
    expect(thrown.queries.some(({ sql }) => sql.includes("INSERT INTO account_passkeys"))).toBe(false);
    expect(thrown.client.release).toHaveBeenCalledOnce();
  });

  it("no registra una passkey si la cuenta se borra antes de bloquearla", async () => {
    const pool = createPool((sql) => {
      if (sql.includes("UPDATE passkey_management_challenges")) return { rows: [{ account_id: accountId, challenge: "challenge", display_name: "Portátil" }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [] };
      if (sql.includes("SELECT count(*)")) return { rows: [{ count: "0" }] };
      return { rows: [], rowCount: 1 };
    });
    await expect(new AccountPasskeyService(pool.pool, config).verifyRegistration(cookie, csrf, {
      id: "YQ", rawId: "YQ", type: "public-key", response: { attestationObject: "YQ", clientDataJSON: "YQ" },
    } as never)).resolves.toBe(false);
    expect(pool.queries).toContainEqual(expect.objectContaining({ sql: "COMMIT" }));
    expect(pool.queries.some(({ sql }) => sql.includes("INSERT INTO account_passkeys"))).toBe(false);
  });

  it("trata un resultado de conteo vacío como cero durante el alta serializada", async () => {
    const pool = createPool((sql) => {
      if (sql.includes("UPDATE passkey_management_challenges")) return { rows: [{ account_id: accountId, challenge: "challenge", display_name: "Portátil" }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("SELECT count(*)")) return { rows: [] };
      if (sql.includes("INSERT INTO account_security_email_outbox")) return { rows: [{ account_id: accountId }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await expect(new AccountPasskeyService(pool.pool, config).verifyRegistration(cookie, csrf, {
      id: "YQ", rawId: "YQ", type: "public-key", response: { attestationObject: "YQ", clientDataJSON: "YQ" },
    } as never)).resolves.toBe(true);
    expect(pool.queries.some(({ sql }) => sql.includes("INSERT INTO account_passkeys"))).toBe(true);
  });

  it("propaga fallos inesperados de persistencia del registro tras revertir", async () => {
    const pool = createPool((sql) => {
      if (sql.includes("UPDATE passkey_management_challenges")) return { rows: [{ account_id: accountId, challenge: "challenge", display_name: "Portátil" }] };
      if (sql.includes("SELECT id FROM accounts")) return { rows: [{ id: accountId }] };
      if (sql.includes("SELECT count(*)")) return { rows: [{ count: "0" }] };
      if (sql.includes("INSERT INTO account_passkeys")) throw new Error("disk failure");
      return { rows: [], rowCount: 1 };
    });
    await expect(new AccountPasskeyService(pool.pool, config).verifyRegistration(cookie, csrf, {
      id: "YQ", rawId: "YQ", type: "public-key", response: { attestationObject: "YQ", clientDataJSON: "YQ" },
    } as never)).rejects.toThrow("disk failure");
    expect(pool.queries).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));
    expect(pool.client.release).toHaveBeenCalledOnce();
  });

  it("no elimina una passkey si la sesión expiró o la credencial no pertenece a la cuenta", async () => {
    const expired = createPool(() => ({ rows: [] }));
    const service = new AccountPasskeyService(expired.pool, config);
    await expect(service.removeManagementPasskey(cookie, csrf, "00000000-0000-4000-8000-000000000001")).resolves.toBe(false);
    expect(expired.queries).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));

    const notOwned = createPool((sql) => sql.includes("SELECT account_id FROM passkey_management_sessions")
      ? { rows: [{ account_id: accountId }] }
      : sql.startsWith("DELETE FROM account_passkeys") ? { rows: [] }
        : { rows: [] });
    await expect(new AccountPasskeyService(notOwned.pool, config).removeManagementPasskey(cookie, csrf, "00000000-0000-4000-8000-000000000001"))
      .resolves.toBe(false);
    expect(notOwned.queries.some(({ sql }) => sql.includes("INSERT INTO account_security_email_outbox"))).toBe(false);
    expect(notOwned.queries).toContainEqual(expect.objectContaining({ sql: "ROLLBACK" }));

    await expect(service.removeManagementPasskey("bad", csrf, "00000000-0000-4000-8000-000000000001"))
      .resolves.toBe(false);
    await expect(service.listManagementPasskeys("bad", csrf)).resolves.toBeNull();
  });
});
