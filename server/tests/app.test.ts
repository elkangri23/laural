import { afterEach, describe, expect, it, vi } from "vitest";
import argon2 from "argon2";
import { createHash } from "node:crypto";
import type { PreferenceSnapshot, PreferenceStore, StoredSnapshot, WriteSnapshotResult } from "../src/contracts.js";
import { createApp } from "../src/app.js";
import { EmailAuthService } from "../src/email-auth.js";
import { NativeAuthService, type NativeAuthStore } from "../src/native-auth.js";
import type { AccountMfaService } from "../src/account-mfa.js";
import type { AccountDeletionService } from "../src/account-deletion.js";
import type { AccountPasskeyService } from "../src/account-passkeys.js";
import type { RequestRateLimiter } from "../src/request-rate-limit.js";
import type { GoogleOAuthService } from "../src/google-oauth.js";
import type { AccountRecoveryService } from "../src/account-recovery.js";

const snapshot: PreferenceSnapshot = {
  schemaVersion: 1,
  preferences: { themeId: "laurel", appearance: "dark", updateMode: "manual" },
  activeProviderId: "local",
  providers: [{ id: "local", kind: "ollama", name: "Local", model: "llama3" }],
};

class MemoryStore implements PreferenceStore {
  private records = new Map<string, StoredSnapshot>();
  private keys = new Map<string, { snapshot: PreferenceSnapshot; revision: number; digest: string }>();
  private history = new Map<string, Array<{ revision: number; createdAt: string; snapshot: PreferenceSnapshot }>>();

  async get(accountId: string): Promise<StoredSnapshot> {
    return structuredClone(this.records.get(accountId) ?? { snapshot: null, revision: 0 });
  }

  async listHistory(accountId: string, beforeRevision: number | undefined, limit: number) {
    return (this.history.get(accountId) ?? []).filter((entry) => beforeRevision === undefined || entry.revision < beforeRevision)
      .sort((left, right) => right.revision - left.revision).slice(0, limit)
      .map(({ revision, createdAt }) => ({ revision, createdAt }));
  }

  async getHistory(accountId: string, revision: number) {
    const entry = this.history.get(accountId)?.find((item) => item.revision === revision);
    return entry ? structuredClone(entry) : null;
  }

  async deleteHistory(accountId: string, revision: number) {
    const entries = this.history.get(accountId) ?? [];
    const remaining = entries.filter((entry) => entry.revision !== revision);
    this.history.set(accountId, remaining);
    return remaining.length !== entries.length;
  }

  async put(accountId: string, expectedRevision: number, key: string, value: PreferenceSnapshot): Promise<WriteSnapshotResult> {
    const digest = JSON.stringify(value);
    const previous = this.keys.get(`${accountId}:${key}`);
    if (previous) return previous.digest === digest
      ? { kind: "replayed", snapshot: structuredClone(previous.snapshot), revision: previous.revision }
      : { kind: "idempotency_key_reused" };
    const current = await this.get(accountId);
    if (current.revision !== expectedRevision) return { kind: "conflict", revision: current.revision };
    if (current.snapshot) {
      const entries = this.history.get(accountId) ?? [];
      entries.push({ revision: current.revision, createdAt: new Date(0).toISOString(), snapshot: current.snapshot });
      this.history.set(accountId, entries);
    }
    const result = { snapshot: structuredClone(value), revision: current.revision + 1 };
    this.records.set(accountId, result);
    this.keys.set(`${accountId}:${key}`, { ...result, digest });
    return { kind: "saved", ...result };
  }
}

const instances: Array<ReturnType<typeof createApp>> = [];
function createTestApp(options: { store?: PreferenceStore; checkReadiness?: () => Promise<void>; emailAuth?: EmailAuthService; nativeAuth?: NativeAuthService; accountRecoveryEnabled?: boolean; accountRecovery?: AccountRecoveryService; accountMfa?: AccountMfaService; accountDeletion?: AccountDeletionService; accountPasskeys?: AccountPasskeyService; googleOAuth?: GoogleOAuthService; requestRateLimiter?: RequestRateLimiter; revokeSession?: (accountId: string, authorization: string | undefined) => Promise<boolean>; listAccountSessions?: (accountId: string, authorization: string | undefined) => Promise<{ id: string; createdAt: string; expiresAt: string; current: boolean }[]>; revokeAccountSession?: (accountId: string, authorization: string | undefined, sessionId: string) => Promise<boolean>; revokeOtherSessions?: (accountId: string, authorization: string | undefined) => Promise<number> } = {}): ReturnType<typeof createApp> {
  const store = options.store ?? new MemoryStore();
  const requestRateLimiter = options.requestRateLimiter ?? new TestRateLimiter();
  const app = createApp({
    store,
    authenticate: async (authorization) => {
      const match = authorization?.match(/^Bearer account-([a-z0-9]+)$/);
      return match?.[1] ?? null;
    },
    revokeSession: options.revokeSession ?? (async () => true),
    listAccountSessions: options.listAccountSessions ?? (async () => []),
    revokeAccountSession: options.revokeAccountSession ?? (async () => true),
    revokeOtherSessions: options.revokeOtherSessions ?? (async () => 0),
    checkReadiness: options.checkReadiness ?? (async () => undefined),
    requestRateLimiter,
    ...(options.emailAuth ? { emailAuth: options.emailAuth } : {}),
    ...(options.nativeAuth ? { nativeAuth: options.nativeAuth } : {}),
    ...(options.accountMfa ? { accountMfa: options.accountMfa } : {}),
    ...(options.accountDeletion ? { accountDeletion: options.accountDeletion } : {}),
    ...(options.accountPasskeys ? { accountPasskeys: options.accountPasskeys } : {}),
    ...(options.googleOAuth ? { googleOAuth: options.googleOAuth } : {}),
    ...(options.accountRecoveryEnabled ? { accountRecoveryEnabled: true } : {}),
    ...(options.accountRecovery ? { accountRecovery: options.accountRecovery } : {}),
  });
  instances.push(app);
  return app;
}

class TestRateLimiter implements RequestRateLimiter {
  private readonly hits = new Map<string, number>();

  async consume(scope: string, clientAddress: string, maximum: number): Promise<boolean> {
    const key = `${scope}:${clientAddress}`;
    const count = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, count);
    return count <= maximum;
  }
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((app) => app.close()));
});

