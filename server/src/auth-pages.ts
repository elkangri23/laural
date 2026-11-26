// Páginas de acceso separadas: cada paso (entrar, crear cuenta, verificar
// correo, restablecer contraseña, recuperación) tiene su propia página, con
// enlaces entre ellas. El token CSRF viaja en la URL de los enlaces porque
// el servidor solo guarda su resumen (sha256): no se puede recuperar a
// partir de la cookie del flujo. El token es de un solo flujo, caduca a los
// 10 minutos y no sirve sin la cookie HttpOnly del flujo; las páginas no
// envían Referer (Referrer-Policy: no-referrer), así que el token no sale
// de este origen.
function authShell(title: string, heading: string, intro: string, body: string, passkeysEnabled = false): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Laural</title><link rel="stylesheet" href="/auth.css"></head>
<body><div class="shell"><header class="brand"><div class="mark" aria-hidden="true">L</div><div><div class="brand-name">Laural</div><div class="brand-caption">Cuenta y sincronización</div></div></header>
<main><h1>${heading}</h1><p class="intro">${intro}</p>
${body}
</main><footer>Laural · Acceso seguro desde navegador externo</footer>${passkeysEnabled ? '<script type="module" src="/auth/passkeys.js"></script>' : ""}</div></body></html>`;
}

export function renderLoginPage(csrfToken: string, notice = "", passkeysEnabled = false, googleEnabled = false, accountRecoveryEnabled = false): string {
  const csrf = escapeHtml(csrfToken);
  const safeNotice = escapeHtml(notice);
  const body = `<p class="notice" role="status">${safeNotice}</p>
${googleEnabled ? `<form action="/auth/native/google/start" method="post"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">Continuar con Google</button></form>` : ""}
${passkeysEnabled ? `<p class="notice" role="status" data-passkey-notice></p><button type="button" data-passkey-login>Iniciar sesión con passkey</button>
<form action="/auth/native/login/mfa" method="post" data-passkey-mfa hidden><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="username" required maxlength="320"></label>
<label>Código TOTP o de recuperación<input name="proof" autocomplete="one-time-code" required maxlength="19"></label><button type="submit">Verificar y continuar</button></form>` : ""}
<form action="/auth/native/login" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="username" required maxlength="320"></label>
<label>Contraseña<input name="password" type="password" autocomplete="current-password" required minlength="12" maxlength="128"></label>
<button type="submit">Iniciar sesión</button></form>
<nav class="page-links"><a href="/auth/native/register?csrf=${csrf}">¿No tienes cuenta? Crea una</a><a href="/auth/native/password-reset?csrf=${csrf}">¿Olvidaste tu contraseña?</a>${accountRecoveryEnabled ? `<a href="/auth/native/recovery?csrf=${csrf}">He perdido mis factores de seguridad</a>` : ""}</nav>`;
  return authShell("Iniciar sesión", "Inicia sesión en Laural", "Usa tu cuenta para continuar. La contraseña se introduce únicamente en esta página segura del navegador.", body, passkeysEnabled);
}

export function renderRegisterPage(csrfToken: string, notice = ""): string {
  const csrf = escapeHtml(csrfToken);
  const safeNotice = escapeHtml(notice);
  const body = `<p class="notice" role="status">${safeNotice}</p>
<form action="/auth/native/register" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Nombre<input name="displayName" autocomplete="name" required minlength="1" maxlength="80"></label>
<label>Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="320"></label>
<label>Contraseña (mínimo 12 caracteres)<input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label>
<button type="submit">Crear cuenta y enviar PIN</button></form>
<p class="privacy">Te enviaremos un PIN de verificación al correo indicado. Después tendrás que verificarlo para poder iniciar sesión.</p>
<nav class="page-links"><a href="/auth/native/login?csrf=${csrf}">¿Ya tienes cuenta? Inicia sesión</a></nav>`;
  return authShell("Crear cuenta", "Crea tu cuenta", "Crea tu cuenta de Laural para sincronizar tus preferencias.", body);
}

export function renderVerificationPage(csrfToken: string, notice = ""): string {
  const csrf = escapeHtml(csrfToken);
  const safeNotice = escapeHtml(notice);
  const body = `<p class="notice" role="status">${safeNotice}</p>
<form action="/auth/native/verification/confirm" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="320"></label>
<label>PIN de seis dígitos<input name="pin" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label>
<button type="submit">Verificar correo</button></form>
<form action="/auth/native/verification/resend" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="320"></label>
<button type="submit">Reenviar PIN</button></form>
<p class="privacy">El PIN solo verifica el correo o permite cambiar la contraseña. No inicia sesión ni elimina passkeys o MFA. Las claves de tus proveedores no forman parte de esta cuenta.</p>
<nav class="page-links"><a href="/auth/native/login?csrf=${csrf}">Volver a iniciar sesión</a></nav>`;
  return authShell("Verificar correo", "Verifica tu correo", "Introduce el PIN de seis dígitos que te hemos enviado al correo.", body);
}

export function renderPasswordResetPage(csrfToken: string, notice = ""): string {
  const csrf = escapeHtml(csrfToken);
  const safeNotice = escapeHtml(notice);
  const body = `<p class="notice" role="status">${safeNotice}</p>
