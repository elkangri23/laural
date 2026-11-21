# ADR-0026: API inicial para snapshots de preferencias

- **Estado:** Aceptada
- **Fecha:** 2026-11-21
- **Decisores:** Antonio Moles

## Contexto

F2 ya define un snapshot allowlisted v1. F3 necesita persistirlo por cuenta sin abrir rutas antes de implementar el flujo de identidad. Las escrituras deben detectar carreras y permitir reintentos seguros.

## Decisión

- La API de preferencias usa `GET` y `PUT /v1/preferences/current`; todas las rutas de preferencias exigen una sesión opaca válida y una cuenta verificada.
- El `PUT` requiere `If-Match` con la revisión observada e `Idempotency-Key`; una revisión obsoleta devuelve `412`, y una misma clave con contenido distinto devuelve `409`.
- PostgreSQL serializa escrituras por cuenta dentro de una transacción y conserva la respuesta idempotente con la revisión que produjo.
- El body se valida con el schema JSON v1 compartido, propiedades cerradas, límite de 256 KiB y validación semántica de IDs/endpoints.
- Se desactivan logs de petición y se devuelven errores genéricos. Health readiness indica solo disponibilidad, nunca mensajes internos.

## Consecuencias

- El servicio puede probarse con cuentas/sesiones provisionadas, pero aún no puede crear usuarios ni emitir sesiones; no se debe exponer públicamente hasta completar esa fase.
- El snapshot se almacena como JSONB legible por el operador. No contiene claves API y no ofrece E2EE.
- Las rutas completas aún se prueban principalmente con almacenes simulados. CI aplica las cuatro migraciones en PostgreSQL temporal y comprueba allí el rate limit concurrente; faltan integración de la API de snapshots/cuenta con la base real del servicio y validación en VPS.
- Las claves idempotentes requieren política de retención y limpieza antes del uso público.

## Evidencia

- [Contrato OpenAPI](../../server/openapi.yaml)
- [Servicio de sincronización](../../server/README.md)
- [Diseño de sincronización](../designs/sincronizacion-preferencias-y-portabilidad.md)
