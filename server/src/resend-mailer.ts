import type { VerificationMailer } from "./email-auth.js";
import type { SecurityEmailEvent, SecurityEmailSender } from "./security-email-outbox.js";

export type ResendConfig = { apiKey: string; from: string; recoveryAdminEmail?: string };

export class ResendMailer implements VerificationMailer, SecurityEmailSender {
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

  async sendPasswordReset(input: { email: string; displayName: string; pin: string; challengeId: string }): Promise<void> {
    const safeName = escapeHtml(input.displayName);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `password-reset/${input.challengeId}`,
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [input.email],
        subject: "PIN para restablecer tu contraseña de Laural",
        text: `Hola ${input.displayName}, tu PIN para cambiar la contraseña es ${input.pin}. Caduca en 5 minutos, se usa una sola vez y no inicia sesión ni elimina factores de seguridad. Si no solicitaste este cambio, ignora el mensaje.`,
        html: `<p>Hola ${safeName},</p><p>Tu PIN para cambiar la contraseña es <strong>${input.pin}</strong>.</p><p>Caduca en 5 minutos, se usa una sola vez y no inicia sesión ni elimina factores de seguridad. Si no solicitaste este cambio, ignora el mensaje.</p>`,
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("No se pudo entregar el correo de restablecimiento.");
  }

  async sendAccountRecoveryPin(input: { email: string; displayName: string; pin: string; challengeId: string }): Promise<void> {
    const safeName = escapeHtml(input.displayName);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `account-recovery-pin/${input.challengeId}` },
      body: JSON.stringify({
        from: this.config.from,
        to: [input.email],
        subject: "Verifica una solicitud de recuperación de Laural",
        text: `Hola ${input.displayName}, tu PIN de seis dígitos es ${input.pin}. Caduca en 5 minutos. Solo confirma que tienes acceso a este correo; no inicia sesión, no restablece la contraseña y no elimina TOTP ni passkeys. Después, el administrador revisará el caso por separado. Si no lo solicitaste, ignora este mensaje.`,
        html: `<p>Hola ${safeName},</p><p>Tu PIN de seis dígitos es <strong>${input.pin}</strong>. Caduca en 5 minutos.</p><p>Solo confirma que tienes acceso a este correo; no inicia sesión, no restablece la contraseña y no elimina TOTP ni passkeys. Después, el administrador revisará el caso por separado.</p><p>Si no lo solicitaste, ignora este mensaje.</p>`,
      }), signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("No se pudo entregar el PIN de recuperación.");
  }

  async sendAccountRecoveryNotice(input: { caseId: string; accountEmail: string; notificationId: string }): Promise<void> {
    if (!this.config.recoveryAdminEmail) throw new Error("No hay correo administrador configurado para recuperación.");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `account-recovery-notice/${input.notificationId}` },
      body: JSON.stringify({
        from: this.config.from,
        to: [this.config.recoveryAdminEmail],
        subject: "Laural: solicitud de revisión de recuperación",
        text: `Se verificó el buzón asociado a una solicitud de recuperación. Caso: ${input.caseId}. Cuenta: ${input.accountEmail}. La verificación del buzón no constituye prueba independiente y no se ha modificado ningún factor. Revisa el procedimiento administrativo aprobado.`,
      }), signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("No se pudo entregar el aviso de recuperación al administrador.");
  }

  async sendSecurityNotice(input: { email: string; eventType: SecurityEmailEvent; notificationId: string }): Promise<void> {
    const message = securityNoticeMessage(input.eventType);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `security/${input.notificationId}`,
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [input.email],
        subject: message.subject,
        text: `${message.body}\n\nSi no reconoces este cambio, cambia tu contraseña y ponte en contacto con el administrador de Laural.`,
        html: `<p>${message.body}</p><p>Si no reconoces este cambio, cambia tu contraseña y ponte en contacto con el administrador de Laural.</p>`,
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("No se pudo entregar el aviso de seguridad.");
  }
}

function securityNoticeMessage(eventType: SecurityEmailEvent): { subject: string; body: string } {
  switch (eventType) {
    case "totp_enabled":
      return { subject: "Se activó la verificación en dos pasos de Laural", body: "Se activó la verificación TOTP en tu cuenta de Laural." };
    case "recovery_codes_rotated":
      return { subject: "Se renovaron los códigos de recuperación de Laural", body: "Se renovaron los códigos de recuperación de tu cuenta de Laural." };
    case "totp_disabled":
      return { subject: "Se desactivó la verificación en dos pasos de Laural", body: "Se desactivó la verificación TOTP en tu cuenta de Laural." };
    case "passkey_added":
      return { subject: "Se añadió una passkey a tu cuenta de Laural", body: "Se añadió una passkey para iniciar sesión en tu cuenta de Laural." };
    case "passkey_removed":
      return { subject: "Se eliminó una passkey de tu cuenta de Laural", body: "Se eliminó una passkey de tu cuenta de Laural." };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character] ?? character);
}
