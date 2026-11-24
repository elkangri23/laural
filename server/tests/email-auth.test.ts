import argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";
import { EmailAuthService, type EmailAuthStore, type RegistrationInput, type VerificationMailer } from "../src/email-auth.js";

class MemoryEmailStore implements EmailAuthStore {
  account: { id: string; displayName: string; email: string; passwordHash: string } | null = null;
  verification: { email: string; digest: string } | null = null;
  verified = false;
  passwordReset: { email: string; digest: string } | null = null;
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
  createPasswordReset = vi.fn(async (email: string, verifier: string) => {
    if (!this.account || email !== this.account.email || !this.verified) return null;
    this.passwordReset = { email, digest: verifier };
    return { accountId: this.account.id, displayName: this.account.displayName, challengeId: "reset-1" };
  });
  checkPasswordReset = vi.fn(async (email: string, verifier: string) => this.passwordReset?.email === email && this.passwordReset.digest === verifier);
  resetPassword = vi.fn(async (email: string, verifier: string, passwordHash: string) => {
    if (!this.account || this.passwordReset?.email !== email || this.passwordReset.digest !== verifier) return false;
    this.account.passwordHash = passwordHash;
    this.passwordReset = null;
    return true;
  });
}

const input: RegistrationInput = {
  displayName: "Laura",
  email: " LAURA@example.test ",
  password: "una contraseña larga 2026",
};

function service(store = new MemoryEmailStore(), send = vi.fn(async () => undefined), sendPasswordReset = vi.fn(async () => undefined)) {
  const mailer: VerificationMailer = { sendVerification: send, sendPasswordReset };
  return { store, send, sendPasswordReset, auth: new EmailAuthService(store, mailer, "server-pepper-that-is-long-enough-for-tests") };
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

  it("rechaza valores de registro que no son objetos o no tienen nombre/correo de texto", async () => {
    const test = service();
    expect(await test.auth.register(null as unknown as RegistrationInput)).toBe("invalid_request");
    expect(await test.auth.register({ ...input, displayName: 42 as unknown as string })).toBe("invalid_request");
    expect(await test.auth.register({ ...input, email: 42 as unknown as string })).toBe("invalid_request");
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
    expect(await test.auth.resendVerification("not-an-email")).toBe("invalid_request");
    expect(await test.auth.resendVerification("unknown@example.test")).toBe("accepted");
    expect(test.send).not.toHaveBeenCalled();
    expect(await test.auth.verify("unknown@example.test", "000000")).toBe("invalid_or_expired");
    expect(await test.auth.verify(input.email, "12345")).toBe("invalid_or_expired");
  });

  it("envía un PIN de recuperación y delega su verificación sin crear sesión", async () => {
    const store = new MemoryEmailStore();
    const pinSender = vi.fn(async () => undefined);
    const mailer: VerificationMailer = {
      sendVerification: vi.fn(async () => undefined),
      sendPasswordReset: vi.fn(async () => undefined),
      sendAccountRecoveryPin: pinSender,
    };
    let expectedVerifier = "";
    store.createAccountRecovery = vi.fn(async (email, verifier) => {
      expectedVerifier = verifier;
      return email === "laura@example.test" ? { accountId: "account-1", displayName: "Laura", challengeId: "case-1" } : null;
    });
    store.verifyAccountRecovery = vi.fn(async (email, verifier) => email === "laura@example.test" && verifier === expectedVerifier
      ? { challengeId: "case-1", email }
      : null);
    const auth = new EmailAuthService(store, mailer, "server-pepper-that-is-long-enough-for-tests");

    expect(await auth.requestAccountRecovery(" LAURA@example.test ")).toBe("accepted");
    expect(pinSender).toHaveBeenCalledOnce();
    const sentPin = pinSender.mock.calls[0]?.[0].pin;
    expect(sentPin).toMatch(/^\d{6}$/);
    expect(expectedVerifier).not.toContain(sentPin);
    expect(await auth.verifyAccountRecovery("laura@example.test", sentPin!)).toBe("verified");
    expect(await auth.verifyAccountRecovery("laura@example.test", "bad")).toBe("invalid_or_expired");
  });

  it("mantiene la recuperación genérica si faltan métodos opcionales del almacén o del correo", async () => {
    const test = service();
    expect(await test.auth.requestAccountRecovery("not-an-email")).toBe("invalid_request");
    expect(await test.auth.requestAccountRecovery("laura@example.test")).toBe("accepted");
    expect(await test.auth.verifyAccountRecovery("laura@example.test", "123456")).toBe("invalid_or_expired");
    expect(await test.auth.verifyAccountRecovery("not-an-email", "123456")).toBe("invalid_or_expired");
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

  it("restablece la contraseña solo tras un PIN válido y no concede una sesión", async () => {
    const store = new MemoryEmailStore();
    store.account = { id: "account-1", displayName: "Laura", email: "laura@example.test", passwordHash: "previous-hash" };
    store.verified = true;
    const test = service(store);
    expect(await test.auth.requestPasswordReset(" LAURA@example.test ")).toBe("accepted");
    expect(test.sendPasswordReset).toHaveBeenCalledOnce();
    const pin = test.sendPasswordReset.mock.calls[0]?.[0].pin;
    expect(pin).toMatch(/^\d{6}$/);
    expect(await test.auth.confirmPasswordReset("laura@example.test", "999999", "nueva contraseña segura 2026")).toBe("invalid_or_expired");
    expect(store.resetPassword).not.toHaveBeenCalled();
    expect(await test.auth.confirmPasswordReset("laura@example.test", pin!, "nueva contraseña segura 2026")).toBe("reset");
    expect(store.account.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(store.account.passwordHash, "nueva contraseña segura 2026")).toBe(true);
  });

  it("responde de forma genérica ante correo inválido y si el almacén rechaza el restablecimiento", async () => {
    const test = service();
    expect(await test.auth.requestPasswordReset("not-an-email")).toBe("invalid_request");

    const store = new MemoryEmailStore();
    store.account = { id: "account-1", displayName: "Laura", email: "laura@example.test", passwordHash: "previous-hash" };
    store.verified = true;
    const reset = service(store);
    expect(await reset.auth.requestPasswordReset("laura@example.test")).toBe("accepted");
    const pin = reset.sendPasswordReset.mock.calls[0]?.[0].pin;
    store.resetPassword.mockResolvedValue(false);
    expect(await reset.auth.confirmPasswordReset("laura@example.test", pin!, "nueva contraseña segura 2026")).toBe("invalid_or_expired");
  });

  it("da respuesta genérica para cuenta inexistente y rechaza formato de PIN/contraseña inválido", async () => {
    const test = service();
    expect(await test.auth.requestPasswordReset("missing@example.test")).toBe("accepted");
    expect(test.sendPasswordReset).not.toHaveBeenCalled();
    expect(await test.auth.confirmPasswordReset("missing@example.test", "123456", "nueva contraseña segura 2026")).toBe("invalid_or_expired");
    expect(await test.auth.confirmPasswordReset("laura@example.test", "12345", "nueva contraseña segura 2026")).toBe("invalid_request");
    expect(await test.auth.confirmPasswordReset("laura@example.test", "123456", "corta")).toBe("invalid_request");
  });
});
