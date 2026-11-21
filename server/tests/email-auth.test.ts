import argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";
import { EmailAuthService, type EmailAuthStore, type RegistrationInput, type VerificationMailer } from "../src/email-auth.js";

class MemoryEmailStore implements EmailAuthStore {
  account: { id: string; displayName: string; passwordHash: string } | null = null;
  verification: { email: string; digest: string } | null = null;
  verified = false;
  createUnverifiedAccount = vi.fn(async (input: { displayName: string; email: string; passwordHash: string }) => {
    if (this.account) return null;
    this.account = { id: "account-1", ...input };
    return { id: this.account.id };
  });
  createVerification = vi.fn(async (email: string, verifier: string) => {
    if (!this.account || email !== this.account.email || this.verified) return null;
    this.verification = { email, digest: verifier };
    return { accountId: this.account.id, displayName: this.account.displayName, challengeId: "challenge-1" };
  });
  verifyEmail = vi.fn(async (email: string, verifier: string) => {
    if (!this.verification || this.verification.email !== email || this.verification.digest !== verifier) return false;
    this.verified = true;
    this.verification = null;
    return true;
  });
}

const input: RegistrationInput = {
  displayName: "Laura",
  email: " LAURA@example.test ",
  password: "una contraseña larga 2026",
};

function service(store = new MemoryEmailStore(), send = vi.fn(async () => undefined)) {
  const mailer: VerificationMailer = { sendVerification: send };
  return { store, send, auth: new EmailAuthService(store, mailer, "server-pepper-that-is-long-enough-for-tests") };
}

describe("registro y verificación por correo", () => {
  it("normaliza el email, guarda Argon2id y envía un PIN de seis dígitos", async () => {
    const test = service();
    expect(await test.auth.register(input)).toBe("accepted");
    const account = test.store.createUnverifiedAccount.mock.calls[0]?.[0];
    expect(account?.email).toBe("laura@example.test");
    expect(account?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(account!.passwordHash, input.password)).toBe(true);
    expect(test.send).toHaveBeenCalledOnce();
    expect(test.send.mock.calls[0]?.[0].pin).toMatch(/^\d{6}$/);
    expect(test.store.createVerification.mock.calls[0]?.[1]).not.toBe(test.send.mock.calls[0]?.[0].pin);
  });

  it.each([
    [{ ...input, email: "invalid" }],
    [{ ...input, displayName: "  " }],
    [{ ...input, password: "short" }],
    [{ ...input, displayName: "x".repeat(81) }],
  ])("rechaza entrada inválida %# antes de crear la cuenta", async (registration) => {
    const test = service();
    expect(await test.auth.register(registration as RegistrationInput)).toBe("invalid_request");
    expect(test.store.createUnverifiedAccount).not.toHaveBeenCalled();
  });

  it("responde igual para una cuenta ya existente y no revela si se envió un correo", async () => {
    const store = new MemoryEmailStore();
    store.account = { id: "existing", displayName: "Laura", email: "laura@example.test", passwordHash: "hash" };
    const test = service(store);
    expect(await test.auth.register(input)).toBe("accepted");
    expect(test.send).not.toHaveBeenCalled();
  });

  it("usa respuestas genéricas al reenviar y al confirmar un PIN incorrecto", async () => {
    const test = service();
    expect(await test.auth.resendVerification("unknown@example.test")).toBe("accepted");
    expect(test.send).not.toHaveBeenCalled();
    expect(await test.auth.verify("unknown@example.test", "000000")).toBe("invalid_or_expired");
    expect(await test.auth.verify(input.email, "12345")).toBe("invalid_or_expired");
  });

  it("verifica el correo sin emitir una sesión y permite reintentar entrega fallida", async () => {
    const store = new MemoryEmailStore();
    const send = vi.fn(async () => { throw new Error("proveedor no disponible"); });
    const test = service(store, send);
    expect(await test.auth.register(input)).toBe("accepted");
    expect(await test.auth.resendVerification("laura@example.test")).toBe("accepted");
    expect(send).toHaveBeenCalledTimes(2);
    const sentPin = send.mock.calls[1]?.[0].pin;
    expect(await test.auth.verify("laura@example.test", sentPin!)).toBe("verified");
    expect(store.verified).toBe(true);
  });
});
