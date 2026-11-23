# ADR-0046: Estado público publicado por componente

- Estado: Aceptada
- Fecha: 2026-11-23
- Decisores: Laural contributors

## Contexto

La página pública mostraba un único estado agregado. Las personas no podían distinguir si el aviso afectaba a la API, sincronización o correo. La página y el archivo se sirven como assets estáticos desde el mismo VPS.

## Decisión

El documento público cerrado contendrá exactamente tres componentes fijos: `api`, `sync` y `email`. Cada componente publica un estado acotado y un resumen breve en el JSON editado por SSH. La interfaz muestra esos estados y declara que son información manual, no comprobaciones de disponibilidad en tiempo real. Se conservan la lectura estática por Caddy, el límite de tamaño, el validador, la actualización atómica por operador y el fallback `unknown`. No se añaden métricas, registros ni diagnósticos de infraestructura.

## Alternativas consideradas

- Consultas en vivo desde el navegador a API, PostgreSQL o Resend: descartadas; revelarían más infraestructura y acoplarían la página a esos servicios.
- Mantener solo estado agregado: descartado porque no diferencia problemas de sincronización, API y correo.
- Nuevo endpoint público dinámico: descartado; Caddy debe servir el estado aunque Fastify o PostgreSQL fallen.

## Consecuencias

La página permite comunicar el componente afectado sin afirmar disponibilidad automática. El operador debe actualizar los tres estados al publicar un cambio y validar el documento antes de sustituirlo. Las actualizaciones del archivo persistente que ya existía deben incluir los nuevos componentes; un documento incompatible debe mostrarse como desconocido. El despliegue en VPS sigue pendiente.

## Evidencia / enlaces

- `server/src/public-status.ts`
- `server/web/status.json`, `status.html`, `status.js` y `status.css`
- `server/tests/public-status.test.ts`, `server/tests/status-web.test.ts`
- [ADR-0032: página pública de estado](0032-pagina-publica-de-estado.md)
