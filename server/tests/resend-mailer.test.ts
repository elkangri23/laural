import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendMailer } from "../src/resend-mailer.js";

afterEach(() => vi.unstubAllGlobals());

describe("envío transaccional mediante Resend", () => {
  it("envía PIN de verificación con el remitente y clave del servidor", async () => {
    const fetch = vi.fn(async () => new Response("{\"id\":\"mail-id\"}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "Laural <auth@example.test>" });
    await mailer.sendVerification({ email: "user@example.test", displayName: "A <B>", pin: "012345", challengeId: "challenge-id" });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.redirect).toBe("error");
    expect(new Headers(options.headers).get("authorization")).toBe("Bearer server-only-key");
    expect(new Headers(options.headers).get("idempotency-key")).toBe("verification/challenge-id");
    const payload = JSON.parse(String(options.body)) as { html: string; text: string; to: string[] };
    expect(payload.to).toEqual(["user@example.test"]);
    expect(payload.html).toContain("A &lt;B&gt;");
    expect(payload.text).toContain("012345");
    expect(payload.html).toContain("no inicia sesión");
  });

  it("envía un PIN de restablecimiento sin convertirlo en acceso ni quitar factores", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "auth@example.test" });
    await mailer.sendPasswordReset({ email: "user@example.test", displayName: "A <B>", pin: "012345", challengeId: "reset-id" });

    const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(options.headers).get("idempotency-key")).toBe("password-reset/reset-id");
    const payload = JSON.parse(String(options.body)) as { html: string; text: string };
    expect(payload.html).toContain("A &lt;B&gt;");
    expect(payload.text).toContain("012345");
    expect(payload.text).toContain("no inicia sesión ni elimina factores");
  });

  it("envía avisos de seguridad en español con clave de idempotencia", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "auth@example.test" });
    await mailer.sendSecurityNotice({
      email: "user@example.test",
      eventType: "totp_enabled",
      notificationId: "security-event-id",
    });

    const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(options.headers).get("idempotency-key")).toBe("security/security-event-id");
    const payload = JSON.parse(String(options.body)) as { subject: string; text: string; to: string[] };
    expect(payload.to).toEqual(["user@example.test"]);
    expect(payload.subject).toContain("dos pasos");
    expect(payload.text).toContain("no reconoces este cambio");
  });

  it("avisa del alta y retirada de passkeys sin revelar nombre ni dispositivo", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "auth@example.test" });
    for (const [eventType, subject] of [
      ["passkey_added", "Se añadió una passkey"],
      ["passkey_removed", "Se eliminó una passkey"],
    ] as const) {
      await mailer.sendSecurityNotice({ email: "user@example.test", eventType, notificationId: `notice-${eventType}` });
      const [, options] = fetch.mock.calls.at(-1) as unknown as [string, RequestInit];
      const payload = JSON.parse(String(options.body)) as { subject: string; text: string; html: string };
      expect(payload.subject).toContain(subject);
      expect(payload.text).toContain("no reconoces este cambio");
      expect(payload.text).not.toMatch(/portátil|dispositivo|credential-id/iu);
      expect(payload.html).not.toMatch(/portátil|dispositivo|credential-id/iu);
      expect(new Headers(options.headers).get("idempotency-key")).toBe(`security/notice-${eventType}`);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("convierte los errores del proveedor en un error genérico", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private provider detail", { status: 401 })));
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "auth@example.test" });
    await expect(mailer.sendVerification({
      email: "user@example.test", displayName: "User", pin: "123456", challengeId: "challenge-id",
    })).rejects.toThrow("No se pudo entregar el correo de verificación.");
  });

  it("envía el PIN de recuperación solo a la cuenta y explica que no retira MFA", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "auth@example.test" });
    await mailer.sendAccountRecoveryPin({ email: "user@example.test", displayName: "A <B>", pin: "012345", challengeId: "case-id" });

    const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(options.headers).get("idempotency-key")).toBe("account-recovery-pin/case-id");
    const payload = JSON.parse(String(options.body)) as { html: string; text: string; to: string[] };
    expect(payload.to).toEqual(["user@example.test"]);
    expect(payload.html).toContain("A &lt;B&gt;");
    expect(payload.text).toContain("012345");
    expect(payload.text).toContain("no elimina TOTP ni passkeys");
  });

  it("avisa al administrador sin incluir PIN ni material probatorio", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "auth@example.test", recoveryAdminEmail: "admin@example.test" });
    await mailer.sendAccountRecoveryNotice({ caseId: "case-random-id", accountEmail: "user@example.test", notificationId: "notice-id" });

    const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(options.headers).get("idempotency-key")).toBe("account-recovery-notice/notice-id");
    const payload = JSON.parse(String(options.body)) as { to: string[]; text: string };
    expect(payload.to).toEqual(["admin@example.test"]);
    expect(payload.text).toContain("case-random-id");
    expect(payload.text).toContain("no se ha modificado ningún factor");
    expect(payload.text).not.toContain("PIN");
  });

  it("rechaza el aviso administrativo si no hay destinatario configurado", async () => {
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "auth@example.test" });
    await expect(mailer.sendAccountRecoveryNotice({ caseId: "case-id", accountEmail: "user@example.test", notificationId: "notice-id" }))
      .rejects.toThrow("correo administrador");
  });
});
