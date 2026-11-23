# ADR-0045: Historial recuperable de preferencias en nube

- Estado: Aceptada
- Fecha: 2026-11-23
- Decisores: Laural contributors

## Contexto

La sincronización guardaba únicamente el snapshot vigente. Un cambio erróneo propagado entre dispositivos no podía recuperarse desde la cuenta, aunque los cambios locales sí dejan una copia `.laural` antes de aplicar un snapshot remoto.

## Decisión

Cada escritura aceptada conserva transaccionalmente el snapshot vigente anterior en un historial asociado a la cuenta. No hay caducidad automática; el usuario puede paginar y eliminar versiones, y el borrado de cuenta elimina el historial por cascada. Restaurar obtiene la versión histórica y la escribe como una revisión actual nueva, condicionada por `If-Match` e idempotencia. La versión seleccionada permanece inmutable. La interfaz muestra fecha y revisión, sin diferencias campo por campo. Tras restaurar en nube, el cliente crea primero su copia local `.laural` antes de aplicar el snapshot. Las claves API siguen fuera del payload sincronizado.

## Alternativas consideradas

- Retención con vencimiento automático: descartada; no se debe retirar recuperación al usuario sin su acción.
- Mutar la revisión histórica seleccionada: descartada porque destruye la trazabilidad y hace ambiguos los reintentos.
- Restaurar sin control de concurrencia: descartada porque podría sobrescribir cambios de otro dispositivo.
- Copias de desastre externas al VPS: descartadas por decisión del propietario; el historial no protege ante pérdida total del VPS.

## Consecuencias

La tabla crece mientras la cuenta y las versiones no eliminadas existan. El dueño de la cuenta puede recuperar o borrar cada versión. El servicio limita páginas y solicitudes; las versiones no incluyen claves. Si la restauración remota termina y falla la aplicación local, la nueva revisión permanece en nube y la UI informa del error para permitir reaplicar la revisión.

## Evidencia / enlaces

- `server/migrations/010_preference_snapshot_history.sql`
- `server/src/postgres-store.ts`, `server/src/app.ts`, `server/openapi.yaml`
- `src-tauri/src/sync.rs`, `src/components/AccountSettings.tsx`
- [Diseño de sincronización](../designs/sincronizacion-preferencias-y-portabilidad.md)
