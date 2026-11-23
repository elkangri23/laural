# ADR-0038: Fundamentos de TOTP y recuperación

- **Estado:** Aceptada; backend/UI e integración PostgreSQL local; entrega Resend y despliegue pendientes
- **Fecha:** 2026-11-22
- **Decisores:** Antonio Moles

## Contexto

El plan de sincronización exige TOTP y códigos de recuperación antes de habilitar cuentas públicamente. La decisión anterior fijó primitivas criptográficas; esta ADR conserva ese formato y ahora registra su integración local en almacenamiento, login y Configuración.

## Decisión

- Implementar TOTP compatible con RFC 6238: HMAC-SHA-1, seis dígitos, intervalo de 30 segundos y tolerancia de un intervalo antes/después para diferencias de reloj.
- Impedir reutilizar un intervalo que ya autenticó; persistir el contador aceptado de forma atómica por factor.
- Generar secretos aleatorios de 160 bits y presentarlos como URI `otpauth://` para aplicaciones autenticadoras compatibles.
- Cifrar semillas con AES-256-GCM, nonce aleatorio de 96 bits y etiqueta íntegra de 128 bits. Asociar el account ID como AAD para impedir intercambiar ciphertexts entre cuentas. La llave de cifrado será un secreto dedicado del servicio y no se compartirá con el pepper de PINes.
- Generar diez códigos de recuperación aleatorios de 64 bits; mostrar cada código una sola vez y almacenar solo HMAC por cuenta con un pepper dedicado. Cada código será de un solo uso.
- La configuración/cambio de factores exigirá una autenticación reciente. El backend debe crear códigos de recuperación y hacer que el usuario confirme que los guardó antes de activar el factor. Los cambios de factor revocarán las demás sesiones y registrarán un aviso de correo en la cola transaccional descrita en [ADR-0039](0039-outbox-de-avisos-de-seguridad.md).
- La contraseña y el PIN de correo no sustituyen el TOTP ni permiten quitar el factor por sí solos. La recuperación administrativa de factores seguirá el runbook y no tendrá endpoint público.

## Consecuencias

- Se añadieron vectores RFC, ventana temporal, protección frente a repetición, URI, cifrado autenticado asociado a cuenta y generación/digest de códigos en `server/src/totp.ts`.
- La migración, challenge después de contraseña, gestión de factores, enrolamiento y rotación de códigos están implementados localmente. Los códigos nuevos permanecen inactivos hasta confirmar su guardado; la rotación conserva los anteriores hasta ese punto. Las sesiones no recientes no pueden modificar factores y la transacción vuelve a validar la sesión actual antes de revocar otras sesiones.
- MFA todavía no está lista para producción: TOTP y passkeys están integradas localmente y sus cambios se encolan para correo; falta validar entrega Resend y operación de la cola; Google OIDC está implementado localmente según ADR-0047, pendiente de credenciales/despliegue; sigue pendiente la recuperación administrativa, validación Tauri y ensayo en VPS. Las cuentas siguen deshabilitadas por defecto.
- La llave AES y el pepper de recuperación requieren variables separadas, despliegue seguro, rotación/migración planificadas y nunca deben aparecer en logs o Git.
- La recuperación por correo sigue permitiendo cambiar contraseña, pero el login posterior exige el factor inscrito.

## Evidencia

- [OWASP MFA Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)
- [Documentación de cifrado autenticado de Node.js](https://nodejs.org/api/crypto.html)
- [Plan aprobado de sincronización](../plans/sincronizacion-preferencias.md)
- [Pruebas del núcleo TOTP](../../server/tests/totp.test.ts)
