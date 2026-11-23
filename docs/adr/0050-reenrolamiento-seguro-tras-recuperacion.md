# ADR-0050: Reenrolamiento seguro tras recuperación

- Estado: aceptada; flujo implementado localmente; despliegue y ensayo en VPS pendientes.
- Fecha: 2026-11-23

## Contexto

La CLI de revisión administrativa registra aprobaciones con evidencia independiente, pero no debe conceder una sesión ni quitar factores por sí sola. Se necesita completar el acceso sin crear un bypass por correo: la persona debe demostrar que controla un TOTP nuevo antes de retirar los factores perdidos y las sesiones existentes.

## Decisión

- Una aprobación CLI crea en una transacción un ticket aleatorio válido 30 minutos. PostgreSQL conserva su SHA-256; el outbox solo guarda temporalmente el ticket cifrado AES-256-GCM con una clave derivada por HMAC de `AUTH_RECOVERY_PEPPER`.
- El trabajador Resend entrega un enlace cuya credencial va en el fragmento URL, nunca en la petición HTTP inicial. El cliente borra el fragmento inmediatamente y canjea el ticket una vez. Respuestas no almacenables, CSP estricta, Referrer-Policy `no-referrer`, rate limits, cookie `HttpOnly`, `Secure`, `SameSite=Strict` y CSRF ligado al flujo limitan exposición/replay.
- Canjear el enlace crea un enrolamiento TOTP temporal de 15 minutos con máximo cinco intentos. No autentica, no crea sesión ni permite acceder a preferencias.
- Solo al confirmar el TOTP nuevo una transacción reemplaza el TOTP y códigos de recuperación, elimina passkeys anteriores, revoca todas las sesiones, invalida flujos/códigos nativos pendientes, marca el caso completado y encola un aviso de seguridad. Se muestran diez códigos de recuperación una sola vez.
- Tras completar, la persona debe iniciar sesión con su contraseña y el TOTP nuevo. Si expira el enlace o el enrolamiento, se requiere otra solicitud y revisión administrativa; no existe reemisión automática.
- Los tickets cifrados se eliminan al entregar, consumir, vencer o abandonar el envío. Los registros terminales se purgan tras 30 días; los grants expirados/consumidos y enrolamientos siguen retención limitada.
- Las aprobaciones y flags de recuperación permanecen deshabilitados en producción hasta completar el runbook, revisar configuración HTTPS y ensayar flujo/email en VPS.

## Consecuencias y límites

- Una aprobación no puede ser usada para crear una sesión. El coste es que se requiere un nuevo login completo y se pierden todas las passkeys anteriores.
- Se requiere configurar `ACCOUNT_RECOVERY_BASE_URL` como HTTPS exacto terminado en `/auth/recovery`.
- El propietario del VPS puede acceder al pepper y a la base de datos; esta arquitectura reduce exposición accidental, pero no protege frente al compromiso total del servidor.
- Las pruebas simuladas no sustituyen verificar entrega Resend, proxy/CSP y cookies HTTPS en el VPS.

## Verificación

- La integración PostgreSQL prueba decisión, entrega idempotente, consumo de un solo uso, nuevo TOTP, regeneración de códigos, eliminación de passkeys, revocación de sesión y código de login pendientes, aviso de seguridad y ausencia de sesión nueva.
- Pruebas Fastify cubren página, cookie segura, validación de CSRF y respuesta de códigos de recuperación.

## Referencias

- [ADR-0048: solicitud segura de recuperación](0048-solicitud-segura-de-recuperacion.md)
- [ADR-0049: revisión administrativa](0049-revision-administrativa-local-de-recuperaciones.md)
- [Runbook de recuperación](../runbooks/recuperacion-cuenta.md)
