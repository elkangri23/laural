# Runbooks operativos

Procedimientos manuales para operar el servicio de sincronización y responder a incidencias. Deben revisarse y ensayarse antes de habilitar cuentas para usuarios externos.

| Procedimiento | Propósito | Estado |
| --- | --- | --- |
| [Respuesta a incidentes](respuesta-incidentes.md) | Contener compromisos, caídas, exposición de secretos y pérdida/divergencia de snapshots | Borrador; completar datos del VPS y ensayar antes de habilitar cuentas externas |
| [Recuperación de cuenta](recuperacion-cuenta.md) | Revisar solicitudes y permitir reenrolar un factor sin conceder sesión | Flujo local implementado detrás de flags; Resend y ensayo VPS pendientes |
| [Habilitar Google OAuth](google-oauth.md) | Configurar el cliente OAuth del servicio, comprobar el callback y revertir el flag | Preparación lista; requiere credenciales, despliegue y ensayo real |
