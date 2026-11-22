# ADR-0037: Restablecer contraseña con PIN de correo

- **Estado:** Aceptada; API y flujo web implementados localmente; validación de Resend/VPS pendiente
- **Fecha:** 2026-11-21
- **Decisores:** Antonio Moles

## Contexto

La persona puede perder la contraseña de su cuenta de sincronización. El diseño ya limita el PIN de correo a verificación y recuperación: no debe crear sesiones ni servir para retirar MFA. También hace falta invalidar sesiones que pudieran conservar un atacante después de un cambio de contraseña.

## Decisión

- Ofrecer solicitud de recuperación desde el formulario externo de cuenta y la API. El PIN aleatorio de seis dígitos dura cinco minutos, tiene un solo uso y hasta cinco intentos; su verificador HMAC está separado por propósito del PIN de verificación de correo.
- Responder de forma genérica sin indicar si la cuenta existe, está verificada, recibió un correo o el PIN fue válido. Aplicar límites por IP y cuenta; limitar solicitudes por cuenta a una por minuto y tres cada quince minutos.
- Un PIN correcto permite establecer una nueva contraseña, almacenada con Argon2id. En una única transacción se consume el código y se revocan las sesiones activas. La operación no crea una sesión.
- El cambio no elimina ni sustituye factores MFA. Si TOTP está inscrito, el siguiente inicio de sesión exige el factor. La retirada manual por pérdida de factores sigue el [runbook](../runbooks/recuperacion-cuenta.md) y requiere prueba independiente.
- El navegador usa cookie de flujo `HttpOnly`, `Secure`, `SameSite=Strict` y CSRF ligado al flujo PKCE. Resend recibe únicamente el correo, nombre y PIN necesarios para el mensaje.
- La migración `005_password_reset.sql` guarda códigos como HMAC, aplica cinco intentos y retención máxima de quince minutos. No se registran correo, PIN ni cuerpo del mensaje.

## Consecuencias y riesgo aceptado

- Quien controle el buzón verificado puede cambiar la contraseña. Hoy el login de cuenta no tiene MFA; por ello las cuentas no deben habilitarse públicamente hasta implementar los factores y validar MFA en el login. El PIN no se presenta como segundo factor.
- Un reset exitoso desconecta todos los dispositivos. El usuario debe volver a iniciar sesión.
- Un error de entrega no confirma al solicitante si la cuenta existe; el procedimiento de operación debe revisar Resend sin exponer PINs.
- La API y el flujo web están probados localmente y con PostgreSQL en CI; dominio/remitente Resend y despliegue de VPS siguen pendientes.

## Evidencia

- [Contrato OpenAPI](../../server/openapi.yaml)
- [Servicio y guía de operación](../../server/README.md)
- [UC-25: restablecer contraseña](../use-cases/sincronizacion-preferencias.md)
- [ADR-0027: PIN de verificación](0027-registro-y-verificacion-de-correo.md)
- [ADR-0028: login PKCE](0028-login-nativo-pkce.md)
