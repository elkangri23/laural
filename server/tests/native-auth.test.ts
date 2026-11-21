import argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";
import type { NativeAuthStore, NativeFlowParameters, NativeLoginCandidate } from "../src/native-auth.js";
import { NativeAuthService, sha256, validateNativeFlowParameters } from "../src/native-auth.js";

const parameters: NativeFlowParameters = {
  redirectUri: "http://127.0.0.1:49152/callback",
  state: "s".repeat(43),
  codeChallenge: "c".repeat(43),
};

function fakeStore(candidate: NativeLoginCandidate | null = null) {
  const store: NativeAuthStore = {
    createFlow: vi.fn(async () => undefined),
    isFlowActive: vi.fn(async () => true),
    findLoginCandidate: vi.fn(async () => candidate),
    failLogin: vi.fn(async () => undefined),
    completeLogin: vi.fn(async () => ({ redirectUri: parameters.redirectUri, state: parameters.state })),
    exchangeCode: vi.fn(async () => new Date("2026-12-01T00:00:00.000Z")),
  };
  return store;
}

describe("autenticación nativa con navegador y PKCE", () => {
  it("solo admite callback loopback HTTP exacto y parámetros S256", () => {
    expect(validateNativeFlowParameters(parameters)).toBe(true);
    for (const redirectUri of [
      "https://example.test/callback",
      "http://localhost:49152/callback",
      "http://127.0.0.1:0/callback",
      "http://127.0.0.1:49152/callback?next=https://attacker.test",
      "http://127.0.0.1:49152/callback#fragment",
      "http://user:pass@127.0.0.1:49152/callback",
      "http://127.0.0.1:49152/other",
    ]) expect(validateNativeFlowParameters({ ...parameters, redirectUri })).toBe(false);
    expect(validateNativeFlowParameters({ ...parameters, state: "short" })).toBe(false);
    expect(validateNativeFlowParameters({ ...parameters, codeChallenge: "not-a-challenge" })).toBe(false);
  });

  it("crea cookie y token CSRF aleatorios, guardando solo sus hashes", async () => {
    const store = fakeStore();
    const service = new NativeAuthService(store);
    const credentials = await service.startFlow(parameters);
    expect(credentials.cookieToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(credentials.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(credentials.cookieToken).not.toBe(credentials.csrfToken);
    expect(store.createFlow).toHaveBeenCalledWith({
      ...parameters,
      cookieDigest: sha256(credentials.cookieToken),
      csrfDigest: sha256(credentials.csrfToken),
    });
    await expect(service.isBrowserFlowValid(credentials.cookieToken, credentials.csrfToken)).resolves.toBe(true);
    expect(await service.isBrowserFlowValid(undefined, credentials.csrfToken)).toBe(false);
  });

  it("autentica usuario verificado y devuelve un código opaco ligado al flujo", async () => {
    const password = "password for Laural 2026";
    const passwordHash = await argon2.hash(password);
    const candidate: NativeLoginCandidate = {
      flowId: "flow-1", redirectUri: parameters.redirectUri, state: parameters.state,
      codeChallenge: parameters.codeChallenge, accountId: "account-1", passwordHash, emailVerified: true,
    };
    const store = fakeStore(candidate);
    const service = new NativeAuthService(store);
    const result = await service.login({ cookieToken: "a".repeat(43), csrfToken: "b".repeat(43), email: "User@Example.test", password });
    expect(result).toMatchObject({ redirectUri: parameters.redirectUri, state: parameters.state });
    expect(result?.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.completeLogin).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "account-1", codeDigest: sha256(result!.code),
    }));
    expect(store.failLogin).not.toHaveBeenCalled();
  });

  it("no autentica contraseña incorrecta, email desconocido o cuenta sin verificar", async () => {
    const passwordHash = await argon2.hash("correct password 2026");
    const base: NativeLoginCandidate = {
      flowId: "flow-1", redirectUri: parameters.redirectUri, state: parameters.state,
      codeChallenge: parameters.codeChallenge, accountId: "account-1", passwordHash, emailVerified: true,
    };
    const wrong = fakeStore(base);
    expect(await new NativeAuthService(wrong).login({
      cookieToken: "a".repeat(43), csrfToken: "b".repeat(43), email: "user@example.test", password: "wrong password 2026",
    })).toBeNull();
    expect(wrong.failLogin).toHaveBeenCalledOnce();
    expect(wrong.completeLogin).not.toHaveBeenCalled();

    const unknown = fakeStore(null);
    expect(await new NativeAuthService(unknown).login({
      cookieToken: "a".repeat(43), csrfToken: "b".repeat(43), email: "missing@example.test", password: "wrong password 2026",
    })).toBeNull();
    expect(unknown.failLogin).toHaveBeenCalledOnce();

    const unverified = fakeStore({ ...base, emailVerified: false });
    expect(await new NativeAuthService(unverified).login({
      cookieToken: "a".repeat(43), csrfToken: "b".repeat(43), email: "user@example.test", password: "correct password 2026",
    })).toBeNull();

    const expiredFlow = fakeStore(base);
    expiredFlow.completeLogin = vi.fn(async () => null);
    expect(await new NativeAuthService(expiredFlow).login({
      cookieToken: "a".repeat(43), csrfToken: "b".repeat(43), email: "user@example.test", password: "correct password 2026",
    })).toBeNull();
  });

  it("intercambia el código una sola vez usando el verificador PKCE y crea token de sesión opaco", async () => {
    const store = fakeStore();
    const service = new NativeAuthService(store);
    const code = "k".repeat(43);
    const verifier = "v".repeat(43);
    const grant = await service.exchange(code, verifier);
    expect(grant?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(grant?.expiresAt).toBe("2026-12-01T00:00:00.000Z");
    expect(store.exchangeCode).toHaveBeenCalledWith(
      sha256(code),
      (await import("node:crypto")).createHash("sha256").update(verifier).digest("base64url"),
      sha256(grant!.token),
    );
    await expect(service.exchange("short", verifier)).resolves.toBeNull();
    await expect(service.exchange(code, "bad")).resolves.toBeNull();
    expect(store.exchangeCode).toHaveBeenCalledOnce();
  });
});
