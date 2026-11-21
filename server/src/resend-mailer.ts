import type { VerificationMailer } from "./email-auth.js";

export type ResendConfig = { apiKey: string; from: string };

export class ResendMailer implements VerificationMailer {
  constructor(private readonly config: ResendConfig) {}

  async sendVerification(input: { email: string; displayName: string; pin: string; challengeId: string }): Promise<void> {
    const safeName = escapeHtml(input.displayName);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `verification/${input.challengeId}`,
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [input.email],
        subject: "Verifica tu correo de Laural",
        text: `Hola ${input.displayName}, tu PIN de verificación es ${input.pin}. Caduca en 5 minutos y no inicia sesión ni elimina factores de seguridad.`,
        html: `<p>Hola ${safeName},</p><p>Tu PIN de verificación es <strong>${input.pin}</strong>.</p><p>Caduca en 5 minutos. Este PIN solo verifica el correo; no inicia sesión ni elimina factores de seguridad.</p>`,
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("No se pudo entregar el correo de verificación.");
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character] ?? character);
}
