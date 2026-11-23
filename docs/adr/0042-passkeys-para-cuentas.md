# ADR-0042: Passkeys para las cuentas de sincronización

- Estado: aceptada; integración local y avisos en cola, pendiente de despliegue y validación en VPS/Windows.
- Fecha: 2026-11-23.

## Contexto

El plan de sincronización contempla passkeys además de contraseña y TOTP. El acceso debe poder ser passwordless, pero no debe desactivar el segundo factor TOTP si la cuenta lo tiene activo. La gestión se inicia desde Configuración y el token de la cuenta no debe pasar al WebView.

## Decisión

- Implementar WebAuthn con `@simplewebauthn/server` y `@simplewebauthn/browser`. Las credenciales son discoverable, requieren verificación de usuario, usan atestación `none` y se limitan a diez por cuenta.
- Guardar en PostgreSQL el ID de credencial, clave pública, contador, transportes, nombre visible, tipo de dispositivo y estado de respaldo. No guardar secretos de autenticador ni registrar respuestas WebAuthn.
- Login passwordless: reto ligado al flujo nativo vigente, de un solo uso y con vencimiento. Verificar origen y RP ID configurados exactamente, user handle de la cuenta, firma y verificación de usuario. Completar el flujo loopback/PKCE existente.
- Si la cuenta tiene TOTP habilitado, validar primero la passkey y después exigir el challenge TOTP o código de recuperación existente. El PIN de correo no sustituye factores.
- La gestión abre un enlace opaco de un solo uso con vencimiento de dos minutos, transmitido en el fragmento URL para que no aparezca en peticiones ni registros de servidor. Solo se emite si la sesión bearer tiene menos de diez minutos. El canje crea una sesión web de gestión de cinco minutos con cookie `HttpOnly`, `Secure`, `SameSite=Strict`, token CSRF separado, CSP estricta y límites de solicitudes.
- Permitir añadir y revocar credenciales. Serializar la inserción por cuenta para mantener el límite de diez incluso con solicitudes concurrentes.
- Mantener passkeys desactivadas por defecto y exigir `EMAIL_AUTH_ENABLED`, `PASSKEY_RP_ID` y `PASSKEY_ORIGIN` HTTPS exactos. No habilitar el VPS hasta aplicar migraciones y comprobar el dominio autenticador.
- Google OAuth se decidió después en [ADR-0047](0047-login-con-google-oauth.md); sus credenciales y callback HTTPS son independientes.

## Consecuencias

- Las passkeys dan acceso passwordless con verificación de usuario; TOTP activo conserva el segundo paso acordado.
- Los navegadores y autenticadores deben soportar WebAuthn discoverable credentials y el dominio de producción debe coincidir con el RP ID.
- La gestión depende de un inicio de sesión reciente; hay que volver a iniciar sesión antes de modificar passkeys si la sesión superó diez minutos.
- Los avisos por correo de altas y bajas usan la cola transaccional decidida en [ADR-0043](0043-avisos-de-cambios-passkey.md). Quedan pendientes pruebas end-to-end de autenticadores/Google, validación Windows/VPS, migraciones de producción y correo/operación reales.

## Referencias

- [ADR-0020: perfiles y sincronización opcional](0020-perfiles-y-sincronizacion-opcional.md)
- [ADR-0023: servicio y autenticación](0023-servicio-de-sincronizacion.md)
- [Modelo de amenazas](../security/threat-model.md)
- [Documentación de SimpleWebAuthn Server](https://simplewebauthn.dev/docs/packages/server)
