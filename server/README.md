# Servicio de sincronización de Laural

Backend TypeScript con Fastify y PostgreSQL para snapshots permitidos de preferencias. Esta fase implementa la API privada de lectura/escritura, registro/verificación inicial por correo, migraciones, autorización por sesión existente y control de revisión. **No incluye inicio de sesión ni emisión de sesiones, recuperación, Google, passkeys, TOTP, estado público ni el cliente de sincronización; no debe publicarse en Internet ni anunciarse como servicio operativo.**

## Requisitos

- Node.js 22.13 o posterior.
- PostgreSQL 13 o posterior.
- Para habilitar temporalmente registro/verificación: cuenta Resend con remitente verificado y un secreto aleatorio `AUTH_PIN_PEPPER` de al menos 32 bytes.
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

Para generar un pepper de prueba desde PowerShell: `[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`. Guarda el resultado solo en el entorno de secretos del servicio. No habilites `EMAIL_AUTH_ENABLED` hasta tener límites por origen de red y el remitente Resend verificado.

En desarrollo se puede usar `npm run dev`; las tablas deben existir antes de arrancar. `GET /health/live` comprueba que el proceso responde y `GET /health/ready` realiza una consulta de disponibilidad a PostgreSQL. Las respuestas de salud no filtran errores internos.

## API disponible en esta fase

- `GET /v1/preferences/current`: devuelve snapshot y revisión (`ETag`); cuenta sin snapshot recibe `snapshot: null`, revisión `0`.
- `PUT /v1/preferences/current`: requiere `Authorization: Bearer …`, `If-Match: "<revisión>"` e `Idempotency-Key`. Responde `412` si hay una revisión distinta y `409` si se reutiliza una clave idempotente con otro contenido.
- El body usa el schema canónico [snapshot v1](../shared/preference-snapshot-v1.schema.json), está limitado a 256 KiB y rechaza claves y propiedades desconocidas.
- Los endpoints personalizados remotos deben usar HTTPS; HTTP solo se admite para loopback. No se permiten credenciales, query string ni fragmento en la URL.

El registro está desactivado por defecto. Para activarlo en un entorno de pruebas, define `EMAIL_AUTH_ENABLED=true`, `RESEND_API_KEY`, `RESEND_FROM` y `AUTH_PIN_PEPPER` en el entorno privado del proceso. Nunca subas esas variables. Los passwords se derivan con Argon2id. Los PIN de verificación son aleatorios, se guardan como HMAC con una clave del servidor, caducan a los cinco minutos, tienen cinco intentos y se limitan por cuenta a un envío por minuto y tres en quince minutos. Reenviar y confirmar devuelven respuestas genéricas; confirmar el correo no crea sesión. El correo dice expresamente que el PIN no permite iniciar sesión ni retirar MFA. Resend solo recibe el correo y el mensaje de verificación necesario.

Las rutas de registro no deben exponerse públicamente todavía: falta limitación persistente por origen de red, controles de abuso distribuidos, el inicio de sesión por navegador/código loopback y pruebas con PostgreSQL real. La sesión sigue siendo un secreto opaco aleatorio de 32 bytes codificado en base64url; el servicio calcula SHA-256 y solo consulta su hash en la base de datos. No se registran cabeceras ni se habilitan logs de petición.

Consulta el contrato en [OpenAPI](openapi.yaml), el [diseño aprobado](../docs/designs/sincronizacion-preferencias-y-portabilidad.md) y el [plan por fases](../docs/plans/sincronizacion-preferencias.md).

## Límites pendientes antes de producción

Faltan autenticación de usuario y emisión de sesiones, límites por cuenta/IP, limpieza de claves idempotentes antiguas, integración de migración/pruebas con PostgreSQL real, despliegue TLS, monitoreo, proceso de incidentes, status público, proveedor Resend y revisión de seguridad de lanzamiento. Los snapshots no están cifrados de extremo a extremo: el operador del VPS puede leer las preferencias permitidas.
