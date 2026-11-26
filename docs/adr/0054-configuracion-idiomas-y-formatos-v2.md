# ADR-0054: idioma portable y snapshots de preferencias v2

- Estado: Aceptada; contrato y servicio v1/v2 implementados localmente, despliegue VPS y cliente pendientes
- Fecha: 2026-11-24
- Decisores: Antonio Moles

## Contexto

La app debe permitir escoger español o inglés y conservar la elección al exportar/importar o sincronizar. El snapshot v1 es estricto y no incluye idioma. Añadir un campo opcional dentro de v1 dejaría a clientes anteriores descartar el dato o rechazarlo; relajar los esquemas también abriría campos no permitidos.

## Decisión

- Crear snapshot v2 cerrado, idéntico a v1 salvo por `preferences.language`, limitado a `es` o `en`.
- Mantener lectura/validación estricta de v1 y v2; el servicio puede recibir y devolver ambos formatos durante la migración.
- No añadir claves API, credenciales, historial, terminal, rutas, permisos de agente ni preferencias locales de PSReadLine a v2.
- El idioma ausente en v1 se resuelve en el cliente: conservar un idioma local válido; si no existe, detectar el idioma del sistema una sola vez y usar español como alternativa.
- Desplegar el servicio v1/v2 antes de publicar un cliente que escriba v2. Un cliente antiguo que no entienda un snapshot v2 debe detenerse sin sobrescribirlo ni borrar su configuración local.
- Mantener en español los mensajes libres permitidos del backend; la UI traduce sus propios textos y códigos de error.

## Alternativas consideradas

- Añadir `language` como campo opcional a v1: rechazada porque el contrato cerrado y clientes anteriores no preservan campos desconocidos.
- Hacer obligatorio actualizar todos los clientes antes del servicio: rechazada porque impediría una transición gradual y podría dejar clientes antiguos sin sincronización.
- Guardar idioma fuera de snapshots: rechazada porque no cumpliría la portabilidad entre equipos.

## Consecuencias

- Servicio, contrato compartido y herramientas pueden evolucionar primero sin activar todavía escrituras v2 desde el cliente.
- El servicio acepta snapshots v1 y v2 localmente; no se debe publicar el cliente escritor v2 hasta desplegar este cambio en el VPS.
- Las exportaciones locales también se versionarán a v2 en la fase cliente y conservarán lectura v1; el fallback de idioma pertenece a la lógica del cliente, no al servicio.

## Evidencia / enlaces

- [Diseño de ajustes, idiomas y sugerencias](../designs/ajustes-idiomas-prediccion-terminal.md)
- [Plan de implementación](../plans/implementacion-ajustes-idiomas.md)
- [Caso de uso UC-31](../use-cases/configuracion-idiomas-y-terminal.md#uc-31--conservar-el-idioma-al-transferir-o-sincronizar-preferencias)
- [Contrato v1](../../shared/preference-snapshot-v1.schema.json) y [contrato v2](../../shared/preference-snapshot-v2.schema.json)