<form action="/auth/native/password-reset/request" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="320"></label><button type="submit">Enviar PIN de recuperación</button></form>
<form action="/auth/native/password-reset/confirm" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="320"></label>
<label>PIN de seis dígitos<input name="pin" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label>
<label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label>
<button type="submit">Cambiar contraseña</button></form>
<p class="privacy">El PIN solo verifica el correo o permite cambiar la contraseña. No inicia sesión ni elimina passkeys o MFA.</p>
<nav class="page-links"><a href="/auth/native/login?csrf=${csrf}">Volver a iniciar sesión</a></nav>`;
  return authShell("Restablecer contraseña", "Restablecer contraseña", "El PIN permite cambiar la contraseña, pero no inicia sesión ni elimina passkeys o MFA. Después tendrás que iniciar sesión normalmente.", body);
}

export function renderRecoveryPage(csrfToken: string, notice = ""): string {
  const csrf = escapeHtml(csrfToken);
  const safeNotice = escapeHtml(notice);
  const body = `<p class="notice" role="status">${safeNotice}</p>
<form action="/auth/native/recovery/request" method="post"><input type="hidden" name="csrf" value="${csrf}"><label>Correo de la cuenta<input name="email" type="email" autocomplete="email" required maxlength="320"></label><button type="submit">Solicitar revisión</button></form>
<form action="/auth/native/recovery/confirm" method="post"><input type="hidden" name="csrf" value="${csrf}"><label>Correo de la cuenta<input name="email" type="email" autocomplete="email" required maxlength="320"></label><label>PIN recibido<input name="pin" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label><button type="submit">Verificar buzón y enviar al administrador</button></form>
<p class="privacy">Verificar el buzón no crea una sesión ni elimina factores de seguridad.</p>
<nav class="page-links"><a href="/auth/native/login?csrf=${csrf}">Volver a iniciar sesión</a></nav>`;
  return authShell("Recuperación de cuenta", "He perdido mis factores de seguridad", "El PIN solo confirma el acceso al buzón. No inicia sesión, no cambia la contraseña y no elimina TOTP ni passkeys. Tras verificarlo, el administrador revisará el caso y podrá pedir una prueba independiente.", body);
}

export function renderMfaPage(csrfToken: string, email: string, notice = ""): string {
  const csrf = escapeHtml(csrfToken);
  const safeEmail = escapeHtml(email);
  const safeNotice = escapeHtml(notice);
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verificación de seguridad · Laural</title><link rel="stylesheet" href="/auth.css"></head>
<body><div class="shell"><header class="brand"><div class="mark" aria-hidden="true">L</div><div><div class="brand-name">Laural</div><div class="brand-caption">Cuenta y sincronización</div></div></header>
<main><h1>Verifica tu identidad</h1><p class="intro">Introduce el código de tu aplicación autenticadora o uno de tus códigos de recuperación.</p>
<p class="notice" role="status">${safeNotice}</p>
<form action="/auth/native/login/mfa" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="username" required maxlength="320" value="${safeEmail}"></label>
<label>Código de autenticación o recuperación<input name="proof" inputmode="text" autocomplete="one-time-code" required maxlength="19" autofocus></label>
<button type="submit">Verificar y continuar</button></form>
<p class="privacy">Un código de recuperación se invalida al usarlo. El PIN de correo no sustituye este factor.</p>
</main><footer>Laural · Acceso seguro desde navegador externo</footer></div></body></html>`;
}

export function renderAccountRecoveryPage(): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Recuperación segura · Laural</title><link rel="stylesheet" href="/auth.css"></head><body><div class="shell"><header class="brand"><div class="mark" aria-hidden="true">L</div><div><div class="brand-name">Laural</div><div class="brand-caption">Recuperación segura de cuenta</div></div></header><main>
<h1>Configura un nuevo segundo factor</h1><p class="intro">Este enlace temporal solo permite registrar una aplicación autenticadora. No inicia sesión ni da acceso a tus preferencias.</p>
<section data-recovery-enrollment hidden><p>Añade esta clave a tu aplicación autenticadora:</p><p><code data-recovery-secret></code></p><p><a data-recovery-uri>Abrir en una aplicación compatible</a></p><form data-recovery-form><label>Código de seis dígitos<input data-recovery-code inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required maxlength="6"></label><button type="submit">Confirmar y sustituir factores anteriores</button></form></section>
<p class="notice" role="status" aria-live="polite" data-recovery-notice>Validando el enlace temporal…</p><section data-recovery-codes hidden><h2>Guarda tus códigos nuevos</h2><p>Solo se muestran ahora. Guárdalos en un lugar seguro. No se ha iniciado sesión; cierra esta página y vuelve a entrar desde Laural con tu contraseña y el nuevo TOTP.</p><ul data-recovery-code-list></ul></section>
<p class="privacy">Al confirmar el nuevo código se retirarán TOTP, passkeys y códigos anteriores, y se revocarán las sesiones activas.</p></main><footer>Laural · Recuperación revisada por el administrador</footer><script type="module" src="/auth/recovery.js"></script></div></body></html>`;
}

export function escapeHtml(value: string): string {
  const replacements: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return value.replace(/[&<>"']/gu, (character) => replacements[character]!);
}
