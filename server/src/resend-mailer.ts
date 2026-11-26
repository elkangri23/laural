import type { VerificationMailer } from "./email-auth.js";
import type { SecurityEmailEvent, SecurityEmailSender } from "./security-email-outbox.js";

export type ResendConfig = { apiKey: string; from: string; recoveryAdminEmail?: string; recoveryBaseUrl?: string };

// Plantilla única para todos los correos de Laural: misma paleta que las
// páginas de acceso (server/web/auth.css) y que la página del callback de la
// app. Los clientes de correo no admiten hojas de estilo externas, así que
// todo el diseño va en línea con tablas (sin gradientes ni recursos externos).
const BODY_FONT = "font-family:'Segoe UI',sans-serif;";
const P = `margin:16px 0 0 0;color:#a9b6aa;font-size:15px;line-height:1.55;${BODY_FONT}`;
const GREETING = `margin:0;color:#edf3ec;font-size:15px;line-height:1.55;${BODY_FONT}`;

function emailShell(heading: string, content: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${heading} · Laural</title></head><body style="margin:0;padding:0;background-color:#101511;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#101511" style="background-color:#101511;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="540" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:540px;"><tr><td style="padding:0 4px 20px 4px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="40" height="40" align="center" bgcolor="#9bc66c" style="background-color:#9bc66c;border-radius:13px;color:#142014;font-size:20px;font-weight:800;${BODY_FONT}">L</td><td style="padding-left:12px;"><div style="color:#edf3ec;font-size:19px;font-weight:700;${BODY_FONT}">Laural</div><div style="color:#a9b6aa;font-size:12px;margin-top:2px;${BODY_FONT}">Cuenta y sincronización</div></td></tr></table></td></tr><tr><td bgcolor="#19201b" style="background-color:#19201b;border:1px solid #344138;border-radius:16px;padding:32px;"><h1 style="margin:0 0 4px 0;color:#edf3ec;font-size:25px;letter-spacing:-0.02em;${BODY_FONT}">${heading}</h1>${content}</td></tr><tr><td align="center" style="padding:16px 4px 0 4px;color:#a9b6aa;font-size:12px;${BODY_FONT}">Laural · Cuenta y sincronización</td></tr></table></td></tr></table></body></html>`;
}

function pinBlock(pin: string): string {
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto 8px auto;"><tr><td align="center" bgcolor="#202a23" style="background-color:#202a23;border:1px solid #9bc66c;border-radius:12px;padding:16px 24px;color:#edf3ec;font-size:32px;font-weight:700;letter-spacing:8px;${BODY_FONT}">${pin}</td></tr></table>`;
}

function emailButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0;"><tr><td align="center" bgcolor="#9bc66c" style="background-color:#9bc66c;border-radius:10px;"><a href="${href}" style="display:inline-block;padding:12px 20px;color:#142014;font-size:15px;font-weight:700;text-decoration:none;${BODY_FONT}">${label}</a></td></tr></table>`;
}

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
        html: emailShell(
          "Verifica tu correo",
          `<p style="${GREETING}">Hola ${safeName},</p>${pinBlock(input.pin)}<p style="${P}">Tu PIN de verificación caduca en 5 minutos. Este PIN solo verifica el correo; no inicia sesión ni elimina factores de seguridad.</p>`,
        ),
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
        html: emailShell(
          "Restablece tu contraseña",
          `<p style="${GREETING}">Hola ${safeName},</p>${pinBlock(input.pin)}<p style="${P}">Caduca en 5 minutos, se usa una sola vez y no inicia sesión ni elimina factores de seguridad. Si no solicitaste este cambio, ignora el mensaje.</p>`,
        ),
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
        html: emailShell(
          "Verifica tu solicitud de recuperación",
          `<p style="${GREETING}">Hola ${safeName},</p>${pinBlock(input.pin)}<p style="${P}">Caduca en 5 minutos.</p><p style="${P}">Solo confirma que tienes acceso a este correo; no inicia sesión, no restablece la contraseña y no elimina TOTP ni passkeys. Después, el administrador revisará el caso por separado.</p><p style="${P}">Si no lo solicitaste, ignora este mensaje.</p>`,
        ),
      }), signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("No se pudo entregar el PIN de recuperación.");
  }

  async sendAccountRecoveryNotice(input: { caseId: string; accountEmail: string; notificationId: string }): Promise<void> {
    if (!this.config.recoveryAdminEmail) throw new Error("No hay correo administrador configurado para recuperación.");
    const safeCaseId = escapeHtml(input.caseId);
    const safeAccountEmail = escapeHtml(input.accountEmail);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `account-recovery-notice/${input.notificationId}` },
      body: JSON.stringify({
        from: this.config.from,
        to: [this.config.recoveryAdminEmail],
        subject: "Laural: solicitud de revisión de recuperación",
        text: `Se verificó el buzón asociado a una solicitud de recuperación. Caso: ${input.caseId}. Cuenta: ${input.accountEmail}. La verificación del buzón no constituye prueba independiente y no se ha modificado ningún factor. Revisa el procedimiento administrativo aprobado.`,
        html: emailShell(
          "Solicitud de revisión de recuperación",
          `<p style="${GREETING}">Se verificó el buzón asociado a una solicitud de recuperación.</p><p style="${P}">Caso: ${safeCaseId}<br>Cuenta: ${safeAccountEmail}</p><p style="${P}">La verificación del buzón no constituye prueba independiente y no se ha modificado ningún factor. Revisa el procedimiento administrativo aprobado.</p>`,
        ),
      }), signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("No se pudo entregar el aviso de recuperación al administrador.");
  }

  async sendAccountRecoveryGrant(input: { email: string; ticket: string; grantId: string }): Promise<void> {
    if (!this.config.recoveryBaseUrl) throw new Error("No hay URL de recuperación configurada.");
    const link = new URL(this.config.recoveryBaseUrl);
    link.hash = new URLSearchParams({ ticket: input.ticket }).toString();
    const safeLink = escapeHtml(link.href);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `account-recovery-grant/${input.grantId}` },
      body: JSON.stringify({
        from: this.config.from,
        to: [input.email],
        subject: "Laural: enlace temporal para volver a configurar tu segundo factor",
        text: `El administrador ha aprobado tu solicitud tras su revisión. Abre este enlace antes de 30 minutos para registrar un TOTP nuevo: ${link.href}\n\nEl enlace solo permite configurar el factor; no inicia sesión ni accede a tus preferencias. Al confirmar el nuevo TOTP se retirarán los factores anteriores y se revocarán las sesiones. Después inicia sesión en Laural con tu contraseña y el nuevo código. Si no solicitaste esta recuperación, contacta inmediatamente con el administrador.`,
        html: emailShell(
          "Configura tu segundo factor",
          `<p style="${GREETING}">El administrador ha aprobado tu solicitud tras su revisión.</p>${emailButton("Configurar un nuevo segundo factor", safeLink)}<p style="${P}">El enlace caduca en 30 minutos y solo permite registrar un TOTP.</p><p style="${P}">Al confirmar el nuevo TOTP se retirarán los factores anteriores y se revocarán las sesiones. Después inicia sesión en Laural con tu contraseña y el nuevo código.</p><p style="${P}">Si no solicitaste esta recuperación, contacta inmediatamente con el administrador.</p>`,
        ),
      }), signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("No se pudo entregar el enlace de recuperación.");
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
        html: emailShell(
          message.subject,
          `<p style="${GREETING}">${message.body}</p><p style="${P}">Si no reconoces este cambio, cambia tu contraseña y ponte en contacto con el administrador de Laural.</p>`,
        ),
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
    case "account_recovered":
      return { subject: "Se restablecieron los factores de tu cuenta de Laural", body: "Se sustituyeron los factores de seguridad de tu cuenta tras una recuperación aprobada por el administrador. Se revocaron las sesiones existentes. Si no lo solicitaste, contacta al administrador." };
  }
}

function escapeHtml(value: string): string {
  const replacements: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  };
  return value.replace(/[&<>"']/gu, (character) => replacements[character]!);
}
