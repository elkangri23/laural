# ADR-0009: Perfiles y política en JSON local

- Estado: Aceptada
- Fecha: 2026-11-19
- Decisores: Laural contributors

## Contexto

El MVP necesita conservar perfiles de proveedor y política de ejecución sin cuenta ni base de datos. El esquema debe poder inspeccionarse y migrarse cuando crezca la aplicación.

## Decisión

Guardar `providers.json` y `agent.json` en el directorio de configuración de Laural; mantener credenciales en el almacén de Windows. Al migrar desde una versión previa, leer `provider.json` y conservar el perfil en el formato de lista.

## Alternativas consideradas

- SQLite: transacciones y consultas ayudan con muchos datos, pero añade complejidad antes de guardar conversaciones.
- Solo estado en memoria: elimina migración, pero pierde perfiles entre sesiones.

## Consecuencias

- Las escrituras deben ser atómicas y los esquemas deben llevar una versión antes de añadir migraciones complejas.
- La configuración no contiene secretos, pero puede incluir URLs o nombres de modelo que el usuario considere privados.
- Si se añade historial de chats, debe revisarse si conviene separar ese almacenamiento del archivo de perfiles.
