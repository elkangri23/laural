# ADR-0039: Cola transaccional de avisos de seguridad

- **Estado:** Aceptada; implementación local, entrega Resend real y despliegue pendientes
- **Fecha:** 2026-11-22
- **Decisores:** Antonio Moles

## Contexto

El plan de cuentas exige avisar por correo cuando se activa o desactiva TOTP o se rotan los códigos de recuperación. Enviar correo dentro de la transacción puede mantener bloqueos mientras Resend responde; enviarlo después de confirmar el cambio puede perder el aviso si el proceso se detiene.

## Decisión

- Registrar el aviso en `account_security_email_outbox` dentro de la misma transacción PostgreSQL que confirma el cambio del factor.
- Un trabajador reclama filas con `FOR UPDATE SKIP LOCKED`, libera la transacción antes de llamar a Resend y usa el ID del evento como clave de idempotencia.
- Reintentar errores con espera exponencial desde 30 segundos hasta seis horas, hasta ocho intentos; después marcar el evento como abandonado sin guardar detalles del proveedor.
- Avisar solo de activación de TOTP, rotación confirmada de códigos y desactivación de TOTP. El correo describe el cambio y recomienda proteger la cuenta si no fue solicitado; no incluye códigos, IP, ubicación, sesión ni datos del dispositivo.
- Mantener el envío en el servidor y deshabilitar el procesamiento de correo cuando la autenticación por email esté desactivada.

## Alternativas consideradas

- Enviar sincrónicamente después del commit: más sencillo, pero una caída entre commit y llamada pierde el aviso.
- Enviar dentro de la transacción: evita la brecha de persistencia, pero acopla la disponibilidad de Resend al cambio de seguridad y mantiene bloqueos de BD durante la red.
- Incorporar una cola externa: aumenta requisitos de despliegue y operación para el volumen actual.

## Consecuencias

- PostgreSQL conserva los avisos pendientes y un bloqueo concurrente evita que varias instancias reclamen la misma fila; Resend recibe un identificador idempotente ante un reinicio entre envío y confirmación.
- El correo se puede retrasar; cada evento se abandona tras ocho fallos y requiere monitorización operativa para detectar la cola. No se almacena el mensaje del error para evitar filtrar direcciones, respuesta de proveedor o secretos.
- Añade una migración y datos personales mínimos: correo verificado al momento del cambio. El borrado de la cuenta elimina los eventos aún retenidos mediante la FK.
- La implementación requiere validar entrega real con Resend, dominio/remitente verificado, retención y alertas antes de habilitar cuentas públicamente.

## Evidencia / enlaces

- [ADR de TOTP](0038-fundamentos-de-mfa-totp.md)
- [Modelo de amenazas](../security/threat-model.md)
- [Servicio de sincronización](../../server/README.md)
