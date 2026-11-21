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

  it("convierte los errores del proveedor en un error genérico", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private provider detail", { status: 401 })));
    const mailer = new ResendMailer({ apiKey: "server-only-key", from: "auth@example.test" });
    await expect(mailer.sendVerification({
      email: "user@example.test", displayName: "User", pin: "123456", challengeId: "challenge-id",
    })).rejects.toThrow("No se pudo entregar el correo de verificación.");
  });
});
