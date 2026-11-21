# ADR-0038: Fundamentos de TOTP y recuperación

- **Estado:** Aceptada; primitivas criptográficas implementadas, integración pendiente
- **Fecha:** 2026-11-21
- **Decisores:** Antonio Moles

## Contexto

El plan de sincronización exige TOTP y códigos de recuperación antes de habilitar cuentas públicamente. La autenticación actual todavía no aplica MFA. Se necesita acordar el formato criptográfico antes de conectar el alta, el inicio de sesión y la interfaz.

## Decisión

- Implementar TOTP compatible con RFC 6238: HMAC-SHA-1, seis dígitos, intervalo de 30 segundos y tolerancia de un intervalo antes/después para diferencias de reloj.
- Impedir reutilizar un intervalo que ya autenticó; la integración persistirá el contador aceptado de forma atómica por factor.
- Generar secretos aleatorios de 160 bits y presentarlos como URI `otpauth://` para aplicaciones autenticadoras compatibles.
- Cifrar semillas con AES-256-GCM, nonce aleatorio de 96 bits y etiqueta íntegra de 128 bits. Asociar el account ID como AAD para impedir intercambiar ciphertexts entre cuentas. La llave de cifrado será un secreto dedicado del servicio y no se compartirá con el pepper de PINes.
- Generar diez códigos de recuperación aleatorios de 64 bits; mostrar cada código una sola vez y almacenar solo HMAC por cuenta con un pepper dedicado. Cada código será de un solo uso.
- La configuración/cambio de factores exigirá una autenticación reciente. El backend debe crear códigos de recuperación y hacer que el usuario confirme que los guardó antes de activar el factor. Los cambios de factor revocarán las demás sesiones y notificarán al correo de la cuenta.
- La contraseña y el PIN de correo no sustituyen el TOTP ni permiten quitar el factor por sí solos. La recuperación administrativa de factores seguirá el runbook y no tendrá endpoint público.

## Consecuencias

- Se añadieron vectores RFC, ventana temporal, protección frente a repetición, URI, cifrado autenticado asociado a cuenta y generación/digest de códigos en `server/src/totp.ts`.
- Esta ADR **no declara MFA operativa**: no hay todavía migración, gestión de factores, challenge TOTP en login, UI de enrolamiento ni confirmación/rotación de códigos. Las cuentas continúan deshabilitadas por defecto.
- La llave AES y el pepper de recuperación requieren variables separadas, despliegue seguro, rotación/migración planificadas y nunca deben aparecer en logs o Git.
- La recuperación por correo sigue permitiendo cambiar contraseña, pero una sesión posterior tendrá que probar el factor inscrito una vez que la integración de login se complete.

## Evidencia

- [OWASP MFA Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)
- [Documentación de cifrado autenticado de Node.js](https://nodejs.org/api/crypto.html)
- [Plan aprobado de sincronización](../plans/sincronizacion-preferencias.md)
- [Pruebas del núcleo TOTP](../../server/tests/totp.test.ts)
