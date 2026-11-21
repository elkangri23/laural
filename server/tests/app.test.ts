import { afterEach, describe, expect, it } from "vitest";
import argon2 from "argon2";
import { createHash } from "node:crypto";
import type { PreferenceSnapshot, PreferenceStore, StoredSnapshot, WriteSnapshotResult } from "../src/contracts.js";
import { createApp } from "../src/app.js";
import { EmailAuthService } from "../src/email-auth.js";
import { NativeAuthService, type NativeAuthStore } from "../src/native-auth.js";

const snapshot: PreferenceSnapshot = {
  schemaVersion: 1,
  preferences: { themeId: "laurel", appearance: "dark", updateMode: "manual" },
  activeProviderId: "local",
  providers: [{ id: "local", kind: "ollama", name: "Local", model: "llama3" }],
};

class MemoryStore implements PreferenceStore {
  private records = new Map<string, StoredSnapshot>();
  private keys = new Map<string, { snapshot: PreferenceSnapshot; revision: number; digest: string }>();

  async get(accountId: string): Promise<StoredSnapshot> {
    return structuredClone(this.records.get(accountId) ?? { snapshot: null, revision: 0 });
  }

  async put(accountId: string, expectedRevision: number, key: string, value: PreferenceSnapshot): Promise<WriteSnapshotResult> {
    const digest = JSON.stringify(value);
    const previous = this.keys.get(`${accountId}:${key}`);
    if (previous) return previous.digest === digest
      ? { kind: "replayed", snapshot: structuredClone(previous.snapshot), revision: previous.revision }
      : { kind: "idempotency_key_reused" };
    const current = await this.get(accountId);
    if (current.revision !== expectedRevision) return { kind: "conflict", revision: current.revision };
    const result = { snapshot: structuredClone(value), revision: current.revision + 1 };
    this.records.set(accountId, result);
    this.keys.set(`${accountId}:${key}`, { ...result, digest });
    return { kind: "saved", ...result };
  }
}

const instances: Array<ReturnType<typeof createApp>> = [];
function createTestApp(options: { store?: PreferenceStore; checkReadiness?: () => Promise<void>; emailAuth?: EmailAuthService; nativeAuth?: NativeAuthService } = {}): ReturnType<typeof createApp> {
  const store = options.store ?? new MemoryStore();
  const app = createApp({
    store,
    authenticate: async (authorization) => {
      const match = authorization?.match(/^Bearer account-([a-z0-9]+)$/);
      return match?.[1] ?? null;
    },
    checkReadiness: options.checkReadiness ?? (async () => undefined),
    ...(options.emailAuth ? { emailAuth: options.emailAuth } : {}),
    ...(options.nativeAuth ? { nativeAuth: options.nativeAuth } : {}),
  });
  instances.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((app) => app.close()));
});

describe("API de snapshots de preferencias", () => {
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
    }, {
      sendVerification: async ({ pin }) => { sentPin = pin; },
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
  });

  it("sirve página propia sin scripts y restringe el inicio a callback loopback", async () => {
    const disabled = createTestApp({ emailAuth: new EmailAuthService({
      createUnverifiedAccount: async () => null,
      createVerification: async () => null,
      verifyEmail: async () => false,
    }, { sendVerification: async () => undefined }, "a-pepper-long-enough-for-auth-page-test" ) });
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
    }, { sendVerification: async () => undefined }, "a-pepper-long-enough-for-auth-page-test");
    const app = createTestApp({ emailAuth, nativeAuth: new NativeAuthService(nativeStore) });
    const query = new URLSearchParams({
      redirect_uri: "http://127.0.0.1:49152/callback",
      state: "s".repeat(43), code_challenge: "c".repeat(43), code_challenge_method: "S256",
    });
    const response = await app.inject({ method: "GET", url: `/auth/native?${query}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-security-policy"]).toContain("form-action 'self'");
    expect(response.headers["set-cookie"]).toContain("HttpOnly; SameSite=Strict");
    expect(response.body).toContain("lang=\"es\"");
    expect(response.body).toContain("name=\"password\"");
    expect(response.body).not.toContain("<script");
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

  it("valida la cookie y el CSRF en registro, reenvío y confirmación del navegador", async () => {
    const verificationEmail = "user@example.test";
    const accountStore = {
      createUnverifiedAccount: async () => ({ id: "account-a" }),
      createVerification: async () => ({ accountId: "account-a", displayName: "User", challengeId: "challenge-a" }),
      verifyEmail: async () => true,
    };
    const mailer = { sendVerification: async () => undefined };
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
    }, { sendVerification: async () => undefined }, "a-pepper-long-enough-for-login-route-test");
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
