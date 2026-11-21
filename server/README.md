# Servicio de sincronización de Laural

Backend TypeScript con Fastify y PostgreSQL para snapshots permitidos de preferencias. Esta fase implementa la API privada de lectura/escritura, migración inicial, autorización por sesión existente y control de revisión. **Todavía no incluye alta/inicio de sesión, recuperación, correo, Google, passkeys, TOTP, estado público ni el cliente de sincronización; no debe publicarse en Internet ni anunciarse como servicio operativo.**

## Requisitos

- Node.js 22.13 o posterior.
- PostgreSQL 13 o posterior.
- Una sesión existente en `account_sessions`, asociada a una cuenta verificada.
- TLS y límites de conexión en el proxy inverso antes de exponerlo.

## Desarrollo

```powershell
cd server
npm ci
Copy-Item .env.example .env
# Edita DATABASE_URL localmente; no guardes el archivo .env en Git.
npm run build
npm run migrate
npm test
npm run test:coverage
npm start
```

En desarrollo se puede usar `npm run dev`; las tablas deben existir antes de arrancar. `GET /health/live` comprueba que el proceso responde y `GET /health/ready` realiza una consulta de disponibilidad a PostgreSQL. Las respuestas de salud no filtran errores internos.

## API disponible en esta fase

- `GET /v1/preferences/current`: devuelve snapshot y revisión (`ETag`); cuenta sin snapshot recibe `snapshot: null`, revisión `0`.
- `PUT /v1/preferences/current`: requiere `Authorization: Bearer …`, `If-Match: "<revisión>"` e `Idempotency-Key`. Responde `412` si hay una revisión distinta y `409` si se reutiliza una clave idempotente con otro contenido.
- El body usa el schema canónico [snapshot v1](../shared/preference-snapshot-v1.schema.json), está limitado a 256 KiB y rechaza claves y propiedades desconocidas.
- Los endpoints personalizados remotos deben usar HTTPS; HTTP solo se admite para loopback. No se permiten credenciales, query string ni fragmento en la URL.

La sesión es un secreto opaco aleatorio de 32 bytes codificado en base64url. El servicio calcula SHA-256 y solo consulta su hash en la base de datos; no registra cabeceras ni habilita logs de petición. La creación, revocación y almacenamiento local de sesiones se implementarán en el siguiente tramo de F3.

Consulta el contrato en [OpenAPI](openapi.yaml), el [diseño aprobado](../docs/designs/sincronizacion-preferencias-y-portabilidad.md) y el [plan por fases](../docs/plans/sincronizacion-preferencias.md).

## Límites pendientes antes de producción

Faltan autenticación de usuario y emisión de sesiones, límites por cuenta/IP, limpieza de claves idempotentes antiguas, integración de migración/pruebas con PostgreSQL real, despliegue TLS, monitoreo, proceso de incidentes, status público, proveedor Resend y revisión de seguridad de lanzamiento. Los snapshots no están cifrados de extremo a extremo: el operador del VPS puede leer las preferencias permitidas.
