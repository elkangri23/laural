import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendMailer } from "../src/resend-mailer.js";

afterEach(() => vi.unstubAllGlobals());

describe("envío transaccional mediante Resend", () => {
  it("envía PIN de verificación con el remitente y clave del servidor", async () => {
    const fetch = vi.fn(async () => new Response("{\"id\":\"mail-id\"}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "Laural <auth@example.test>" });
    await mailer.sendVerification({ email: "user@example.test", displayName: `<A & "B" 'C'>`, pin: "012345", challengeId: "challenge-id" });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.redirect).toBe("error");
    expect(new Headers(options.headers).get("authorization")).toBe("Bearer server-only-key");
    expect(new Headers(options.headers).get("idempotency-key")).toBe("verification/challenge-id");
    const payload = JSON.parse(String(options.body)) as { html: string; text: string; to: string[] };
    expect(payload.to).toEqual(["user@example.test"]);
    expect(payload.html).toContain("&lt;A &amp; &quot;B&quot; &#39;C&#39;&gt;");
    expect(payload.text).toContain("012345");
    expect(payload.html).toContain("no inicia sesión");
    // Plantilla única de Laural: marca, tarjeta oscura y PIN destacado.
    expect(payload.html).toContain("Cuenta y sincronización");
    expect(payload.html).toContain("bgcolor=\"#19201b\"");
    expect(payload.html).toContain("letter-spacing:8px");
    expect(payload.html).toContain("012345");
  });

  it("todas las plantillas comparten la misma estructura de correo", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const mailer = new ResendMailer({
      apiKey: "server-only-key",
      from: "auth@example.test",
      recoveryAdminEmail: "admin@example.test",
      recoveryBaseUrl: "https://sync.example.test/auth/recovery",
    });
    await mailer.sendVerification({ email: "user@example.test", displayName: "User", pin: "012345", challengeId: "v1" });
    await mailer.sendPasswordReset({ email: "user@example.test", displayName: "User", pin: "012345", challengeId: "r1" });
    await mailer.sendAccountRecoveryPin({ email: "user@example.test", displayName: "User", pin: "012345", challengeId: "p1" });
    await mailer.sendAccountRecoveryNotice({ caseId: "case-1", accountEmail: "user@example.test", notificationId: "n1" });
    await mailer.sendAccountRecoveryGrant({ email: "user@example.test", ticket: "t".repeat(43), grantId: "g1" });
    await mailer.sendSecurityNotice({ email: "user@example.test", eventType: "totp_enabled", notificationId: "s1" });

    expect(fetch).toHaveBeenCalledTimes(6);
    const headings = [
      "Verifica tu correo",
      "Restablece tu contraseña",
      "Verifica tu solicitud de recuperación",
      "Solicitud de revisión de recuperación",
      "Configura tu segundo factor",
      "Se activó la verificación en dos pasos de Laural",
    ];
    for (const [index, [, options]] of (fetch.mock.calls as unknown as [string, RequestInit][]).entries()) {
      const payload = JSON.parse(String(options.body)) as { html: string };
      expect(payload.html).toContain("<!doctype html>");
      expect(payload.html).toContain("Cuenta y sincronización");
      expect(payload.html).toContain("bgcolor=\"#19201b\"");
      expect(payload.html).toContain("Laural · Cuenta y sincronización");
      expect(payload.html).toContain(`<h1 style="margin:0 0 4px 0;color:#edf3ec;font-size:25px;letter-spacing:-0.02em;font-family:'Segoe UI',sans-serif;">${headings[index]}</h1>`);
    }
    const adminPayload = JSON.parse(String((fetch.mock.calls[3] as unknown as [string, RequestInit])[1].body)) as { html: string };
    expect(adminPayload.html).toContain("case-1");
    expect(adminPayload.html).not.toContain("PIN");
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
      ["recovery_codes_rotated", "Se renovaron los códigos de recuperación"],
      ["totp_disabled", "Se desactivó la verificación en dos pasos"],
      ["passkey_added", "Se añadió una passkey"],
      ["passkey_removed", "Se eliminó una passkey"],
      ["account_recovered", "Se restablecieron los factores"],
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
    expect(fetch).toHaveBeenCalledTimes(5);
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

  it("envía el ticket de reenrolamiento en fragmento y con expiración explícita", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "auth@example.test", recoveryBaseUrl: "https://sync.example.test/auth/recovery" });
    const ticket = "t".repeat(43);
    await mailer.sendAccountRecoveryGrant({ email: "user@example.test", ticket, grantId: "grant-id" });
    const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(options.headers).get("idempotency-key")).toBe("account-recovery-grant/grant-id");
    const payload = JSON.parse(String(options.body)) as { text: string; html: string };
    expect(payload.text).toContain(`https://sync.example.test/auth/recovery#ticket=${ticket}`);
    expect(payload.text).toContain("30 minutos");
    expect(payload.text).toContain("no inicia sesión");
    expect(payload.html).toContain("#ticket=");
  });

  it("rechaza el aviso administrativo si no hay destinatario configurado", async () => {
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "auth@example.test" });
    await expect(mailer.sendAccountRecoveryNotice({ caseId: "case-id", accountEmail: "user@example.test", notificationId: "notice-id" }))
      .rejects.toThrow("correo administrador");
  });

  it("rechaza el enlace de recuperación si falta la URL base", async () => {
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "auth@example.test" });
    await expect(mailer.sendAccountRecoveryGrant({ email: "user@example.test", ticket: "ticket", grantId: "grant-id" }))
      .rejects.toThrow("URL de recuperación");
  });

  it("usa mensajes genéricos para los rechazos de cada plantilla y no devuelve la respuesta del proveedor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("detalle privado del proveedor", { status: 401 })));
    const mailer = new ResendMailer({
      apiKey: "server-only-key",
      from: "auth@example.test",
      recoveryAdminEmail: "admin@example.test",
      recoveryBaseUrl: "https://sync.example.test/auth/recovery",
    });
    const actions: Array<[() => Promise<void>, string]> = [
      [() => mailer.sendPasswordReset({ email: "user@example.test", displayName: "User", pin: "123456", challengeId: "id" }), "restablecimiento"],
      [() => mailer.sendAccountRecoveryPin({ email: "user@example.test", displayName: "User", pin: "123456", challengeId: "id" }), "PIN de recuperación"],
      [() => mailer.sendAccountRecoveryNotice({ caseId: "case", accountEmail: "user@example.test", notificationId: "id" }), "aviso de recuperación al administrador"],
      [() => mailer.sendAccountRecoveryGrant({ email: "user@example.test", ticket: "ticket", grantId: "id" }), "enlace de recuperación"],
      [() => mailer.sendSecurityNotice({ email: "user@example.test", eventType: "totp_enabled", notificationId: "id" }), "aviso de seguridad"],
    ];

    for (const [action, publicError] of actions) {
      const error = await action().then(() => null, (reason: unknown) => reason);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(publicError);
      expect((error as Error).message).not.toContain("detalle privado del proveedor");
    }
  });

  it("tolera una respuesta exitosa sin cuerpo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "auth@example.test" });
    await expect(mailer.sendVerification({
      email: "user@example.test", displayName: "User", pin: "123456", challengeId: "empty-body",
    })).resolves.toBeUndefined();
  });
});
