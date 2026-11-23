import { createHmac, randomBytes, randomInt } from "node:crypto";
import argon2 from "argon2";

export type RegistrationInput = { displayName: string; email: string; password: string };
export type VerificationChallenge = { accountId: string; displayName: string; challengeId: string };
export type PasswordResetChallenge = { accountId: string; displayName: string; challengeId: string };
export type AccountRecoveryChallenge = { accountId: string; displayName: string; challengeId: string };

export interface EmailAuthStore {
  createUnverifiedAccount(input: { displayName: string; email: string; passwordHash: string }): Promise<{ id: string } | null>;
  createVerification(email: string, verifier: string): Promise<VerificationChallenge | null>;
  verifyEmail(email: string, verifier: string): Promise<boolean>;
  createPasswordReset(email: string, verifier: string): Promise<PasswordResetChallenge | null>;
  checkPasswordReset(email: string, verifier: string): Promise<boolean>;
  resetPassword(email: string, verifier: string, passwordHash: string): Promise<boolean>;
  createAccountRecovery?(email: string, verifier: string): Promise<AccountRecoveryChallenge | null>;
  verifyAccountRecovery?(email: string, verifier: string): Promise<{ challengeId: string; email: string } | null>;
}

export interface VerificationMailer {
  sendVerification(input: { email: string; displayName: string; pin: string; challengeId: string }): Promise<void>;
  sendPasswordReset(input: { email: string; displayName: string; pin: string; challengeId: string }): Promise<void>;
  sendAccountRecoveryPin?(input: { email: string; displayName: string; pin: string; challengeId: string }): Promise<void>;
}

export type RegistrationResult = "accepted" | "invalid_request";

export class EmailAuthService {
  constructor(
    private readonly store: EmailAuthStore,
    private readonly mailer: VerificationMailer,
    private readonly pinPepper: string,
  ) {}

  async register(input: RegistrationInput): Promise<RegistrationResult> {
    const normalized = normalizeRegistration(input);
    if (!normalized) return "invalid_request";

    const passwordHash = await argon2.hash(normalized.password, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32,
      salt: randomBytes(16),
    });
    const account = await this.store.createUnverifiedAccount({ ...normalized, passwordHash });
    if (account) await this.sendCode(normalized.email);
    return "accepted";
  }

  async resendVerification(emailInput: string): Promise<"accepted" | "invalid_request"> {
    const email = normalizeEmail(emailInput);
    if (!email) return "invalid_request";
    await this.sendCode(email);
    return "accepted";
  }

  async verify(emailInput: string, pin: string): Promise<"verified" | "invalid_or_expired"> {
    const email = normalizeEmail(emailInput);
    if (!email || !/^\d{6}$/.test(pin)) return "invalid_or_expired";
    return await this.store.verifyEmail(email, this.verifier(email, pin))
      ? "verified"
      : "invalid_or_expired";
  }

  async requestPasswordReset(emailInput: string): Promise<"accepted" | "invalid_request"> {
    const email = normalizeEmail(emailInput);
    if (!email) return "invalid_request";
    const pin = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const challenge = await this.store.createPasswordReset(email, this.passwordResetVerifier(email, pin));
    if (challenge) {
      try {
        await this.mailer.sendPasswordReset({ ...challenge, email, pin });
      } catch {
        // The public response stays generic; never log the address or PIN.
      }
    }
    return "accepted";
  }

  async confirmPasswordReset(emailInput: string, pin: string, password: string): Promise<"reset" | "invalid_or_expired" | "invalid_request"> {
    const email = normalizeEmail(emailInput);
    if (!email || !/^\d{6}$/.test(pin) || !isValidPassword(password)) return "invalid_request";
    const verifier = this.passwordResetVerifier(email, pin);
    if (!await this.store.checkPasswordReset(email, verifier)) return "invalid_or_expired";
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32,
      salt: randomBytes(16),
    });
    return await this.store.resetPassword(email, verifier, passwordHash) ? "reset" : "invalid_or_expired";
  }

  async requestAccountRecovery(emailInput: string): Promise<"accepted" | "invalid_request"> {
    const email = normalizeEmail(emailInput);
    if (!email) return "invalid_request";
    const pin = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const challenge = await this.store.createAccountRecovery?.(email, this.recoveryVerifier(email, pin));
    if (challenge) {
      try {
        await this.mailer.sendAccountRecoveryPin?.({ ...challenge, email, pin });
      } catch {
        // Respuesta genérica; no revelar cuenta, correo ni PIN en logs.
      }
    }
    return "accepted";
  }

  async verifyAccountRecovery(emailInput: string, pin: string): Promise<"verified" | "invalid_or_expired"> {
    const email = normalizeEmail(emailInput);
    if (!email || !/^\d{6}$/.test(pin)) return "invalid_or_expired";
    const result = await this.store.verifyAccountRecovery?.(email, this.recoveryVerifier(email, pin));
    return result ? "verified" : "invalid_or_expired";
  }

  private async sendCode(email: string): Promise<void> {
    const pin = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const challenge = await this.store.createVerification(email, this.verifier(email, pin));
    if (!challenge) return;
    try {
      await this.mailer.sendVerification({ ...challenge, email, pin });
    } catch {
      // Keep the public response generic; operators must not log the address or PIN.
    }
  }

  private verifier(email: string, pin: string): string {
    return createHmac("sha256", this.pinPepper)
      .update("email-verification\0")
      .update(email)
      .update("\0")
      .update(pin)
      .digest("hex");
  }

  private passwordResetVerifier(email: string, pin: string): string {
    return createHmac("sha256", this.pinPepper)
      .update("password-reset\0")
      .update(email)
      .update("\0")
      .update(pin)
      .digest("hex");
  }

  private recoveryVerifier(email: string, pin: string): string {
    return createHmac("sha256", this.pinPepper)
      .update("account-recovery\0")
      .update(email)
      .update("\0")
      .update(pin)
      .digest("hex");
  }
}

function normalizeRegistration(input: RegistrationInput): RegistrationInput | null {
  if (!input || typeof input !== "object") return null;
  const email = normalizeEmail(input.email);
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const password = input.password;
  if (!email || displayName.length < 1 || displayName.length > 80 || /[\u0000-\u001f\u007f]/u.test(displayName)) return null;
  if (!isValidPassword(password)) return null;
  return { displayName, email, password };
}

function isValidPassword(password: unknown): password is string {
  return typeof password === "string" && [...password].length >= 12 && [...password].length <= 128 && !/[\u0000-\u001f\u007f]/u.test(password);
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(email) ? email : null;
}
