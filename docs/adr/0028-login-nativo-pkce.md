# ADR-0028: Login nativo mediante navegador y PKCE

- **Estado:** Aceptada; login PKCE y revocación de la sesión actual implementados, validación con VPS pendiente
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
- El cliente nativo abre el navegador con el plugin opener invocado desde Rust. Un listener de un solo uso se enlaza a `127.0.0.1` en puerto efímero, limita el tamaño y tiempo de lectura, comprueba `state` en tiempo constante y solo acepta `code`/`state` válidos. El canje usa HTTPS, timeout, límite de 4 KiB y sin seguir redirects. El token queda en Credential Manager y el WebView solo recibe el estado.

## Consecuencias

- La contraseña nunca atraviesa la WebView ni aparece en la redirect URI. El callback y almacenamiento seguro ya están conectados en Tauri, pero falta una prueba de integración contra un servicio desplegado y habilitado.
- Quitar la cuenta intenta revocar la sesión bearer actual por HTTPS y después elimina siempre el token local. El servidor solo marca la sesión identificada por el hash del token y su cuenta; no afecta a otros dispositivos. Si no se confirma la respuesta de revocación, la UI avisa y la sesión remota puede seguir válida hasta su vencimiento (30 días).
- `POST /v1/auth/session/revoke` autentica la sesión antes de revocarla, requiere la cuenta activa/verificada y tiene límite persistente de diez solicitudes por minuto. Repetir la petición con un token ya revocado devuelve `401` sin revelar si la sesión existió.
- Login por Google, passkeys, TOTP y recuperación se implementan aparte; el flujo email actual no retira MFA.
- Los límites persistentes por IP/ruta están implementados y se prueban en PostgreSQL temporal de CI. Falta validar la IP real detrás de Caddy y mitigar abuso coordinado. No habilitar ni publicar estas rutas todavía.
- Los flows/códigos PKCE de más de 24 horas y las sesiones vencidas o revocadas se eliminan en el barrido horario. CI prueba login y revocación con PostgreSQL real temporal, pero falta validar carreras/carga en el VPS y gestionar sesiones de otros dispositivos.

## Evidencia

- [API y guía del servidor](../../server/README.md)
- [Contrato OpenAPI](../../server/openapi.yaml)
- [ADR-0023: arquitectura de sync](0023-servicio-de-sincronizacion.md)
- [ADR-0027: registro y verificación](0027-registro-y-verificacion-de-correo.md)
