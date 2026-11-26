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
    requireMfa: vi.fn(async () => true),
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
    expect(validateNativeFlowParameters({ ...parameters, redirectUri: "http://[::1" })).toBe(false);
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

  it("rechaza tokens y correos inválidos sin consultar ni penalizar un flujo", async () => {
    const store = fakeStore();
    const service = new NativeAuthService(store);
    expect(await service.login({ cookieToken: "short", csrfToken: "b".repeat(43), email: "user@example.test", password: "password" })).toBeNull();
    expect(await service.login({ cookieToken: "a".repeat(43), csrfToken: "b".repeat(43), email: "sin-correo", password: "password" })).toBeNull();
    expect(store.findLoginCandidate).not.toHaveBeenCalled();
    expect(store.failLogin).toHaveBeenCalledOnce();
  });

  it("autentica usuario verificado y devuelve un código opaco ligado al flujo", async () => {
    const password = "password for Laural 2026";
    const passwordHash = await argon2.hash(password);
    const candidate: NativeLoginCandidate = {
      flowId: "flow-1", redirectUri: parameters.redirectUri, state: parameters.state,
      codeChallenge: parameters.codeChallenge, accountId: "account-1", passwordHash, emailVerified: true, mfaEnabled: false,
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
      codeChallenge: parameters.codeChallenge, accountId: "account-1", passwordHash, emailVerified: true, mfaEnabled: false,
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

  it("detiene el login tras la contraseña y solo emite callback al completar MFA", async () => {
    const password = "correct password 2026";
    const candidate: NativeLoginCandidate = {
      flowId: "flow-mfa", redirectUri: parameters.redirectUri, state: parameters.state,
      codeChallenge: parameters.codeChallenge, accountId: "account-1", passwordHash: await argon2.hash(password),
      emailVerified: true, mfaEnabled: true,
    };
    const store = fakeStore(candidate);
    const verifier = {
      completeMfaLogin: vi.fn(async () => ({ redirectUri: parameters.redirectUri, state: parameters.state })),
    };
    const service = new NativeAuthService(store, verifier);
    const credentials = { cookieToken: "a".repeat(43), csrfToken: "b".repeat(43) };
    await expect(service.login({ ...credentials, email: "user@example.test", password })).resolves.toEqual({ kind: "mfa_required" });
    expect(store.requireMfa).toHaveBeenCalledWith(expect.objectContaining({ flowId: "flow-mfa", accountId: "account-1" }));
    expect(store.completeLogin).not.toHaveBeenCalled();

    const result = await service.completeMfa({ ...credentials, email: "user@example.test", proof: "123456" });
    expect(result).toMatchObject({ kind: "authorized", redirectUri: parameters.redirectUri, state: parameters.state });
    expect(result?.kind === "authorized" && result.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifier.completeMfaLogin).toHaveBeenCalledWith(expect.objectContaining({ email: "user@example.test", proof: "123456" }));

    store.requireMfa = vi.fn(async () => false);
    await expect(service.login({ ...credentials, email: "user@example.test", password })).resolves.toBeNull();
    await expect(service.completeMfa({ ...credentials, email: "user@example.test", proof: "incorrect" })).resolves.toMatchObject({ kind: "authorized" });
    await expect(new NativeAuthService(store).completeMfa({ ...credentials, email: "user@example.test", proof: "123456" })).resolves.toBeNull();
    await expect(service.completeMfa({ cookieToken: "short", csrfToken: credentials.csrfToken, email: "user@example.test", proof: "123456" })).resolves.toBeNull();
    verifier.completeMfaLogin = vi.fn(async () => null);
    await expect(service.completeMfa({ ...credentials, email: "user@example.test", proof: "123456" })).resolves.toBeNull();
  });

  it("permite login passwordless con passkey y añade TOTP si la cuenta lo exige", async () => {
    const candidate: NativeLoginCandidate = {
      flowId: "flow-passkey", redirectUri: parameters.redirectUri, state: parameters.state,
      codeChallenge: parameters.codeChallenge, accountId: "account-1", passwordHash: null,
      emailVerified: true, mfaEnabled: false, email: "user@example.test",
    };
    const store = fakeStore();
    store.findPasskeyLoginCandidate = vi.fn(async () => candidate);
    const service = new NativeAuthService(store);
    const credentials = { cookieToken: "a".repeat(43), csrfToken: "b".repeat(43) };

    const login = await service.completePasskeyLogin({ ...credentials, accountId: "account-1" });
    expect(login).toMatchObject({ kind: "authorized", redirectUri: parameters.redirectUri, state: parameters.state });
    expect(store.completeLogin).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-1" }));

    store.findPasskeyLoginCandidate = vi.fn(async () => ({ ...candidate, mfaEnabled: true }));
    const mfaLogin = await service.completePasskeyLogin({ ...credentials, accountId: "account-1" });
    expect(mfaLogin).toEqual({ kind: "mfa_required", email: "user@example.test" });
    expect(store.requireMfa).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-1" }));

    store.requireMfa = vi.fn(async () => false);
    await expect(service.completePasskeyLogin({ ...credentials, accountId: "account-1" })).resolves.toBeNull();
    store.findPasskeyLoginCandidate = vi.fn(async () => ({ ...candidate, mfaEnabled: true, email: undefined }));
    store.requireMfa = vi.fn(async () => true);
    await expect(service.completePasskeyLogin({ ...credentials, accountId: "account-1" })).resolves.toEqual({ kind: "mfa_required" });
    store.findPasskeyLoginCandidate = vi.fn(async () => null);
    await expect(service.completePasskeyLogin({ ...credentials, accountId: "account-1" })).resolves.toBeNull();
    store.findPasskeyLoginCandidate = vi.fn(async () => candidate);
    store.completeLogin = vi.fn(async () => null);
    await expect(service.completePasskeyLogin({ ...credentials, accountId: "account-1" })).resolves.toBeNull();
    await expect(service.completePasskeyLogin({ cookieToken: "short", csrfToken: credentials.csrfToken, accountId: "account-1" })).resolves.toBeNull();
    store.findPasskeyLoginCandidate = undefined;
    await expect(service.completePasskeyLogin({ ...credentials, accountId: "account-1" })).resolves.toBeNull();
  });

  it("rota el CSRF tras Google y conserva el challenge TOTP de la cuenta", async () => {
    const candidate: NativeLoginCandidate = {
      flowId: "flow-google-mfa", redirectUri: parameters.redirectUri, state: parameters.state,
      codeChallenge: parameters.codeChallenge, accountId: "account-google", passwordHash: null,
      emailVerified: true, mfaEnabled: true, email: "user@example.test",
    };
    const store = fakeStore();
    store.rotateFlowCsrf = vi.fn(async () => true);
    store.findPasskeyLoginCandidate = vi.fn(async () => candidate);
    const service = new NativeAuthService(store);
    const result = await service.completeFederatedLogin({
      cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64), accountId: "account-google",
    });
    expect(result?.login).toEqual({ kind: "mfa_required", email: "user@example.test" });
    expect(result?.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.rotateFlowCsrf).toHaveBeenCalledWith("a".repeat(64), "b".repeat(64), sha256(result!.csrfToken));
    expect(store.requireMfa).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-google" }));
    expect(store.completeLogin).not.toHaveBeenCalled();

    store.findPasskeyLoginCandidate = vi.fn(async () => ({ ...candidate, mfaEnabled: false, email: undefined }));
    await expect(service.completeFederatedLogin({ cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64), accountId: "x" })).resolves.toMatchObject({ login: { kind: "authorized" } });
    store.findPasskeyLoginCandidate = vi.fn(async () => ({ ...candidate, mfaEnabled: true, email: undefined }));
    store.requireMfa = vi.fn(async () => true);
    await expect(service.completeFederatedLogin({ cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64), accountId: "x" })).resolves.toMatchObject({ login: { kind: "mfa_required" } });
    store.requireMfa = vi.fn(async () => false);
    await expect(service.completeFederatedLogin({ cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64), accountId: "x" })).resolves.toBeNull();

    await expect(service.completeFederatedLogin({ cookieDigest: "invalid", csrfDigest: "b".repeat(64), accountId: "x" })).resolves.toBeNull();
    store.rotateFlowCsrf = vi.fn(async () => false);
    await expect(service.completeFederatedLogin({ cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64), accountId: "x" })).resolves.toBeNull();
    store.rotateFlowCsrf = vi.fn(async () => true);
    store.findPasskeyLoginCandidate = vi.fn(async () => null);
    await expect(service.completeFederatedLogin({ cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64), accountId: "x" })).resolves.toBeNull();
    store.findPasskeyLoginCandidate = vi.fn(async () => ({ ...candidate, mfaEnabled: false }));
    store.completeLogin = vi.fn(async () => null);
    await expect(service.completeFederatedLogin({ cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64), accountId: "x" })).resolves.toBeNull();
  });

  it("penaliza intentos de passkey solo con tokens opacos y procesa login federado sin MFA", async () => {
    const store = fakeStore();
    const service = new NativeAuthService(store);
    await service.failPasskeyLogin("short", "b".repeat(43));
    await service.failPasskeyLogin("a".repeat(43), "short");
    expect(store.failLogin).not.toHaveBeenCalled();
    await service.failPasskeyLogin("a".repeat(43), "b".repeat(43));
    expect(store.failLogin).toHaveBeenCalledOnce();

    store.rotateFlowCsrf = vi.fn(async () => true);
    store.findPasskeyLoginCandidate = vi.fn(async () => ({
      flowId: "federated", redirectUri: parameters.redirectUri, state: parameters.state,
      codeChallenge: parameters.codeChallenge, accountId: "account-1", passwordHash: null,
      emailVerified: true, mfaEnabled: false,
    }));
    const result = await service.completeFederatedLogin({ cookieDigest: "a".repeat(64), csrfDigest: "b".repeat(64), accountId: "account-1" });
    expect(result?.login).toMatchObject({ kind: "authorized" });
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
    store.exchangeCode = vi.fn(async () => null);
    await expect(service.exchange(code, verifier)).resolves.toBeNull();
    expect(store.exchangeCode).toHaveBeenCalledOnce();
  });
});
