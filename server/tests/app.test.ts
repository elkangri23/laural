import { afterEach, describe, expect, it } from "vitest";
import type { PreferenceSnapshot, PreferenceStore, StoredSnapshot, WriteSnapshotResult } from "../src/contracts.js";
import { createApp } from "../src/app.js";

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
function createTestApp(options: { store?: PreferenceStore; checkReadiness?: () => Promise<void> } = {}): ReturnType<typeof createApp> {
  const store = options.store ?? new MemoryStore();
  const app = createApp({
    store,
    authenticate: async (authorization) => {
      const match = authorization?.match(/^Bearer account-([a-z0-9]+)$/);
      return match?.[1] ?? null;
    },
    checkReadiness: options.checkReadiness ?? (async () => undefined),
  });
  instances.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((app) => app.close()));
});

describe("API de snapshots de preferencias", () => {
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
