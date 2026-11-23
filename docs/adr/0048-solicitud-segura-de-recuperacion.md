# ADR-0048: Solicitud de revisión para recuperar factores

- Estado: aceptada; flujo de solicitud implementado y validado localmente, operación administrativa y despliegue pendientes.
- Fecha: 2026-11-23

## Contexto

Una persona que pierde TOTP, códigos de recuperación y passkeys necesita contactar al administrador. El PIN de seis dígitos acordado solo acredita acceso al buzón; no debe conceder sesión, cambiar contraseña ni retirar factores. El administrador decide tras comprobar evidencia preexistente e independiente.

## Decisión

- Incorporar un flujo web opcional de solicitud y confirmación, apagado por defecto y habilitable solo con autenticación por correo y un correo de administrador configurado.
- Responder de forma genérica tanto si la cuenta existe como si no. Limitar por IP y correo, aplicar enfriamiento por cuenta y generar un PIN aleatorio de un solo uso con vigencia de cinco minutos y cinco intentos.
- Guardar únicamente HMAC del PIN con separación de propósito; consumirlo atómicamente al confirmar. La transacción crea un aviso administrativo en una outbox. No se guarda el PIN ni se incluye en el aviso.
- El correo al administrador indica identificador aleatorio del caso, email de la cuenta y que la verificación no basta como prueba independiente. No incluye material probatorio.
- La verificación no abre sesión, no cambia la contraseña y no modifica factores ni sesiones. No se agrega ruta pública de administración o retirada de MFA.
- Los avisos usan Resend, idempotencia, reintentos limitados y retención acotada. La decisión posterior sigue el runbook vigente y depende del administrador.

## Consecuencias y límites

- La solicitud por sí sola no recupera la cuenta. Hace falta implementar y ensayar un procedimiento privilegiado local al VPS, además de completar el proceso de evaluación, registro, revocación de sesiones, alta de factor nuevo y aviso al usuario.
- El endpoint permanece oculto salvo `ACCOUNT_RECOVERY_ENABLED=true` y `ACCOUNT_RECOVERY_ADMIN_EMAIL` válido. La configuración también requiere `EMAIL_AUTH_ENABLED=true` y las credenciales normales de Resend.
- Los correos verificados y casos se eliminan en las políticas de retención; los avisos terminales se purgan a los 30 días y los casos consumidos a los 90 días.
- No habilitar cuentas externas hasta ensayar abuso de límites, entrega/alertas de Resend, recuperación privilegiada y despliegue en el VPS.

## Verificación

- Pruebas unitarias cubren PIN aleatorio, normalización, delegación de verificación y respuestas inválidas.
- Integración PostgreSQL cubre consumo de un solo uso, almacenamiento del digest, outbox tras confirmación, reintento del aviso y ausencia de creación de sesión. Suite del servicio: 166/166 pruebas; 89,72 % de líneas y 79,82 % de ramas. Falta CI remoto y despliegue.

## Referencias

- [Runbook de recuperación](../runbooks/recuperacion-cuenta.md)
- [ADR-0038: MFA TOTP](0038-fundamentos-de-mfa-totp.md)
- [ADR-0037: restablecimiento de contraseña](0037-restablecimiento-de-contrasena-por-pin.md)
