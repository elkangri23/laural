# ADR-0034: Revocar la sesión actual al cerrar sesión

- **Estado:** Aceptada; API y cliente implementados, validación en VPS pendiente
- **Fecha:** 2026-11-21
- **Decisores:** Antonio Moles

## Contexto

La sesión de cuenta dura hasta 30 días y su token se conserva en Windows Credential Manager. Borrar solo la credencial local no invalida una copia robada ni el token que el servicio todavía acepta. El cierre debe revocar el acceso remoto de este dispositivo, pero el usuario también debe poder cerrar la sesión local cuando no tenga conexión.

## Decisión

- La API expone `POST /v1/auth/session/revoke`, protegido con el bearer actual y un límite persistente de diez solicitudes por IP/ruta y minuto.
- El servidor autentica el token, calcula su SHA-256 y establece `revoked_at` únicamente en la sesión no expirada que corresponde a esa cuenta. No recibe ni persiste un token nuevo ni afecta a otros dispositivos.
- La API devuelve `204` si revoca la sesión y `401` si la sesión ya no es válida. No revela si la cuenta o la sesión existieron.
- El cliente Rust usa HTTPS, deshabilita redirects y limita la espera a ocho segundos. Después de intentar la revocación, elimina siempre la credencial de Windows. La respuesta de Tauri indica si se confirmó la revocación.
- Si el servicio no responde, el cliente termina la sesión local e informa que el servidor podría aceptar el token hasta su vencimiento. No conserva el token para reintentos en segundo plano.

## Consecuencias

- El cierre de sesión invalida el token actual cuando hay conexión; otras sesiones del usuario siguen activas.
- Un atacante con el bearer puede cerrar esa sesión, lo cual equivale a tener ya el acceso de la cuenta. La operación no permite revocar otras sesiones.
- La pérdida de conexión puede dejar una sesión remota válida hasta 30 días. No presentar el caso offline como revocación confirmada.
- Antes de habilitar cuentas en producción hay que verificar el endpoint detrás de Caddy/VPS. La revocación de otras sesiones se define en [ADR-0036](0036-gestion-de-sesiones-de-cuenta.md); el cierre/borrado total de cuenta queda fuera de esta decisión.

## Evidencia

- [Contrato OpenAPI](../../server/openapi.yaml)
- [Guía del servicio](../../server/README.md)
- [ADR-0028: login nativo y PKCE](0028-login-nativo-pkce.md)
- Pruebas backend del endpoint y de la actualización de sesión en PostgreSQL temporal de CI.
