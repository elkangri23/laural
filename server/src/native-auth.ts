import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";

export type NativeFlowParameters = {
  redirectUri: string;
  state: string;
  codeChallenge: string;
};

export type NativeLoginCandidate = {
  flowId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  accountId: string | null;
  passwordHash: string | null;
  emailVerified: boolean;
  mfaEnabled: boolean;
  email?: string;
};

export type AuthorizationRedirect = { redirectUri: string; state: string };
export type SessionGrant = { token: string; expiresAt: string };

export interface NativeAuthStore {
  createFlow(input: NativeFlowParameters & { cookieDigest: string; csrfDigest: string }): Promise<void>;
  isFlowActive(cookieDigest: string, csrfDigest: string): Promise<boolean>;
  findLoginCandidate(cookieDigest: string, csrfDigest: string, email: string): Promise<NativeLoginCandidate | null>;
  findPasskeyLoginCandidate?(cookieDigest: string, csrfDigest: string, accountId: string): Promise<NativeLoginCandidate | null>;
  failLogin(cookieDigest: string, csrfDigest: string): Promise<void>;
  requireMfa(input: { flowId: string; cookieDigest: string; csrfDigest: string; accountId: string }): Promise<boolean>;
  completeLogin(input: {
    flowId: string;
    cookieDigest: string;
    csrfDigest: string;
    accountId: string;
    codeDigest: string;
  }): Promise<AuthorizationRedirect | null>;
  exchangeCode(codeDigest: string, codeChallenge: string, sessionDigest: string): Promise<Date | null>;
}

export type NativeFlowCredentials = { cookieToken: string; csrfToken: string };
export type NativeLoginInput = { cookieToken: string; csrfToken: string; email: string; password: string };
export type NativeMfaLoginInput = { cookieToken: string; csrfToken: string; email: string; proof: string };
export type LoginResult = { kind: "authorized"; redirectUri: string; state: string; code: string } | { kind: "mfa_required"; email?: string };

export interface MfaLoginVerifier {
  completeMfaLogin(input: { cookieDigest: string; csrfDigest: string; email: string; proof: string; codeDigest: string }): Promise<AuthorizationRedirect | null>;
}

const SESSION_TTL_DAYS = 30;
const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
};
const DUMMY_PASSWORD_HASH = argon2.hash(randomBytes(32), { ...ARGON_OPTIONS, salt: randomBytes(16) });

export class NativeAuthService {
  constructor(private readonly store: NativeAuthStore, private readonly mfaVerifier?: MfaLoginVerifier) {}

  async startFlow(parameters: NativeFlowParameters): Promise<NativeFlowCredentials> {
    const cookieToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    await this.store.createFlow({
      ...parameters,
      cookieDigest: sha256(cookieToken),
      csrfDigest: sha256(csrfToken),
    });
    return { cookieToken, csrfToken };
  }

  async isBrowserFlowValid(cookieToken: string | undefined, csrfToken: string): Promise<boolean> {
    if (!isOpaqueToken(cookieToken) || !isOpaqueToken(csrfToken)) return false;
    return this.store.isFlowActive(sha256(cookieToken), sha256(csrfToken));
  }

  async login(input: NativeLoginInput): Promise<LoginResult | null> {
    if (!isOpaqueToken(input.cookieToken) || !isOpaqueToken(input.csrfToken)) return null;
    const normalizedEmail = normalizeEmail(input.email);
    const candidate = normalizedEmail
      ? await this.store.findLoginCandidate(sha256(input.cookieToken), sha256(input.csrfToken), normalizedEmail)
      : null;
    const passwordHash = candidate?.passwordHash ?? await DUMMY_PASSWORD_HASH;
    const passwordMatches = await argon2.verify(passwordHash, input.password);
    if (!candidate || !candidate.accountId || !candidate.emailVerified || !passwordMatches) {
      if (isOpaqueToken(input.cookieToken) && isOpaqueToken(input.csrfToken)) {
        await this.store.failLogin(sha256(input.cookieToken), sha256(input.csrfToken));
      }
      return null;
    }

    if (candidate.mfaEnabled) {
      if (!await this.store.requireMfa({
        flowId: candidate.flowId,
        cookieDigest: sha256(input.cookieToken),
        csrfDigest: sha256(input.csrfToken),
        accountId: candidate.accountId,
      })) return null;
      return { kind: "mfa_required" };
    }

    const code = randomBytes(32).toString("base64url");
    const redirect = await this.store.completeLogin({
      flowId: candidate.flowId,
      cookieDigest: sha256(input.cookieToken),
      csrfDigest: sha256(input.csrfToken),
      accountId: candidate.accountId,
      codeDigest: sha256(code),
    });
    return redirect ? { kind: "authorized", ...redirect, code } : null;
  }

