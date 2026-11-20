# ADR 0016: Retención opcional de copias del agente

- Estado: Aceptada
- Fecha: 2026-11-20

## Contexto

El agente conserva todas las versiones de los archivos que reemplaza. Eso evita pérdidas por retención involuntaria, pero el almacén puede crecer sin límite. La limpieza manual existe, pero no ayuda si el usuario olvida administrarla.

## Decisión

Añadir una preferencia local por archivo: sin límite (valor predeterminado para preservar el comportamiento y los datos existentes) o conservar 5, 10, 20, 50 o 100 copias recientes. Al terminar una escritura aprobada o restauración, Laural elimina solo las copias antiguas del archivo afectado y directorios ya vacíos. El borrado nunca es recursivo. Se conserva la limpieza manual existente.

## Consecuencias

- La retención automática es optativa y se guarda en agent.json, sin sincronización.
- Los ajustes antiguos sin backupRetention se leen como «sin límite».
- Una preferencia configurada puede borrar permanentemente versiones antiguas; la interfaz debe explicar el efecto antes de elegir el límite.
- El backend valida el límite y solo opera dentro de .laural-backups; errores de limpieza no convierten un guardado ya aplicado en error.
