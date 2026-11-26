import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { OAuth2Client } from "google-auth-library";
import { GoogleOAuthService } from "../src/google-oauth.js";

type HarnessOptions = {
  codeChallenge?: string | null;
  startFlowRowCount?: number;
  activeFlowCounts?: number[];
  idToken?: string | null;
  claims?: Record<string, unknown> | null;
  getTokenError?: Error;
  verifyTokenError?: Error;
  startInsertError?: Error;
  linkedAccountId?: string;
  createdAccountId?: string | null;
  identityInsertError?: Error;
  consumeError?: Error;
};

function harness(emailVerified = true, nonceValid = true, existingAccount?: { id: string; emailVerifiedAt: Date | null }, options: HarnessOptions = {}) {
  let nonce = "";
  let activeFlowCalls = 0;
  const defaultClaims = {
    sub: "google-subject-1", email: "person@example.test", email_verified: emailVerified, nonce: nonceValid ? "" : "wrong-nonce",
  };
  const client = {
    generateCodeVerifierAsync: vi.fn(async () => ({ codeVerifier: "v".repeat(43), codeChallenge: options.codeChallenge === undefined ? "c".repeat(43) : options.codeChallenge })),
    generateAuthUrl: vi.fn((options: { nonce: string; state: string; code_challenge: string; code_challenge_method: string; scope: string[] }) => {
      nonce = options.nonce;
      return `https://accounts.google.com/o/oauth2/v2/auth?state=${options.state}`;
    }),
    getToken: vi.fn(async (options: { code: string; codeVerifier: string }) => {
      if (harnessOptions.getTokenError) throw harnessOptions.getTokenError;
      expect(options).toMatchObject({ code: "google-code", codeVerifier: "v".repeat(43) });
      return { tokens: { id_token: harnessOptions.idToken === undefined ? "signed-id-token" : harnessOptions.idToken } };
    }),
    verifyIdToken: vi.fn(async () => {
      if (harnessOptions.verifyTokenError) throw harnessOptions.verifyTokenError;
      return { getPayload: () => harnessOptions.claims === null ? null : {
        ...defaultClaims, nonce: nonceValid ? nonce : "wrong-nonce", ...harnessOptions.claims,
      } };
    }),
  } as unknown as OAuth2Client;
  const harnessOptions = options;
  const transactions = new Map<string, { cookie_digest: string; csrf_digest: string; nonce_digest: string; code_verifier: string }>();
  let stateDigest = "";
  let insertedIdentity = false;
  let createdAccount = false;
  const clientConnection = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT 1 FROM native_auth_flows")) {
        const rowCount = harnessOptions.startFlowRowCount ?? 1;
        return { rows: rowCount === 1 ? [{ present: 1 }] : [], rowCount };
      }
      if (sql.includes("INSERT INTO google_oauth_transactions")) {
        if (harnessOptions.startInsertError) throw harnessOptions.startInsertError;
        stateDigest = String(params[0]);
        transactions.set(stateDigest, {
          cookie_digest: String(params[1]), csrf_digest: String(params[2]), nonce_digest: String(params[3]), code_verifier: String(params[4]),
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("DELETE FROM google_oauth_transactions")) {
        if (harnessOptions.consumeError) throw harnessOptions.consumeError;
        const transaction = transactions.get(String(params[0]));
        transactions.delete(String(params[0]));
        return { rows: transaction ? [transaction] : [], rowCount: transaction ? 1 : 0 };
      }
      if (sql.includes("SELECT i.account_id")) return harnessOptions.linkedAccountId
        ? { rows: [{ account_id: harnessOptions.linkedAccountId }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
      if (sql.includes("SELECT id, email_verified_at FROM accounts")) return {
        rows: existingAccount ? [{ id: existingAccount.id, email_verified_at: existingAccount.emailVerifiedAt }] : [],
        rowCount: existingAccount ? 1 : 0,
      };
      if (sql.includes("INSERT INTO accounts")) {
        const id = harnessOptions.createdAccountId === undefined ? "account-created" : harnessOptions.createdAccountId;
        createdAccount = Boolean(id);
        return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
      }
      if (sql.includes("INSERT INTO account_identities")) {
        if (harnessOptions.identityInsertError) throw harnessOptions.identityInsertError;
        insertedIdentity = true;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => clientConnection),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM native_auth_flows")) {
        const count = harnessOptions.activeFlowCounts?.[activeFlowCalls] ?? 1;
        activeFlowCalls += 1;
        return { rows: count === 1 ? [{ present: 1 }] : [], rowCount: count };
      }
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as Pick<Pool, "query" | "connect">;
  const service = new GoogleOAuthService(pool, {
    clientId: "client.apps.googleusercontent.com", clientSecret: "secret", redirectUri: "https://sync.example.test/auth/google/callback",
  }, client);
  return { service, client, clientConnection, pool, transactions, getStateDigest: () => stateDigest, identityInserted: () => insertedIdentity, accountCreated: () => createdAccount };
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

  it("vincula el Google verificado a una cuenta verificada existente sin duplicarla", async () => {
    const test = harness(true, true, { id: "existing-account", emailVerifiedAt: new Date() });
    const url = await test.service.start("a".repeat(64), "b".repeat(64));
    const state = new URL(url).searchParams.get("state")!;
    await expect(test.service.finish(state, "google-code")).resolves.toMatchObject({ accountId: "existing-account" });
    expect(test.accountCreated()).toBe(false);
    expect(test.identityInserted()).toBe(true);
  });

  it("no asocia por correo a una cuenta Laural que todavía no verificó su email", async () => {
    const test = harness(true, true, { id: "unverified-account", emailVerifiedAt: null });
    const url = await test.service.start("a".repeat(64), "b".repeat(64));
    const state = new URL(url).searchParams.get("state")!;
    expect(await test.service.finish(state, "google-code")).toBeNull();
    expect(test.identityInserted()).toBe(false);
    expect(test.accountCreated()).toBe(false);
  });

  it("no acepta state mal formado", async () => {
    const test = harness();
    expect(await test.service.finish("bad", "google-code")).toBeNull();
  });

  it("exige digests, desafío PKCE y flujo activo antes de persistir el inicio", async () => {
    const invalidDigest = harness();
    await expect(invalidDigest.service.start("bad", "b".repeat(64))).rejects.toThrow("Flujo OAuth no válido");
    expect(invalidDigest.client.generateCodeVerifierAsync).not.toHaveBeenCalled();

    const missingChallenge = harness(true, true, undefined, { codeChallenge: null });
    await expect(missingChallenge.service.start("a".repeat(64), "b".repeat(64))).rejects.toThrow("desafío PKCE");
    expect(missingChallenge.pool.connect).not.toHaveBeenCalled();

    const expiredFlow = harness(true, true, undefined, { startFlowRowCount: 0 });
    await expect(expiredFlow.service.start("a".repeat(64), "b".repeat(64))).rejects.toThrow("Flujo OAuth caducado");
    expect(expiredFlow.clientConnection.query).toHaveBeenCalledWith("ROLLBACK");
    expect(expiredFlow.clientConnection.release).toHaveBeenCalledOnce();
  });

  it("revierte el inicio si no puede guardar la transacción OAuth", async () => {
    const test = harness(true, true, undefined, { startInsertError: new Error("oauth storage failed") });
    await expect(test.service.start("a".repeat(64), "b".repeat(64))).rejects.toThrow("oauth storage failed");
    expect(test.clientConnection.query).toHaveBeenCalledWith("ROLLBACK");
    expect(test.clientConnection.release).toHaveBeenCalledOnce();
    expect(test.client.generateAuthUrl).not.toHaveBeenCalled();
  });

  it("rechaza códigos vacíos/largos y no revela estados caducados o consumidos", async () => {
    const test = harness();
    await expect(test.service.finish("s".repeat(43), "")).resolves.toBeNull();
    await expect(test.service.finish("s".repeat(43), "x".repeat(2049))).resolves.toBeNull();
    await expect(test.service.finish("s".repeat(43), "google-code")).resolves.toBeNull();
    await expect(test.service.cancel("invalid-state")).resolves.toBeUndefined();
    expect(test.pool.connect).toHaveBeenCalledOnce();

    const expiredFlow = harness(true, true, undefined, { activeFlowCounts: [0] });
    const url = await expiredFlow.service.start("a".repeat(64), "b".repeat(64));
    const state = new URL(url).searchParams.get("state")!;
    expect(await expiredFlow.service.finish(state, "google-code")).toBeNull();
    expect(expiredFlow.client.getToken).not.toHaveBeenCalled();
  });

  it("consume el state aunque falte el id token o falle el intercambio con Google", async () => {
    const noIdToken = harness(true, true, undefined, { idToken: null });
    const url = await noIdToken.service.start("a".repeat(64), "b".repeat(64));
    const state = new URL(url).searchParams.get("state")!;
    await expect(noIdToken.service.finish(state, "google-code")).resolves.toBeNull();
    expect(noIdToken.client.verifyIdToken).not.toHaveBeenCalled();
    expect(noIdToken.transactions.size).toBe(0);

    const failedExchange = harness(true, true, undefined, { getTokenError: new Error("token exchange failed") });
    const failedUrl = await failedExchange.service.start("a".repeat(64), "b".repeat(64));
    const failedState = new URL(failedUrl).searchParams.get("state")!;
    await expect(failedExchange.service.finish(failedState, "google-code")).resolves.toBeNull();
    expect(failedExchange.transactions.size).toBe(0);

    const failedVerification = harness(true, true, undefined, { verifyTokenError: new Error("bad id token") });
    const verificationUrl = await failedVerification.service.start("a".repeat(64), "b".repeat(64));
    const verificationState = new URL(verificationUrl).searchParams.get("state")!;
    await expect(failedVerification.service.finish(verificationState, "google-code")).resolves.toBeNull();
  });

  it("construye el cliente OAuth configurado por defecto sin iniciar ninguna solicitud de red", async () => {
    const test = harness();
    const service = new GoogleOAuthService(test.pool, {
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "secret",
      redirectUri: "https://sync.example.test/auth/google/callback",
    });
    const url = await service.start("a".repeat(64), "b".repeat(64));
    expect(url).toContain("accounts.google.com");
  });

  it("rechaza claims incompletos o no válidos y no continúa si el flujo caduca", async () => {
    const invalidClaims: Array<Record<string, unknown> | null> = [
      null,
      { sub: "" },
      { sub: "x".repeat(256) },
      { email: 7 },
      { email: "x".repeat(321) },
      { email_verified: false },
      { nonce: 7 },
      { email: "invalid" },
    ];
    for (const claims of invalidClaims) {
      const test = harness(true, true, undefined, { claims });
      const url = await test.service.start("a".repeat(64), "b".repeat(64));
      const state = new URL(url).searchParams.get("state")!;
      await expect(test.service.finish(state, "google-code")).resolves.toBeNull();
      expect(test.identityInserted()).toBe(false);
    }

    const expiredDuringVerification = harness(true, true, undefined, { activeFlowCounts: [1, 0] });
    const url = await expiredDuringVerification.service.start("a".repeat(64), "b".repeat(64));
    const state = new URL(url).searchParams.get("state")!;
    await expect(expiredDuringVerification.service.finish(state, "google-code")).resolves.toBeNull();
    expect(expiredDuringVerification.client.verifyIdToken).toHaveBeenCalledOnce();
    expect(expiredDuringVerification.identityInserted()).toBe(false);
  });

  it("reutiliza una identidad Google existente y maneja carreras al crear una identidad", async () => {
    const linked = harness(true, true, undefined, { linkedAccountId: "linked-account" });
    const url = await linked.service.start("a".repeat(64), "b".repeat(64));
    const state = new URL(url).searchParams.get("state")!;
    await expect(linked.service.finish(state, "google-code")).resolves.toMatchObject({ accountId: "linked-account" });
    expect(linked.accountCreated()).toBe(false);
    expect(linked.identityInserted()).toBe(false);

    for (const error of [Object.assign(new Error("duplicate identity"), { code: "23505" }), new Error("identity storage failed")]) {
      const race = harness(true, true, undefined, { identityInsertError: error });
      const raceUrl = await race.service.start("a".repeat(64), "b".repeat(64));
      const raceState = new URL(raceUrl).searchParams.get("state")!;
      await expect(race.service.finish(raceState, "google-code")).resolves.toBeNull();
      expect(race.clientConnection.query).toHaveBeenCalledWith("ROLLBACK");
    }

    const missingCreatedId = harness(true, true, undefined, { createdAccountId: null });
    const missingUrl = await missingCreatedId.service.start("a".repeat(64), "b".repeat(64));
    const missingState = new URL(missingUrl).searchParams.get("state")!;
    await expect(missingCreatedId.service.finish(missingState, "google-code")).resolves.toBeNull();
    expect(missingCreatedId.clientConnection.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("revierte el consumo del state si falla el almacenamiento", async () => {
    const test = harness(true, true, undefined, { consumeError: new Error("transaction store unavailable") });
    const url = await test.service.start("a".repeat(64), "b".repeat(64));
    const state = new URL(url).searchParams.get("state")!;
    await expect(test.service.finish(state, "google-code")).rejects.toThrow("transaction store unavailable");
    expect(test.clientConnection.query).toHaveBeenCalledWith("ROLLBACK");
    expect(test.clientConnection.release).toHaveBeenCalledTimes(2);
  });

  it("cancela explícitamente un state válido consumiéndolo de forma transaccional", async () => {
    const test = harness();
    const url = await test.service.start("a".repeat(64), "b".repeat(64));
    const state = new URL(url).searchParams.get("state")!;
    await expect(test.service.cancel(state)).resolves.toBeUndefined();
    expect(test.transactions.size).toBe(0);
    expect(test.clientConnection.query).toHaveBeenCalledWith("COMMIT");
  });
});
