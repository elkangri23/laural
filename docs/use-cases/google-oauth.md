# UC-28 — Registrarse o iniciar sesión con Google

**Actor:** usuario de Laural que quiere sincronizar preferencias con su cuenta.

**Objetivo:** crear una cuenta de sincronización o entrar en una existente usando Google, sin exponer tokens OAuth al cliente de escritorio.

**Precondiciones:** la autenticación por email está configurada; Google OAuth se ha activado en el servicio; el redirect URI HTTPS coincide exactamente con el autorizado en Google Cloud.

**Flujo principal:**

1. Laural abre el navegador para el flujo nativo habitual y muestra «Continuar con Google».
2. El usuario elige la cuenta Google y acepta `openid` y `email`.
3. El servicio valida el callback de un solo uso, PKCE, firma/audiencia/emisor/expiración del ID token, `nonce` y correo verificado.
4. El servicio encuentra la identidad por `sub`; o la vincula al correo verificado de una cuenta Laural; o crea una cuenta nueva verificada.
5. Si la cuenta tiene TOTP, el usuario completa ese segundo factor.
6. Laural recibe el código de autorización loopback de corta duración y lo canjea con PKCE por su sesión opaca habitual.

**Alternativas:** si Google cancela, el estado caduca, el correo no está verificado, la identidad está en conflicto o falla la verificación, se muestra un mensaje genérico y el usuario puede reiniciar el flujo. No se revela si una cuenta/correo existe.

**Seguridad y privacidad:** `state` y `nonce` son valores opacos de un solo uso; el verificador PKCE y sus hashes de asociación viven como máximo diez minutos. El `sub` se almacena como identidad estable. No se guardan ID/access/refresh tokens de Google. Si TOTP está activo, no se omite. Las claves API de proveedores no participan en el flujo.

**Criterios de aceptación:** el login vuelve al callback loopback validado de Laural; Google no recibe otros scopes; la cuenta nueva queda verificada; una identidad no se puede asociar dos veces; el estado no se puede reutilizar; los errores son genéricos.

**Estado:** código local disponible detrás de `GOOGLE_OAUTH_ENABLED`; faltan credenciales reales, pruebas end-to-end con Google, despliegue de migración y ensayo del proxy/VPS.
