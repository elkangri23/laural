# ADR-0028: Login nativo mediante navegador y PKCE

- **Estado:** Aceptada; servidor implementado, integración Tauri pendiente
- **Fecha:** 2026-11-21
- **Decisores:** Antonio Moles

## Contexto

El login de Laural debe mantener las contraseñas fuera del WebView y devolver la sesión al proceso nativo mediante un callback loopback. Se necesita mitigar CSRF, open redirects y repetición de códigos. El PIN de email no puede iniciar sesión (ADR-0027).

## Decisión

- La aplicación abre la página propia HTTPS `/auth/native` en el navegador externo. El inicio contiene una redirect URI exacta `http://127.0.0.1:<puerto>/callback`, un `state` aleatorio y un challenge PKCE S256.
- El servidor rechaza redirects que no sean ese host/path, credenciales, query o fragment. Crea un flow de diez minutos, guarda hashes de cookie/CSRF y coloca cookie `__Host-` Secure, HttpOnly y SameSite=Strict.
- Login email/contraseña ocurre en un formulario web propio en español. El POST requiere cookie y CSRF; credenciales erróneas no se distinguen de email no verificado. El código no se crea si la cuenta no está verificada.
- El callback loopback recibe un código aleatorio, ligado al flow y al challenge PKCE, de un solo uso y con dos minutos de vigencia. PostgreSQL conserva solo el hash del código.
- `/v1/auth/native/exchange` valida S256, consume el código dentro de una transacción y crea un token de sesión aleatorio válido 30 días. Solo el hash del token se almacena. La respuesta queda reservada al cliente Rust, nunca al formulario/WebView.
- Los componentes de cuenta/login permanecen desmontados salvo configurar `EMAIL_AUTH_ENABLED=true` con Resend y pepper de PIN correctos; el valor predeterminado es desactivado.

## Consecuencias

- La contraseña nunca atraviesa la WebView ni aparece en la redirect URI. State se debe validar en el callback Rust, que aún está pendiente junto al listener loopback, intercambio HTTPS desde Rust y guardado en Credential Manager.
- Los tokens son revocables en base de datos, pero aún no hay UI de dispositivos/logout, rotación ni renovación; la caducidad fija es 30 días.
- Login por Google, passkeys, TOTP y recuperación se implementan aparte; el flujo email actual no retira MFA.
- Faltan límites persistentes por IP/origen y mitigaciones de abuso distribuido. No habilitar ni publicar estas rutas todavía.
- Los códigos/flows vencidos y sesiones requieren limpieza/retención operativa; falta integración de PostgreSQL real y pruebas de carrera.

## Evidencia

- [API y guía del servidor](../../server/README.md)
- [Contrato OpenAPI](../../server/openapi.yaml)
- [ADR-0023: arquitectura de sync](0023-servicio-de-sincronizacion.md)
- [ADR-0027: registro y verificación](0027-registro-y-verificacion-de-correo.md)
