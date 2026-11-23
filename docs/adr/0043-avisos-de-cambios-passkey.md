# ADR-0043: Avisos de altas y bajas de passkeys

- Estado: aceptada; integración local, pendiente validar entrega Resend en VPS.
- Fecha: 2026-11-23.

## Contexto

Añadir o retirar una passkey cambia un factor de autenticación. La cuenta ya tiene una cola de avisos TOTP transaccional con reintentos acotados e idempotencia. Enviar directamente desde la petición dejaría una ventana entre confirmar el cambio y enviar el correo, y mantendría la solicitud abierta durante la llamada de red.

## Decisión

- Reutilizar `account_security_email_outbox` y su trabajador Resend; ampliar el conjunto de eventos con `passkey_added` y `passkey_removed` mediante la migración 009.
- Insertar el evento en la misma transacción PostgreSQL que registra o elimina la credencial. Si el evento no se puede encolar, revertir también el cambio de la passkey.
- Enviar solo el correo verificado de la cuenta. El mensaje confirma el alta o la baja y recomienda actuar si no se reconoce. No incluir nombre de passkey, identificador, transporte, tipo de dispositivo, IP, user agent, clave pública ni respuesta WebAuthn.
- Conservar los reintentos limitados, la clave idempotente de Resend y la retención existente de la cola.

## Consecuencias

- Una passkey no puede cambiar sin dejar un aviso durable para envío.
- Un fallo de Resend puede retrasar o agotar la entrega tras los intentos configurados; se necesita monitorización operativa antes de habilitar cuentas.
- Los avisos quedan implementados localmente y requieren probar la entrega real del remitente en Resend/VPS.

## Referencias

- [ADR-0039: outbox de avisos de seguridad](0039-outbox-de-avisos-de-seguridad.md)
- [ADR-0042: passkeys](0042-passkeys-para-cuentas.md)
- [Modelo de amenazas](../security/threat-model.md)