describe("alta del factor tras recuperación", () => {
  it("limita el flujo al enrolamiento y exige CSRF antes de confirmar", async () => {
    const accountRecovery = {
      startEnrollment: vi.fn(async () => ({ cookieToken: "c".repeat(43), csrfToken: "s".repeat(43), secret: "A".repeat(32), provisioningUri: "otpauth://totp/Laural:test?secret=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })),
      confirmEnrollment: vi.fn(async () => ["AAAA-BBBB-CCCC-DDDD"]),
    } as unknown as AccountRecoveryService;
    const app = createTestApp({ accountRecovery });
    const page = await app.inject({ method: "GET", url: "/auth/recovery" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("sustituir factores anteriores");
    expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
    const start = await app.inject({ method: "POST", url: "/auth/recovery/start", payload: { ticket: "t".repeat(43) } });
    expect(start.statusCode).toBe(200);
    expect(start.headers["set-cookie"]).toContain("HttpOnly; Secure; SameSite=Strict");
    expect(accountRecovery.startEnrollment).toHaveBeenCalledWith("t".repeat(43));
    const cookie = `__Host-laural-recovery-flow=${"c".repeat(43)}`;
    const denied = await app.inject({ method: "POST", url: "/auth/recovery/confirm", headers: { cookie }, payload: { csrf: "s".repeat(43), code: "123456" } });
    expect(denied.statusCode).toBe(403);
    expect(accountRecovery.confirmEnrollment).not.toHaveBeenCalled();
    const confirmed = await app.inject({ method: "POST", url: "/auth/recovery/confirm", headers: { cookie, "x-csrf-token": "s".repeat(43) }, payload: { csrf: "s".repeat(43), code: "123456" } });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toEqual({ recoveryCodes: ["AAAA-BBBB-CCCC-DDDD"] });
    expect(confirmed.headers["set-cookie"]).toContain("Max-Age=0");
  });
});

describe("rutas MFA de cuenta", () => {
  it("exige sesión para ver el estado y devuelve solo datos de estado", async () => {
    const accountMfa = { status: vi.fn(async () => ({ totpEnabled: true, recoveryCodesRemaining: 7, enrollmentPending: false })) } as unknown as AccountMfaService;
    const app = createTestApp({ accountMfa });
    expect((await app.inject({ method: "GET", url: "/v1/auth/mfa" })).statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: "/v1/auth/mfa", headers: { authorization: "Bearer account-user1" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ totpEnabled: true, recoveryCodesRemaining: 7, enrollmentPending: false });
    expect(accountMfa.status).toHaveBeenCalledWith("user1");
  });

  it("valida formato de TOTP antes de llamar al servicio", async () => {
    const accountMfa = { confirmEnrollment: vi.fn(async () => ["AAAA-BBBB-CCCC-DDDD"]) } as unknown as AccountMfaService;
    const app = createTestApp({ accountMfa });
    const invalid = await app.inject({ method: "POST", url: "/v1/auth/mfa/totp/enrollment/confirm", headers: { authorization: "Bearer account-user1" }, payload: { code: "abcdef" } });
    expect(invalid.statusCode).toBe(400);
    expect(accountMfa.confirmEnrollment).not.toHaveBeenCalled();
    const valid = await app.inject({ method: "POST", url: "/v1/auth/mfa/totp/enrollment/confirm", headers: { authorization: "Bearer account-user1" }, payload: { code: "123456" } });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({ recoveryCodes: ["AAAA-BBBB-CCCC-DDDD"] });
  });
});

describe("límites de acceso nativo por cuenta", () => {
  it("presenta recovery solo al habilitarlo y conserva respuestas genéricas tras los POST", async () => {
    const csrf = "c".repeat(43);
    const cookieToken = "t".repeat(43);
    const nativeAuth = {
      startFlow: vi.fn(async () => ({ cookieToken, csrfToken: csrf })),
      isBrowserFlowValid: vi.fn(async (cookie: string | null, submittedCsrf: string) => cookie === cookieToken && submittedCsrf === csrf),
    } as unknown as NativeAuthService;
    const requestAccountRecovery = vi.fn(async () => "accepted" as const);
    const verifyAccountRecovery = vi.fn(async () => "invalid_or_expired" as const);
    const emailAuth = new EmailAuthService({
      createUnverifiedAccount: async () => null,
      createVerification: async () => null,
      verifyEmail: async () => false,
      createPasswordReset: async () => null,
      checkPasswordReset: async () => false,
      resetPassword: async () => false,
      createAccountRecovery: async () => null,
      verifyAccountRecovery: async () => null,
    }, { sendVerification: async () => undefined, sendPasswordReset: async () => undefined }, "a-server-pepper-with-enough-entropy-for-this-test");
    emailAuth.requestAccountRecovery = requestAccountRecovery;
    emailAuth.verifyAccountRecovery = verifyAccountRecovery;
    const app = createTestApp({ emailAuth, nativeAuth, accountRecoveryEnabled: true });
    const query = new URLSearchParams({ redirect_uri: "http://127.0.0.1:49152/callback", state: "s".repeat(43), code_challenge: "h".repeat(43), code_challenge_method: "S256" });
    const start = await app.inject({ method: "GET", url: `/auth/native?${query}` });
    expect(start.body).toContain("/auth/native/recovery?csrf=");
    const cookie = String(start.headers["set-cookie"]).split(";")[0];
    const headers = { cookie, "content-type": "application/x-www-form-urlencoded" };
    const recoveryPage = await app.inject({ method: "GET", url: `/auth/native/recovery?csrf=${csrf}`, headers: { cookie } });
    expect(recoveryPage.statusCode).toBe(200);
    expect(recoveryPage.body).toContain("/auth/native/recovery/request");
    const request = await app.inject({
      method: "POST", url: "/auth/native/recovery/request", headers,
      payload: new URLSearchParams({ csrf, email: "unknown@example.test" }).toString(),
    });
    expect(request.statusCode).toBe(200);
    expect(request.body).toContain("Si la cuenta puede iniciar una solicitud");
    const confirm = await app.inject({
      method: "POST", url: "/auth/native/recovery/confirm", headers,
      payload: new URLSearchParams({ csrf, email: "unknown@example.test", pin: "000000" }).toString(),
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.body).toContain("el administrador revisará el caso");
    expect(requestAccountRecovery).toHaveBeenCalledWith("unknown@example.test");
    expect(verifyAccountRecovery).toHaveBeenCalledWith("unknown@example.test", "000000");
  });

  it("comparte entre IP el límite de intentos y no consume el contador si falla CSRF", async () => {
    const hits = new Map<string, number>();
    const requestRateLimiter: RequestRateLimiter = {
      consume: async (scope, key, maximum) => {
        const counterKey = `${scope}:${key}`;
        const count = (hits.get(counterKey) ?? 0) + 1;
        hits.set(counterKey, count);
        return count <= maximum;
      },
    };
    const validCsrf = "c".repeat(43);
    const login = vi.fn<NativeAuthService["login"]>(async () => null);
    const nativeAuth = {
      isBrowserFlowValid: vi.fn(async (_cookie: string | null, csrf: string) => csrf === validCsrf),
      login,
    } as unknown as NativeAuthService;
    const emailAuth = new EmailAuthService({
      createUnverifiedAccount: async () => null,
      createVerification: async () => null,
      verifyEmail: async () => false,
      createPasswordReset: async () => null,
      checkPasswordReset: async () => false,
      resetPassword: async () => false,
    }, { sendVerification: async () => undefined, sendPasswordReset: async () => undefined }, "a-server-pepper-with-enough-entropy-for-this-test");
    const app = createTestApp({ requestRateLimiter, emailAuth, nativeAuth });
    const emails = ["Persona@Example.test", " persona@example.test ", "PERSONA@example.test"];

    const invalidFlow = await app.inject({
      method: "POST", url: "/auth/native/login", remoteAddress: "198.51.100.1",
      payload: { csrf: "x".repeat(43), email: emails[0], password: "password de prueba 2026" },
    });
    expect(invalidFlow.statusCode).toBe(400);
    expect(hits.has("native-login-email:persona@example.test")).toBe(false);

    for (let index = 0; index < 11; index += 1) {
      const response = await app.inject({
        method: "POST", url: "/auth/native/login", remoteAddress: `198.51.100.${index + 10}`,
        payload: { csrf: validCsrf, email: emails[index % emails.length], password: "password de prueba 2026" },
      });
      expect(response.statusCode).toBe(index < 10 ? 400 : 429);
      if (index === 10) expect(response.headers["retry-after"]).toBe("60");
    }
    expect(login).toHaveBeenCalledTimes(10);
    expect(hits.get("native-login-email:persona@example.test")).toBe(11);
  });

  it("comparte el límite TOTP entre flujos y toma la cuenta de la asociación validada", async () => {
    const hits = new Map<string, number>();
    const requestRateLimiter: RequestRateLimiter = {
      consume: async (scope, key, maximum) => {
        const counterKey = `${scope}:${key}`;
        const count = (hits.get(counterKey) ?? 0) + 1;
        hits.set(counterKey, count);
        return count <= maximum;
      },
    };
    const csrf = "c".repeat(43);
    const cookieToken = "t".repeat(43);
    const completeMfa = vi.fn<NativeAuthService["completeMfa"]>(async () => null);
    const nativeAuth = {
      isBrowserFlowValid: vi.fn(async (_cookie: string | null, submittedCsrf: string) => submittedCsrf === csrf),
      completeMfa,
    } as unknown as NativeAuthService;
    const pendingMfaLoginAccountId = vi.fn(async (_cookie: string, _csrf: string, email: string) =>
      email.trim().toLowerCase() === "persona@example.test" ? "account-123" : null);
    const accountMfa = { pendingMfaLoginAccountId } as unknown as AccountMfaService;
    const emailAuth = new EmailAuthService({
      createUnverifiedAccount: async () => null,
      createVerification: async () => null,
      verifyEmail: async () => false,
      createPasswordReset: async () => null,
      checkPasswordReset: async () => false,
      resetPassword: async () => false,
    }, { sendVerification: async () => undefined, sendPasswordReset: async () => undefined }, "a-server-pepper-with-enough-entropy-for-this-test");
    const app = createTestApp({ requestRateLimiter, emailAuth, nativeAuth, accountMfa });
    const headers = { cookie: `__Host-laural-flow=${cookieToken}` };

    const invalidFlow = await app.inject({
      method: "POST", url: "/auth/native/login/mfa", remoteAddress: "198.51.100.1", headers,
      payload: { csrf: "x".repeat(43), email: "persona@example.test", proof: "123456" },
    });
    expect(invalidFlow.statusCode).toBe(400);
    expect(pendingMfaLoginAccountId).not.toHaveBeenCalled();

    const unrelatedEmail = await app.inject({
      method: "POST", url: "/auth/native/login/mfa", remoteAddress: "198.51.100.2", headers,
      payload: { csrf, email: "otra@example.test", proof: "123456" },
    });
    expect(unrelatedEmail.statusCode).toBe(400);
    expect(hits.has("native-mfa-account:account-123")).toBe(false);

    for (let index = 0; index < 11; index += 1) {
      const response = await app.inject({
        method: "POST", url: "/auth/native/login/mfa", remoteAddress: `198.51.100.${index + 10}`, headers,
        payload: { csrf, email: " PERSONA@example.test ", proof: "123456" },
      });
      expect(response.statusCode).toBe(index < 10 ? 400 : 429);
      if (index === 10) expect(response.headers["retry-after"]).toBe("300");
    }
    expect(completeMfa).toHaveBeenCalledTimes(11);
    expect(hits.get("native-mfa-account:account-123")).toBe(11);
  });
});

describe("rutas de passkeys", () => {
  it("expone disponibilidad autenticada y exige reautenticación para generar el enlace", async () => {
    let recentLogin = false;
    const passkeys = {
      createManagementTicket: vi.fn(async (_accountId: string, authorization: string | undefined) => recentLogin && authorization === "Bearer account-user1" ? "t".repeat(43) : null),
      managementUrl: vi.fn((ticket: string) => `https://sync.example.test/auth/passkeys/manage#ticket=${ticket}`),
      consumeManagementTicket: vi.fn(async (ticket: string) => ticket === "t".repeat(43) ? { cookieToken: "a".repeat(43), csrfToken: "b".repeat(43) } : null),
    } as unknown as AccountPasskeyService;
    const nativeStore: NativeAuthStore = {
      createFlow: async () => undefined,
      isFlowActive: async () => true,
      findLoginCandidate: async () => null,
      failLogin: async () => undefined,
      requireMfa: async () => true,
      completeLogin: async () => null,
      exchangeCode: async () => null,
    };
    const emailAuth = new EmailAuthService({
      createUnverifiedAccount: async () => null,
      createVerification: async () => null,
      verifyEmail: async () => false,
      createPasswordReset: async () => null,
      checkPasswordReset: async () => false,
      resetPassword: async () => false,
    }, { sendVerification: async () => undefined, sendPasswordReset: async () => undefined }, "a-pepper-long-enough-for-auth-page-test");
    const app = createTestApp({ accountPasskeys: passkeys, emailAuth, nativeAuth: new NativeAuthService(nativeStore) });

    expect((await app.inject({ method: "GET", url: "/v1/auth/passkeys/status" })).statusCode).toBe(401);
    const status = await app.inject({ method: "GET", url: "/v1/auth/passkeys/status", headers: { authorization: "Bearer account-user1" } });
    expect(status.json()).toEqual({ enabled: true });
    const denied = await app.inject({ method: "POST", url: "/v1/auth/passkeys/manage-link", headers: { authorization: "Bearer account-user1" } });
    expect(denied.statusCode).toBe(403);
    recentLogin = true;
    const link = await app.inject({ method: "POST", url: "/v1/auth/passkeys/manage-link", headers: { authorization: "Bearer account-user1" } });
    expect(link.statusCode).toBe(201);
    expect(link.json().url).toBe(`https://sync.example.test/auth/passkeys/manage#ticket=${"t".repeat(43)}`);
    expect(passkeys.createManagementTicket).toHaveBeenCalledWith("user1", "Bearer account-user1");
    const redeemed = await app.inject({ method: "POST", url: "/auth/passkeys/manage/redeem", payload: { ticket: "t".repeat(43) } });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.headers["set-cookie"]).toEqual(expect.arrayContaining([
      expect.stringContaining("__Host-laural-passkey-session="),
      expect.stringContaining("__Host-laural-passkey-csrf="),
    ]));
    expect(redeemed.body).not.toContain("t".repeat(43));
  });
});

describe("ruta de borrado de cuenta", () => {
  it("valida autenticación y texto exacto antes de borrar", async () => {
    const deletion = { deleteAccount: vi.fn(async () => "deleted" as const) } as unknown as AccountDeletionService;
    const app = createTestApp({ accountDeletion: deletion });
    const anonymous = await app.inject({ method: "DELETE", url: "/v1/auth/account", payload: { confirmation: "ELIMINAR" } });
    expect(anonymous.statusCode).toBe(401);

    const invalid = await app.inject({ method: "DELETE", url: "/v1/auth/account", headers: { authorization: "Bearer account-user1" }, payload: { confirmation: "borrar" } });
    expect(invalid.statusCode).toBe(400);
    expect(deletion.deleteAccount).not.toHaveBeenCalled();

    const deleted = await app.inject({ method: "DELETE", url: "/v1/auth/account", headers: { authorization: "Bearer account-user1" }, payload: { confirmation: "ELIMINAR" } });
    expect(deleted.statusCode).toBe(204);
    expect(deletion.deleteAccount).toHaveBeenCalledWith("user1", "Bearer account-user1");
  });

  it("solicita autenticación reciente y no disfraza otros errores", async () => {
    const deletion = { deleteAccount: vi.fn(async () => "recent_auth_required" as const) } as unknown as AccountDeletionService;
    const app = createTestApp({ accountDeletion: deletion });
    const response = await app.inject({ method: "DELETE", url: "/v1/auth/account", headers: { authorization: "Bearer account-user1" }, payload: { confirmation: "ELIMINAR" } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "recent_auth_required" });
  });
});

describe("API de snapshots de preferencias", () => {
  it("revoca solo la sesión autenticada y confirma el cierre", async () => {
    const revokeSession = vi.fn(async () => true);
    const app = createTestApp({ revokeSession });
    expect((await app.inject({ method: "POST", url: "/v1/auth/session/revoke" })).statusCode).toBe(401);
    expect(revokeSession).not.toHaveBeenCalled();

    const response = await app.inject({
      method: "POST", url: "/v1/auth/session/revoke",
      headers: { authorization: "Bearer account-a" },
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(revokeSession).toHaveBeenCalledWith("a", "Bearer account-a");
  });

  it("lista sesiones propias y revoca otra sin permitir revocar la actual", async () => {
    const listAccountSessions = vi.fn(async () => [{ id: "d5363ea7-f6cb-4cca-8e03-85aa33089e7a", createdAt: "2026-11-21T10:00:00.000Z", expiresAt: "2026-12-21T10:00:00.000Z", current: false }]);
    const revokeAccountSession = vi.fn(async () => true);
    const app = createTestApp({ listAccountSessions, revokeAccountSession });
    const headers = { authorization: "Bearer account-a" };

    expect((await app.inject({ method: "GET", url: "/v1/auth/sessions" })).statusCode).toBe(401);
    const listed = await app.inject({ method: "GET", url: "/v1/auth/sessions", headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ sessions: [{ id: "d5363ea7-f6cb-4cca-8e03-85aa33089e7a", createdAt: "2026-11-21T10:00:00.000Z", expiresAt: "2026-12-21T10:00:00.000Z", current: false }] });
    expect((await app.inject({ method: "DELETE", url: "/v1/auth/sessions/not-a-uuid", headers })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: "/v1/auth/sessions/d5363ea7-f6cb-4cca-8e03-85aa33089e7a", headers })).statusCode).toBe(204);
    expect(revokeAccountSession).toHaveBeenCalledWith("a", "Bearer account-a", "d5363ea7-f6cb-4cca-8e03-85aa33089e7a");
  });

  it("revoca todas las demás sesiones conservando la autenticada", async () => {
    const revokeOtherSessions = vi.fn(async () => 3);
    const app = createTestApp({ revokeOtherSessions });
    const headers = { authorization: "Bearer account-a" };
    expect((await app.inject({ method: "POST", url: "/v1/auth/sessions/revoke-others" })).statusCode).toBe(401);
    const response = await app.inject({ method: "POST", url: "/v1/auth/sessions/revoke-others", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ revoked: 3 });
    expect(revokeOtherSessions).toHaveBeenCalledWith("a", "Bearer account-a");
  });

  it("solo confía en X-Forwarded-For cuando la conexión procede de loopback", async () => {
    const clientAddresses: string[] = [];
    const requestRateLimiter: RequestRateLimiter = {
      consume: async (_scope, clientAddress) => {
        clientAddresses.push(clientAddress);
        return true;
      },
    };
    const app = createTestApp({ requestRateLimiter });
    const headers = { authorization: "Bearer account-a", "x-forwarded-for": "198.51.100.77" };

    const direct = await app.inject({ method: "GET", url: "/v1/preferences/current", remoteAddress: "203.0.113.9", headers });
    expect(direct.statusCode).toBe(200);
    expect(clientAddresses.at(-1)).toBe("203.0.113.9");

    const proxied = await app.inject({ method: "GET", url: "/v1/preferences/current", remoteAddress: "127.0.0.1", headers });
    expect(proxied.statusCode).toBe(200);
    expect(clientAddresses.at(-1)).toBe("198.51.100.77");
  });

  it("limita las lecturas de preferencias por IP y devuelve Retry-After", async () => {
    const app = createTestApp();
    const request = { method: "GET" as const, url: "/v1/preferences/current", headers: { authorization: "Bearer account-a" } };
    for (let count = 0; count < 120; count += 1) {
      expect((await app.inject(request)).statusCode).toBe(200);
    }
    const limited = await app.inject(request);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.json()).toEqual({ error: "rate_limited" });
  });

  it("expone registro y verificación solo cuando email auth está configurado; el PIN no inicia sesión", async () => {
    const disabled = createTestApp();
    expect((await disabled.inject({ method: "POST", url: "/v1/auth/register", payload: {} })).statusCode).toBe(404);

    let savedVerifier = "";
    let sentPin = "";
    const emailAuth = new EmailAuthService({
      createUnverifiedAccount: async () => ({ id: "account-a" }),
      createVerification: async (_email, verifier) => {
        savedVerifier = verifier;
        return { accountId: "account-a", displayName: "A", challengeId: "challenge-a" };
      },
      verifyEmail: async (_email, verifier) => verifier === savedVerifier,
      createPasswordReset: async () => null,
      checkPasswordReset: async () => false,
      resetPassword: async () => false,
    }, {
      sendVerification: async ({ pin }) => { sentPin = pin; },
      sendPasswordReset: async () => undefined,
    }, "a-server-pepper-with-enough-entropy-for-this-test");
    const app = createTestApp({ emailAuth });
    const registration = await app.inject({
      method: "POST", url: "/v1/auth/register",
      payload: { displayName: "A", email: "a@example.test", password: "a long password 2026" },
    });
    expect(registration.statusCode).toBe(202);
    expect(registration.json()).toEqual({ status: "accepted" });
    expect(registration.body).not.toContain(sentPin);

    const wrongPinValue = sentPin === "000000" ? "000001" : "000000";
    const wrongPin = await app.inject({ method: "POST", url: "/v1/auth/verification/confirm", payload: { email: "a@example.test", pin: wrongPinValue } });
    expect(wrongPin.statusCode).toBe(202);
    expect(wrongPin.json()).toEqual({ status: "accepted" });
    const verified = await app.inject({ method: "POST", url: "/v1/auth/verification/confirm", payload: { email: "a@example.test", pin: sentPin } });
    expect(verified.statusCode).toBe(202);
    expect(verified.json()).toEqual({ status: "accepted" });
    expect(verified.headers.authorization).toBeUndefined();

    const resetRequest = await app.inject({ method: "POST", url: "/v1/auth/password-reset/request", payload: { email: "a@example.test" } });
    const missingResetRequest = await app.inject({ method: "POST", url: "/v1/auth/password-reset/request", payload: { email: "missing@example.test" } });
    expect(resetRequest.statusCode).toBe(202);
    expect(resetRequest.json()).toEqual({ status: "accepted" });
    expect(missingResetRequest.json()).toEqual(resetRequest.json());
    const resetResponse = await app.inject({ method: "POST", url: "/v1/auth/password-reset/confirm", payload: { email: "a@example.test", pin: "000000", password: "una nueva contraseña 2026" } });
    expect(resetResponse.statusCode).toBe(202);
    expect(resetResponse.json()).toEqual({ status: "accepted" });
    expect(resetResponse.headers.authorization).toBeUndefined();
  });

  it("comparte el límite de recuperación entre IP y normaliza el correo", async () => {
    const hits = new Map<string, number>();
    const consumed: Array<{ scope: string; key: string }> = [];
    const requestRateLimiter: RequestRateLimiter = {
      consume: async (scope, key, maximum) => {
        consumed.push({ scope, key });
        const hitKey = `${scope}:${key}`;
        const count = (hits.get(hitKey) ?? 0) + 1;
        hits.set(hitKey, count);
        return count <= maximum;
      },
    };
    const requestPasswordReset = vi.fn(async () => "accepted" as const);
    const emailAuth = new EmailAuthService({
      createUnverifiedAccount: async () => null,
      createVerification: async () => null,
      verifyEmail: async () => false,
      createPasswordReset: async () => null,
      checkPasswordReset: async () => false,
      resetPassword: async () => false,
    }, { sendVerification: async () => undefined, sendPasswordReset: async () => undefined }, "a-server-pepper-with-enough-entropy-for-this-test");
    vi.spyOn(emailAuth, "requestPasswordReset").mockImplementation(requestPasswordReset);
    const app = createTestApp({ requestRateLimiter, emailAuth });
    const addresses = ["198.51.100.1", "198.51.100.2", "198.51.100.3", "198.51.100.4"];
    const emails = ["Cuenta@Example.test", " cuenta@example.test ", "CUENTA@example.test", "cuenta@example.test"];

    for (let index = 0; index < addresses.length; index += 1) {
      const response = await app.inject({
        method: "POST", url: "/v1/auth/password-reset/request", remoteAddress: addresses[index],
        payload: { email: emails[index] },
      });
      expect(response.statusCode).toBe(index < 3 ? 202 : 429);
      if (index === 3) expect(response.headers["retry-after"]).toBe("900");
    }

    expect(requestPasswordReset).toHaveBeenCalledTimes(3);
    expect(consumed.filter(({ scope }) => scope === "password-reset-request-email")).toEqual([
      { scope: "password-reset-request-email", key: "cuenta@example.test" },
      { scope: "password-reset-request-email", key: "cuenta@example.test" },
      { scope: "password-reset-request-email", key: "cuenta@example.test" },
      { scope: "password-reset-request-email", key: "cuenta@example.test" },
    ]);
  });

  it("sirve página propia sin scripts y restringe el inicio a callback loopback", async () => {
    const disabled = createTestApp({ emailAuth: new EmailAuthService({
      createUnverifiedAccount: async () => null,
      createVerification: async () => null,
      verifyEmail: async () => false,
      createPasswordReset: async () => null,
      checkPasswordReset: async () => false,
      resetPassword: async () => false,
    }, { sendVerification: async () => undefined, sendPasswordReset: async () => undefined }, "a-pepper-long-enough-for-auth-page-test" ) });
    expect((await disabled.inject({ method: "GET", url: "/auth/native" })).statusCode).toBe(404);

    const nativeStore: NativeAuthStore = {
      createFlow: async () => undefined,
      isFlowActive: async () => true,
      findLoginCandidate: async () => null,
      failLogin: async () => undefined,
      completeLogin: async () => null,
      exchangeCode: async () => null,
    };
    const emailAuth = new EmailAuthService({
      createUnverifiedAccount: async () => null,
      createVerification: async () => null,
      verifyEmail: async () => false,
      createPasswordReset: async () => null,
      checkPasswordReset: async () => false,
      resetPassword: async () => false,
    }, { sendVerification: async () => undefined, sendPasswordReset: async () => undefined }, "a-pepper-long-enough-for-auth-page-test");
    const app = createTestApp({ emailAuth, nativeAuth: new NativeAuthService(nativeStore) });
    const query = new URLSearchParams({
      redirect_uri: "http://127.0.0.1:49152/callback",
      state: "s".repeat(43), code_challenge: "c".repeat(43), code_challenge_method: "S256",
    });
    const response = await app.inject({ method: "GET", url: `/auth/native?${query}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-security-policy"]).toContain("form-action 'self' http://127.0.0.1:*");
    expect(response.headers["set-cookie"]).toContain("HttpOnly; SameSite=Strict");
    expect(response.body).toContain("lang=\"es\"");
    expect(response.body).toContain("name=\"password\"");
    expect(response.body).not.toContain("<script");
    // El inicio de sesión es una página propia que enlaza a las demás;
    // cada paso tiene su página con su formulario.
    expect(response.body).toContain("¿No tienes cuenta? Crea una");
    expect(response.body).toContain("/auth/native/register?csrf=");
    expect(response.body).toContain("¿Olvidaste tu contraseña?");
    expect(response.body).toContain("/auth/native/password-reset?csrf=");
    expect(response.body).not.toContain("/auth/native/recovery?csrf=");
    const cookie = String(response.headers["set-cookie"]).split(";")[0] ?? "";
    const csrf = /name="csrf" value="([^"]+)"/.exec(response.body)?.[1] ?? "";
    const pageHeaders = { cookie };
    const registerPage = await app.inject({ method: "GET", url: `/auth/native/register?csrf=${csrf}`, headers: pageHeaders });
    expect(registerPage.statusCode).toBe(200);
    expect(registerPage.body).toContain("Crea tu cuenta");
    expect(registerPage.body).toContain('action="/auth/native/register"');
    const verificationPage = await app.inject({ method: "GET", url: `/auth/native/verification?csrf=${csrf}`, headers: pageHeaders });
    expect(verificationPage.statusCode).toBe(200);
    expect(verificationPage.body).toContain('action="/auth/native/verification/confirm"');
    expect(verificationPage.body).toContain("No inicia sesión ni elimina passkeys o MFA");
    const resetPage = await app.inject({ method: "GET", url: `/auth/native/password-reset?csrf=${csrf}`, headers: pageHeaders });
    expect(resetPage.statusCode).toBe(200);
    expect(resetPage.body).toContain("Restablecer contraseña");
    expect(resetPage.body).toContain('action="/auth/native/password-reset/confirm"');
    // La recuperación está apagada en este test: su página no existe.
    expect((await app.inject({ method: "GET", url: `/auth/native/recovery?csrf=${csrf}`, headers: pageHeaders })).statusCode).toBe(404);
    // Sin flujo válido, las páginas vuelven al inicio de sesión con aviso.
    const expired = await app.inject({ method: "GET", url: `/auth/native/register?csrf=${"x".repeat(43)}` });
    expect(expired.statusCode).toBe(400);
    expect(expired.body).toContain("La sesión de autenticación caducó");
    const css = await app.inject({ method: "GET", url: "/auth.css" });
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.body).toContain("--accent");

    const malicious = await app.inject({
      method: "GET",
      url: `/auth/native?${new URLSearchParams({ ...Object.fromEntries(query), redirect_uri: "https://attacker.test/callback" })}`,
    });
    expect(malicious.statusCode).toBe(400);

    const malformedLogin = await app.inject({
      method: "POST", url: "/auth/native/login",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ csrf: "x".repeat(43), email: "user@example.test", password: "valid password 2026" }).toString(),
    });
    expect(malformedLogin.statusCode).toBe(400);
    expect(malformedLogin.body).not.toContain("valid password 2026");
    const invalidExchange = await app.inject({ method: "POST", url: "/v1/auth/native/exchange", payload: { code: "x".repeat(43), codeVerifier: "v".repeat(43) } });
    expect(invalidExchange.statusCode).toBe(400);
  });

  it("inicia Google desde un flujo válido y entrega el callback al estado nativo existente", async () => {
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const redirectUri = "http://127.0.0.1:49152/callback";
    let cookieDigest = "";
    let csrfDigest = "";
    const oauth = {
      start: vi.fn(async () => "https://accounts.google.com/o/oauth2/v2/auth?state=opaque"),
      finish: vi.fn(async () => ({ cookieDigest, csrfDigest, accountId: "account-google" })),
      cancel: vi.fn(async () => undefined),
    } as unknown as GoogleOAuthService;
    const nativeStore: NativeAuthStore = {
      createFlow: async () => undefined,
      isFlowActive: async () => true,
      findLoginCandidate: async () => null,
      findPasskeyLoginCandidate: async (_cookie, _csrf, accountId) => ({
        flowId: "flow-google", redirectUri, state: "n".repeat(43), codeChallenge: "c".repeat(43),
        accountId, email: "person@example.test", passwordHash: null, emailVerified: true, mfaEnabled: false,
      }),
      rotateFlowCsrf: async (_cookie, _csrf, next) => { expect(next).toHaveLength(64); return true; },
      failLogin: async () => undefined,
      requireMfa: async () => true,
      completeLogin: async () => ({ redirectUri, state: "n".repeat(43) }),
      exchangeCode: async () => null,
    };
    const emailAuth = new EmailAuthService({
      createUnverifiedAccount: async () => null, createVerification: async () => null,
      verifyEmail: async () => false, createPasswordReset: async () => null,
      checkPasswordReset: async () => false, resetPassword: async () => false,
    }, { sendVerification: async () => undefined, sendPasswordReset: async () => undefined }, "browser-test-pepper-long-enough-32-bytes");
    const app = createTestApp({ emailAuth, nativeAuth: new NativeAuthService(nativeStore), googleOAuth: oauth });
    const startQuery = new URLSearchParams({ redirect_uri: redirectUri, state: "s".repeat(43), code_challenge: "c".repeat(43), code_challenge_method: "S256" });
    const page = await app.inject({ method: "GET", url: `/auth/native?${startQuery}` });
    expect(page.body).toContain("Continuar con Google");
    const cookie = page.headers["set-cookie"]!.split(";")[0]!;
    const cookieToken = cookie.split("=")[1]!;
    const csrf = page.body.match(/name="csrf" value="([^"]+)"/)?.[1] ?? "";
    cookieDigest = hash(cookieToken);
    csrfDigest = hash(csrf);
    const start = await app.inject({
      method: "POST", url: "/auth/native/google/start", headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ csrf }).toString(),
    });
    expect(start.statusCode).toBe(303);
    expect(start.headers.location).toBe("https://accounts.google.com/o/oauth2/v2/auth?state=opaque");
    expect(oauth.start).toHaveBeenCalledWith(cookieDigest, csrfDigest);

    const callback = await app.inject({ method: "GET", url: `/auth/google/callback?${new URLSearchParams({ state: "g".repeat(43), code: "google-code" })}` });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toContain("127.0.0.1:49152/callback");
    expect(callback.headers.location).toContain("state=" + "n".repeat(43));
    expect(oauth.finish).toHaveBeenCalledWith("g".repeat(43), "google-code");
    const invalidStart = await app.inject({ method: "POST", url: "/auth/native/google/start", payload: { csrf: "x".repeat(43) } });
    expect(invalidStart.statusCode).toBe(400);
  });

  it("valida la cookie y el CSRF en registro, reenvío y confirmación del navegador", async () => {
    const verificationEmail = "user@example.test";
    let resetVerifier = "";
    let resetPin = "";
    const accountStore = {
      createUnverifiedAccount: async () => ({ id: "account-a" }),
      createVerification: async () => ({ accountId: "account-a", displayName: "User", challengeId: "challenge-a" }),
      verifyEmail: async () => true,
      createPasswordReset: async (_email: string, verifier: string) => {
        resetVerifier = verifier;
        return { accountId: "account-a", displayName: "User", challengeId: "reset-a" };
      },
      checkPasswordReset: async (_email: string, verifier: string) => verifier === resetVerifier,
      resetPassword: async (_email: string, verifier: string) => verifier === resetVerifier,
    };
    const mailer = {
      sendVerification: async () => undefined,
      sendPasswordReset: async ({ pin }: { pin: string }) => { resetPin = pin; },
    };
    const emailAuth = new EmailAuthService(accountStore, mailer, "a-pepper-long-enough-for-browser-forms");
    const nativeStore: NativeAuthStore = {
      createFlow: async () => undefined,
      isFlowActive: async (cookie, csrf) => cookie.length === 64 && csrf.length === 64,
      findLoginCandidate: async () => null,
      failLogin: async () => undefined,
      completeLogin: async () => null,
      exchangeCode: async () => null,
    };
    const app = createTestApp({ emailAuth, nativeAuth: new NativeAuthService(nativeStore) });
    const startQuery = new URLSearchParams({
      redirect_uri: "http://127.0.0.1:49152/callback", state: "s".repeat(43),
      code_challenge: "c".repeat(43), code_challenge_method: "S256",
    });
    const start = await app.inject({ method: "GET", url: `/auth/native?${startQuery}` });
    const cookie = String(start.headers["set-cookie"]).split(";")[0] ?? "";
    const csrf = /name="csrf" value="([^"]+)"/.exec(start.body)?.[1] ?? "";

    const invalidFlow = await app.inject({
      method: "POST", url: "/auth/native/register",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ csrf, displayName: "User", email: verificationEmail, password: "valid password 2026" }).toString(),
    });
    expect(invalidFlow.statusCode).toBe(400);

    const registered = await app.inject({
      method: "POST", url: "/auth/native/register",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ csrf, displayName: "User", email: verificationEmail, password: "valid password 2026" }).toString(),
    });
    expect(registered.statusCode).toBe(200);
    expect(registered.body).toContain("Si los datos son válidos");

    const resent = await app.inject({
      method: "POST", url: "/auth/native/verification/resend",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ csrf, email: verificationEmail }).toString(),
    });
    expect(resent.statusCode).toBe(200);
    expect(resent.body).toContain("Si la cuenta necesita verificación");

    const confirmed = await app.inject({
      method: "POST", url: "/auth/native/verification/confirm",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ csrf, email: verificationEmail, pin: "012345" }).toString(),
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.body).toContain("Si el PIN era correcto");

    const resetWithoutCookie = await app.inject({
      method: "POST", url: "/auth/native/password-reset/request",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ csrf, email: verificationEmail }).toString(),
    });
    expect(resetWithoutCookie.statusCode).toBe(400);
    expect(resetPin).toBe("");
    const resetRequest = await app.inject({
      method: "POST", url: "/auth/native/password-reset/request",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ csrf, email: verificationEmail }).toString(),
    });
    expect(resetRequest.statusCode).toBe(200);
    expect(resetRequest.body).toContain("Si la cuenta puede recuperarse");
    expect(resetPin).toMatch(/^\d{6}$/);
    const passwordReset = await app.inject({
      method: "POST", url: "/auth/native/password-reset/confirm",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ csrf, email: verificationEmail, pin: resetPin, password: "nueva contraseña segura 2026" }).toString(),
    });
    expect(passwordReset.statusCode).toBe(200);
    expect(passwordReset.body).toContain("no inicia sesión ni elimina factores de seguridad");
  });

  it("hace login en navegador y canjea PKCE sin entregar el token en la página", async () => {
    const password = "password for Laural 2026";
    const passwordHash = await argon2.hash(password);
    let flowCookie = "";
    let oneTimeCode = "";
    let expectedChallenge = "";
    const nativeStore: NativeAuthStore = {
      createFlow: async () => undefined,
      isFlowActive: async () => true,
      findLoginCandidate: async () => ({
        flowId: "flow-1", redirectUri: "http://127.0.0.1:49152/callback", state: "s".repeat(43),
        codeChallenge: expectedChallenge, accountId: "account-a", passwordHash, emailVerified: true,
      }),
      failLogin: async () => undefined,
      completeLogin: async ({ codeDigest }) => {
        oneTimeCode = codeDigest;
        return { redirectUri: "http://127.0.0.1:49152/callback", state: "s".repeat(43) };
      },
      exchangeCode: async (codeDigest, challenge) => {
        expect(codeDigest).toBe(oneTimeCode);
        expect(challenge).toBe(expectedChallenge);
        return new Date("2026-12-01T00:00:00.000Z");
      },
    };
    const emailAuth = new EmailAuthService({
      createUnverifiedAccount: async () => null,
      createVerification: async () => null,
      verifyEmail: async () => false,
      createPasswordReset: async () => null,
      checkPasswordReset: async () => false,
      resetPassword: async () => false,
    }, { sendVerification: async () => undefined, sendPasswordReset: async () => undefined }, "a-pepper-long-enough-for-login-route-test");
    const app = createTestApp({ emailAuth, nativeAuth: new NativeAuthService(nativeStore) });
    const verifier = "v".repeat(43);
    expectedChallenge = createHash("sha256").update(verifier).digest("base64url");
    const startQuery = new URLSearchParams({
      redirect_uri: "http://127.0.0.1:49152/callback", state: "s".repeat(43),
      code_challenge: expectedChallenge, code_challenge_method: "S256",
    });
    const start = await app.inject({ method: "GET", url: `/auth/native?${startQuery}` });
    const cookie = String(start.headers["set-cookie"]);
    flowCookie = cookie.split(";")[0] ?? "";
    const csrf = /name="csrf" value="([^"]+)"/.exec(start.body)?.[1] ?? "";
    const login = await app.inject({
      method: "POST", url: "/auth/native/login",
      headers: { cookie: flowCookie, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ csrf, email: "user@example.test", password }).toString(),
    });
    expect(login.statusCode).toBe(303);
    // La CSP de la propia 303 es la que decide si Chrome/Safari siguen la
    // redirección al callback loopback: sin la fuente loopback el navegador
    // se queda en el formulario y la app nunca recibe el código.
    expect(login.headers["content-security-policy"]).toContain("form-action 'self' http://127.0.0.1:*");
    const callback = new URL(String(login.headers.location));
    expect(callback.origin).toBe("http://127.0.0.1:49152");
    expect(callback.searchParams.get("state")).toBe("s".repeat(43));
    const code = callback.searchParams.get("code") ?? "";
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(login.headers["set-cookie"]).toContain("Max-Age=0");

    const exchange = await app.inject({
      method: "POST", url: "/v1/auth/native/exchange",
      payload: { code, codeVerifier: verifier },
    });
    expect(exchange.statusCode).toBe(200);
    expect(exchange.json().sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(exchange.body).not.toContain(password);
  });

  it("requiere autenticación y no devuelve datos de otra cuenta", async () => {
    const app = createTestApp();
    const unauthorized = await app.inject({ method: "GET", url: "/v1/preferences/current" });
    expect(unauthorized.statusCode).toBe(401);

    const response = await app.inject({ method: "GET", url: "/v1/preferences/current", headers: { authorization: "Bearer account-a" } });
    expect(response.json()).toEqual({ snapshot: null, revision: 0 });
    expect(response.headers.etag).toBe('"0"');
  });

  it("crea una revisión y exige la revisión previa para escribir", async () => {
    const app = createTestApp();
    const saved = await app.inject({
      method: "PUT", url: "/v1/preferences/current",
      headers: { authorization: "Bearer account-a", "if-match": '"0"', "idempotency-key": "request-key-000001" },
      payload: snapshot,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().revision).toBe(1);
    expect(saved.headers.etag).toBe('"1"');

    const conflict = await app.inject({
      method: "PUT", url: "/v1/preferences/current",
      headers: { authorization: "Bearer account-a", "if-match": '"0"', "idempotency-key": "request-key-000002" },
      payload: snapshot,
    });
    expect(conflict.statusCode).toBe(412);
    expect(conflict.json().revision).toBe(1);

    const otherAccount = await app.inject({ method: "GET", url: "/v1/preferences/current", headers: { authorization: "Bearer account-b" } });
    expect(otherAccount.json()).toEqual({ snapshot: null, revision: 0 });
  });

  it("lista, restaura y elimina versiones de forma aislada y con concurrencia", async () => {
    const app = createTestApp();
    const auth = { authorization: "Bearer account-a" };
    const save = async (revision: number, themeId: string, key: string) => app.inject({
      method: "PUT", url: "/v1/preferences/current",
      headers: { ...auth, "if-match": `"${revision}"`, "idempotency-key": key },
      payload: { ...snapshot, preferences: { ...snapshot.preferences, themeId } },
    });
    await save(0, "laurel", "history-save-key-001");
    await save(1, "ocean", "history-save-key-002");

    const listed = await app.inject({ method: "GET", url: "/v1/preferences/history", headers: auth });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().entries).toEqual([{ revision: 1, createdAt: new Date(0).toISOString() }]);
    expect((await app.inject({ method: "GET", url: "/v1/preferences/history" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/preferences/history?limit=51", headers: auth })).statusCode).toBe(400);

    const restoreHeaders = { ...auth, "if-match": '"2"', "idempotency-key": "history-restore-key-001" };
    const restored = await app.inject({ method: "POST", url: "/v1/preferences/history/1/restore", headers: restoreHeaders });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ revision: 3, snapshot: { preferences: { themeId: "laurel" } } });
    expect((await app.inject({ method: "POST", url: "/v1/preferences/history/1/restore", headers: { ...restoreHeaders, "if-match": '"1"' } })).json().revision).toBe(3);
    expect((await app.inject({ method: "POST", url: "/v1/preferences/history/1/restore", headers: { ...auth, "if-match": '"1"', "idempotency-key": "history-restore-key-002" } })).statusCode).toBe(412);

    expect((await app.inject({ method: "GET", url: "/v1/preferences/history", headers: { authorization: "Bearer account-b" } })).json().entries).toEqual([]);
    expect((await app.inject({ method: "DELETE", url: "/v1/preferences/history/1", headers: { authorization: "Bearer account-b" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/v1/preferences/history/1", headers: auth })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: "/v1/preferences/history/1", headers: auth })).statusCode).toBe(404);
  });

  it("valida paginación, revisión e idempotencia del historial antes de operar", async () => {
    const app = createTestApp();
    const auth = { authorization: "Bearer account-a" };
    expect((await app.inject({ method: "GET", url: "/v1/preferences/history?before=0", headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/preferences/history?limit=0", headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: "/v1/preferences/history/0", headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/preferences/history/0/restore", headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/preferences/history/1/restore", headers: auth })).statusCode).toBe(428);
    expect((await app.inject({ method: "POST", url: "/v1/preferences/history/1/restore", headers: { ...auth, "if-match": '"0"', "idempotency-key": "short" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/preferences/history/1/restore", headers: { ...auth, "if-match": '"0"', "idempotency-key": "history-restore-missing" } })).statusCode).toBe(404);
  });

  it("rechaza claves y campos que no forman parte del snapshot", async () => {
    const app = createTestApp();
    const response = await app.inject({
      method: "PUT", url: "/v1/preferences/current",
      headers: { authorization: "Bearer account-a", "if-match": '"0"', "idempotency-key": "request-key-000001" },
      payload: { ...snapshot, providers: [{ ...snapshot.providers[0], apiKey: "secret" }] },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).not.toContain("secret");
  });

  it("exige revisión, clave idempotente válida y snapshot semánticamente consistente", async () => {
    const app = createTestApp();
    const headers = { authorization: "Bearer account-a" };
    const missingRevision = await app.inject({ method: "PUT", url: "/v1/preferences/current", headers, payload: snapshot });
    expect(missingRevision.statusCode).toBe(428);

    const invalidKey = await app.inject({
      method: "PUT", url: "/v1/preferences/current",
      headers: { ...headers, "if-match": '"0"', "idempotency-key": "short" }, payload: snapshot,
    });
    expect(invalidKey.statusCode).toBe(400);

    for (const invalid of [
      { ...snapshot, activeProviderId: "missing" },
      { ...snapshot, providers: [snapshot.providers[0], snapshot.providers[0]] },
      { ...snapshot, providers: [{ ...snapshot.providers[0], customEndpoint: "not a url" }] },
      { ...snapshot, providers: [{ ...snapshot.providers[0], customEndpoint: "https://api.example.test/path?token=x" }] },
    ]) {
      const response = await app.inject({
        method: "PUT", url: "/v1/preferences/current",
        headers: { ...headers, "if-match": '"0"', "idempotency-key": `request-key-${Math.random().toString(36).slice(2, 14)}` },
        payload: invalid,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("permite HTTPS y loopback sin credenciales, y gestiona replay/reutilización idempotente", async () => {
    const app = createTestApp();
    for (const [index, customEndpoint] of ["https://api.example.test/v1", "http://localhost:1234/v1"].entries()) {
      const response = await app.inject({
        method: "PUT", url: "/v1/preferences/current",
        headers: { authorization: "Bearer account-a", "if-match": index === 0 ? '"0"' : '"1"', "idempotency-key": `request-key-valid-${index}` },
        payload: { ...snapshot, providers: [{ ...snapshot.providers[0], customEndpoint }] },
      });
      expect(response.statusCode).toBe(200);
    }

    const original = await app.inject({
      method: "PUT", url: "/v1/preferences/current",
      headers: { authorization: "Bearer account-a", "if-match": '"2"', "idempotency-key": "request-key-replay-0001" },
      payload: snapshot,
    });
    expect(original.statusCode).toBe(200);
    const replay = await app.inject({
      method: "PUT", url: "/v1/preferences/current",
      headers: { authorization: "Bearer account-a", "if-match": '"2"', "idempotency-key": "request-key-replay-0001" },
      payload: snapshot,
    });
    expect(replay.statusCode).toBe(200);
    const reused = await app.inject({
      method: "PUT", url: "/v1/preferences/current",
      headers: { authorization: "Bearer account-a", "if-match": '"2"', "idempotency-key": "request-key-replay-0001" },
      payload: { ...snapshot, preferences: { ...snapshot.preferences, themeId: "ocean" } },
    });
    expect(reused.statusCode).toBe(409);
  });

  it("oculta los errores internos y publica readiness sin detalles", async () => {
    const ready = createTestApp();
    expect((await ready.inject({ method: "GET", url: "/health/ready" })).json()).toEqual({ status: "ok" });

    const unavailable = createTestApp({ checkReadiness: async () => { throw new Error("database password leaked"); } });
    const down = await unavailable.inject({ method: "GET", url: "/health/ready" });
    expect(down.statusCode).toBe(503);
    expect(down.body).not.toContain("database password");

    const brokenStore: PreferenceStore = {
      get: async () => { throw new Error("internal detail"); },
      listHistory: async () => [],
      getHistory: async () => null,
      deleteHistory: async () => false,
      put: async () => { throw new Error("internal detail"); },
    };
    const broken = createTestApp({ store: brokenStore });
    const response = await broken.inject({ method: "GET", url: "/v1/preferences/current", headers: { authorization: "Bearer account-a" } });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("internal detail");
  });

  it("rechaza endpoints con credenciales o por HTTP fuera de loopback", async () => {
    const app = createTestApp();
    for (const customEndpoint of ["https://user:pass@example.com", "http://example.com/v1"]) {
      const response = await app.inject({
        method: "PUT", url: "/v1/preferences/current",
        headers: { authorization: "Bearer account-a", "if-match": '"0"', "idempotency-key": `request-key-${customEndpoint.length}` },
        payload: { ...snapshot, providers: [{ ...snapshot.providers[0], customEndpoint }] },
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("aplica límites de tamaño y cabeceras de seguridad", async () => {
    const app = createTestApp();
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("no-store");

    const large = await app.inject({ method: "PUT", url: "/v1/preferences/current", payload: { data: "x".repeat(270_000) } });
    expect(large.statusCode).toBe(413);
    expect(large.json()).toEqual({ error: "payload_too_large" });
    const oversizedRevision = await app.inject({
      method: "PUT", url: "/v1/preferences/current",
      headers: { authorization: "Bearer account-a", "if-match": `"${Number.MAX_SAFE_INTEGER + 1}"`, "idempotency-key": "request-key-000001" },
      payload: snapshot,
    });
    expect(oversizedRevision.statusCode).toBe(428);
  });
});
