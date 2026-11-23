import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { OAuth2Client } from "google-auth-library";
import { GoogleOAuthService } from "../src/google-oauth.js";

function harness(emailVerified = true, nonceValid = true) {
  let nonce = "";
  const client = {
    generateCodeVerifierAsync: vi.fn(async () => ({ codeVerifier: "v".repeat(43), codeChallenge: "c".repeat(43) })),
    generateAuthUrl: vi.fn((options: { nonce: string; state: string; code_challenge: string; code_challenge_method: string; scope: string[] }) => {
      nonce = options.nonce;
      return `https://accounts.google.com/o/oauth2/v2/auth?state=${options.state}`;
    }),
    getToken: vi.fn(async (options: { code: string; codeVerifier: string }) => {
      expect(options).toMatchObject({ code: "google-code", codeVerifier: "v".repeat(43) });
      return { tokens: { id_token: "signed-id-token" } };
    }),
    verifyIdToken: vi.fn(async () => ({ getPayload: () => ({
      sub: "google-subject-1", email: "person@example.test", email_verified: emailVerified, nonce: nonceValid ? nonce : "wrong-nonce",
    }) })),
  } as unknown as OAuth2Client;
  const transactions = new Map<string, { cookie_digest: string; csrf_digest: string; nonce_digest: string; code_verifier: string }>();
  let stateDigest = "";
  let insertedIdentity = false;
  const clientConnection = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT 1 FROM native_auth_flows")) return { rows: [{ present: 1 }], rowCount: 1 };
      if (sql.includes("INSERT INTO google_oauth_transactions")) {
        stateDigest = String(params[0]);
        transactions.set(stateDigest, {
          cookie_digest: String(params[1]), csrf_digest: String(params[2]), nonce_digest: String(params[3]), code_verifier: String(params[4]),
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("DELETE FROM google_oauth_transactions")) {
        const transaction = transactions.get(String(params[0]));
        transactions.delete(String(params[0]));
        return { rows: transaction ? [transaction] : [], rowCount: transaction ? 1 : 0 };
      }
      if (sql.includes("SELECT i.account_id")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT id, email_verified_at FROM accounts")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO accounts")) return { rows: [{ id: "account-created" }], rowCount: 1 };
      if (sql.includes("INSERT INTO account_identities")) { insertedIdentity = true; return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: async () => clientConnection,
    query: vi.fn(async (sql: string) => sql.includes("FROM native_auth_flows") ? { rows: [{ present: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 }),
  } as unknown as Pick<Pool, "query" | "connect">;
  const service = new GoogleOAuthService(pool, {
    clientId: "client.apps.googleusercontent.com", clientSecret: "secret", redirectUri: "https://sync.example.test/auth/google/callback",
  }, client);
  return { service, client, clientConnection, transactions, getStateDigest: () => stateDigest, identityInserted: () => insertedIdentity };
}

describe("Google OAuth", () => {
  it("crea estado, nonce y PKCE asociados al flujo y consume el estado una sola vez", async () => {
    const test = harness();
    const cookieDigest = "a".repeat(64);
    const csrfDigest = "b".repeat(64);
    const url = await test.service.start(cookieDigest, csrfDigest);
    expect(url).toContain("accounts.google.com");
    expect(test.client.generateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
      scope: ["openid", "email"], code_challenge_method: "S256", prompt: "select_account",
    }));
    const state = new URL(url).searchParams.get("state")!;
    expect(state).toHaveLength(43);
    const flow = await test.service.finish(state, "google-code");
    expect(flow).toEqual({ cookieDigest, csrfDigest, accountId: "account-created" });
    expect(test.identityInserted()).toBe(true);
    expect(test.transactions.size).toBe(0);
    expect(await test.service.finish(state, "google-code")).toBeNull();
  });

  it("rechaza correos no verificados sin crear ni vincular cuentas", async () => {
    const test = harness(false);
    const url = await test.service.start("a".repeat(64), "b".repeat(64));
    const state = new URL(url).searchParams.get("state")!;
    expect(await test.service.finish(state, "google-code")).toBeNull();
    expect(test.identityInserted()).toBe(false);
  });

  it("rechaza un ID token con nonce distinto al desafío de esta sesión", async () => {
    const test = harness(true, false);
    const url = await test.service.start("a".repeat(64), "b".repeat(64));
    const state = new URL(url).searchParams.get("state")!;
    expect(await test.service.finish(state, "google-code")).toBeNull();
    expect(test.identityInserted()).toBe(false);
  });

  it("no acepta state mal formado", async () => {
    const test = harness();
    expect(await test.service.finish("bad", "google-code")).toBeNull();
  });
});
