# ADR-0047: Inicio de sesión con Google mediante OAuth/OIDC y PKCE

- Estado: aceptada; implementación local detrás de flag, pendiente de credenciales, validación real y despliegue.
- Fecha: 2026-11-23.

## Contexto

El plan de cuentas contempla Google como alternativa de acceso a la sincronización. El inicio de sesión de Laural ya usa navegador externo, flujo nativo con cookie `HttpOnly`, callback loopback, `state` y PKCE. Google debe integrarse en ese flujo sin llevar tokens de proveedor al escritorio ni reducir los factores de seguridad de una cuenta existente.

## Decisión

- Usar OpenID Connect mediante `google-auth-library`, con scopes mínimos `openid email`, PKCE S256, `state` aleatorio de 256 bits y `nonce` aleatorio de 256 bits.
- Guardar solo hashes SHA-256 de `state` y `nonce`, el verificador PKCE temporal y hashes del flujo nativo en `google_oauth_transactions`, con caducidad de diez minutos y consumo de un solo uso. La cookie del flujo es `SameSite=Strict`, por lo que el callback no depende de que el navegador la envíe desde Google: el `state` opaco enlaza el callback con el flujo ya creado. Después de verificarlo se rota el CSRF.
- Verificar firma, emisor, audiencia y expiración del ID token con la biblioteca oficial; exigir `email_verified === true`, `sub` acotado y coincidencia constante del `nonce`. El `sub` es la clave estable de identidad.
- Vincular un `sub` ya conocido a la cuenta existente. Para un `sub` nuevo, vincularlo a una cuenta Laural existente solo cuando coincide el correo verificado; si no hay cuenta, crear una cuenta verificada passwordless. Un correo existente pero sin verificar no se vincula. Las restricciones únicas impiden que la misma identidad Google se vincule a varias cuentas o que una cuenta Laural tenga identidades Google duplicadas.
- Una cuenta con TOTP conserva el segundo paso obligatorio tras Google. Los nuevos accesos continúan mediante el código de autorización loopback y el canje PKCE nativo de Laural.
- No persistir ID, access ni refresh tokens de Google. No solicitar scopes de perfil ni acceso a APIs adicionales.
- Desactivar por defecto con `GOOGLE_OAUTH_ENABLED`; exigir autenticación de cuenta activa y redirect URI HTTPS exacta `/auth/google/callback`. Las credenciales se configuran solo en el entorno privado del servicio.

## Consecuencias

- El login local usa un callback web y vuelve al mismo código de autorización nativo que contraseña/passkey, por lo que la app de escritorio no recibe tokens OAuth de Google.
- Los usuarios pueden registrar una cuenta de sincronización mediante un correo verificado por Google. Las credenciales de proveedores de modelos siguen excluidas de la sincronización.
- Activarlo requiere crear credenciales OAuth en Google Cloud, autorizar el redirect URI exacto del VPS, aplicar la migración 011 y comprobar correo verificado, MFA, callback y límites detrás de Caddy.
- La vinculación automática por correo confía en la afirmación de correo verificado de Google; cambios de proveedor, dominios o política de Google requieren revisar esta decisión.

## Referencias

- [ADR-0028: login nativo PKCE](0028-login-nativo-pkce.md)
- [ADR-0042: passkeys para cuentas](0042-passkeys-para-cuentas.md)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google OAuth para aplicaciones web](https://developers.google.com/identity/protocols/oauth2/web-server)