  async completeMfa(input: NativeMfaLoginInput): Promise<LoginResult | null> {
    if (!this.mfaVerifier || !isOpaqueToken(input.cookieToken) || !isOpaqueToken(input.csrfToken)) return null;
    const code = randomBytes(32).toString("base64url");
    const redirect = await this.mfaVerifier.completeMfaLogin({
      cookieDigest: sha256(input.cookieToken),
      csrfDigest: sha256(input.csrfToken),
      email: input.email,
      proof: input.proof,
      codeDigest: sha256(code),
    });
    return redirect ? { kind: "authorized", ...redirect, code } : null;
  }

  async completePasskeyLogin(input: { cookieToken: string; csrfToken: string; accountId: string }): Promise<LoginResult | null> {
    if (!isOpaqueToken(input.cookieToken) || !isOpaqueToken(input.csrfToken) || !this.store.findPasskeyLoginCandidate) return null;
    const cookieDigest = sha256(input.cookieToken);
    const csrfDigest = sha256(input.csrfToken);
    const candidate = await this.store.findPasskeyLoginCandidate(cookieDigest, csrfDigest, input.accountId);
    if (!candidate?.accountId) return null;
    if (candidate.mfaEnabled) {
      const accepted = await this.store.requireMfa({
        flowId: candidate.flowId,
        cookieDigest,
        csrfDigest,
        accountId: candidate.accountId,
      });
      return accepted ? { kind: "mfa_required", ...(candidate.email ? { email: candidate.email } : {}) } : null;
    }
    const code = randomBytes(32).toString("base64url");
    const redirect = await this.store.completeLogin({
      flowId: candidate.flowId,
      cookieDigest,
      csrfDigest,
      accountId: candidate.accountId,
      codeDigest: sha256(code),
    });
    return redirect ? { kind: "authorized", ...redirect, code } : null;
  }

  async failPasskeyLogin(cookieToken: string, csrfToken: string): Promise<void> {
    if (isOpaqueToken(cookieToken) && isOpaqueToken(csrfToken)) {
      await this.store.failLogin(sha256(cookieToken), sha256(csrfToken));
    }
  }

  async exchange(code: string, verifier: string): Promise<SessionGrant | null> {
    if (!isOpaqueToken(code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return null;
    const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = await this.store.exchangeCode(
      sha256(code),
      codeChallenge,
      sha256(token),
    );
    if (!expiresAt) return null;
    return { token, expiresAt: expiresAt.toISOString() };
  }
}

export function validateNativeFlowParameters(parameters: NativeFlowParameters): boolean {
  if (!/^[-A-Za-z0-9._~]{43,128}$/.test(parameters.state)) return false;
  if (!/^[A-Za-z0-9_-]{43}$/.test(parameters.codeChallenge)) return false;
  try {
    const redirect = new URL(parameters.redirectUri);
    return redirect.protocol === "http:"
      && redirect.hostname === "127.0.0.1"
      && Number(redirect.port) >= 1
      && Number(redirect.port) <= 65_535
      && redirect.pathname === "/callback"
      && !redirect.username
      && !redirect.password
      && !redirect.search
      && !redirect.hash;
  } catch {
    return false;
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isOpaqueToken(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}
