# Servicio de sincronización de Laural

Backend TypeScript con Fastify y PostgreSQL para snapshots permitidos de preferencias. Esta fase implementa la API privada de lectura/escritura, registro/verificación por correo, login web por contraseña con PKCE, migraciones, autorización por sesión y control de revisión. La integración de login nativo inicial ya está conectada en Tauri. Caddy sirve la página pública `/status` y un documento editable solo por SSH, fuera del proceso Fastify para que siga disponible si la API se cae. **No incluye login Google, passkeys, TOTP, recuperación, revocación de sesiones ni operación endurecida; no debe publicarse todavía en Internet.**

## Requisitos

- Node.js 22.13 o posterior.
- PostgreSQL 13 o posterior.
- Un secreto aleatorio `RATE_LIMIT_PEPPER` de al menos 32 bytes para derivar huellas HMAC de las IP; el servicio no guarda las direcciones en claro.
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

Para generar cada pepper desde PowerShell: `[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`. Guarda los resultados solo en el entorno de secretos del servicio; usa valores distintos para `RATE_LIMIT_PEPPER` y `AUTH_PIN_PEPPER`. No habilites `EMAIL_AUTH_ENABLED` hasta verificar los límites desde Caddy y el remitente Resend.

En desarrollo se puede usar `npm run dev`; las tablas deben existir antes de arrancar. `GET /health/live` comprueba que el proceso responde y `GET /health/ready` realiza una consulta de disponibilidad a PostgreSQL. Las respuestas de salud no filtran errores internos.

## API disponible en esta fase

- `GET /v1/preferences/current`: devuelve snapshot y revisión (`ETag`); cuenta sin snapshot recibe `snapshot: null`, revisión `0`.
- `PUT /v1/preferences/current`: requiere `Authorization: Bearer …`, `If-Match: "<revisión>"` e `Idempotency-Key`. Responde `412` si hay una revisión distinta y `409` si se reutiliza una clave idempotente con otro contenido.
- `GET /auth/native`: recibe redirect loopback, state y PKCE S256; crea cookie `HttpOnly`, `Secure`, `SameSite=Strict` y sirve el formulario de cuenta en español.
- `POST /auth/native/login`: comprueba contraseña y correo verificado. Un login válido consume el flujo y redirige solo a `http://127.0.0.1:<puerto>/callback` con state y código de un solo uso.
- `POST /v1/auth/native/exchange`: canjea código + `codeVerifier`; devuelve un token aleatorio de sesión de 30 días solo al cliente que presenta el verificador PKCE. En PostgreSQL se almacena únicamente el SHA-256 del token.
- La pantalla de navegador también permite registro, reenvío y verificación del PIN; el PIN nunca crea sesión.
- El body usa el schema canónico [snapshot v1](../shared/preference-snapshot-v1.schema.json), está limitado a 256 KiB y rechaza claves y propiedades desconocidas.
- Los endpoints personalizados remotos deben usar HTTPS; HTTP solo se admite para loopback. No se permiten credenciales, query string ni fragmento en la URL.

### Rutas públicas de Caddy

- `GET /status`: HTML en español, servido desde archivos estáticos.
- `GET /status.json`: documento público persistente, leído directamente desde disco por Caddy.
- `GET /status.css` y `GET /status.js`: recursos estáticos propios. El status se sirve antes del proxy API y sigue disponible si Fastify/PostgreSQL no responden.

El registro y login de navegador están desactivados por defecto. Para probarlos, define `EMAIL_AUTH_ENABLED=true`, `RESEND_API_KEY`, `RESEND_FROM` y `AUTH_PIN_PEPPER` en el entorno privado del proceso. Nunca subas esas variables. Los passwords se derivan con Argon2id. Los PIN de verificación son aleatorios, se guardan como HMAC con una clave del servidor, caducan a los cinco minutos, tienen cinco intentos y se limitan por cuenta a un envío por minuto y tres en quince minutos. Reenviar y confirmar devuelven respuestas genéricas; confirmar el correo no crea sesión. El correo dice expresamente que el PIN no permite iniciar sesión ni retirar MFA. Resend solo recibe el correo y el mensaje de verificación necesario.

Fastify aplica límites por IP y ruta a autenticación y snapshots. El contador vive en PostgreSQL y se actualiza de forma atómica para que varias instancias compartan el límite; la clave se calcula con HMAC y `RATE_LIMIT_PEPPER`, no se persiste la IP. El servicio solo confía en `X-Forwarded-For` desde loopback, que es donde Caddy conecta con Fastify. Al exceder el límite responde `429` con `Retry-After`; si PostgreSQL no permite comprobar el límite, la solicitud se rechaza. Los límites actuales son: 10 inicios de flujo o login por minuto, 3 registros/reenvíos cada 15 minutos, 10 verificaciones/canjes por minuto, 120 lecturas y 30 escrituras de snapshots por minuto. La migración `004_request_rate_limits.sql` debe aplicarse antes de arrancar esta versión.

Las rutas de cuenta no deben exponerse públicamente todavía: faltan revisar límites ante tráfico real, Google, passkeys, MFA, recuperación, revocación remota y pruebas con PostgreSQL real. El cliente Tauri ya abre el navegador, valida state, usa listener loopback, canjea por HTTPS y guarda el token en Credential Manager. Los flujos PKCE caducan en 10 minutos, los códigos en 2 minutos y las sesiones en 30 días. El código y la sesión son secretos aleatorios opacos; solo sus SHA-256 se almacenan en PostgreSQL. No se registran cabeceras ni se habilitan logs de petición.

### Status público servido por Caddy

`server/deploy/Caddyfile` sirve `/status`, `/status.css` y `/status.js` desde `server/dist/server/web` del release y `/status.json` desde `/var/lib/laural/status/status.json`; el resto se envía a Fastify. Así la página permanece disponible si falla el proceso API o PostgreSQL, mientras Caddy y el VPS sigan activos. La ruta de status no pasa por Fastify.

`server/web/status.json` es un ejemplo que empieza en estado `unknown`; no afirma que el servicio real esté disponible. En VPS, copia el ejemplo a `/var/lib/laural/status/status.json` fuera de las releases. Para cada aviso nuevo, escribe primero un archivo temporal, valida y después reemplaza con `mv` en el mismo filesystem. Usa `npm run status:validate -- /ruta/al/status.json` tras `npm run build`; el validador no imprime el contenido. Da al usuario de Caddy permiso de lectura y al administrador permiso de escritura; no hay endpoint web ni panel administrativo.

El schema cerrado limita el archivo a 16 KiB, el resumen a 240 caracteres y los avisos a ocho entradas; admite estado, clase, título, mensaje y fecha UTC. La página presenta avisos como texto, sin HTML. No publiques nombres/correos de usuarios, logs, IP, URLs privadas, detalles de vulnerabilidades, claves ni tokens. La página comparte el VPS: una caída completa del host o de Caddy también la deja inaccesible. Antes de habilitar cuentas siguen siendo obligatorios TLS, límites de abuso, PostgreSQL real, entrega Resend real y revisión de despliegue.

Consulta el contrato en [OpenAPI](openapi.yaml), el [diseño aprobado](../docs/designs/sincronizacion-preferencias-y-portabilidad.md) y el [plan por fases](../docs/plans/sincronizacion-preferencias.md).

## Límites pendientes antes de producción

Faltan validación de límites con PostgreSQL/Caddy reales, limpieza periódica de claves idempotentes, integración de migraciones/pruebas con PostgreSQL real, despliegue TLS, monitoreo, proceso de incidentes, proveedor Resend, revocación/recuperación de cuenta y revisión de seguridad de lanzamiento. La página pública de status está en el código pero aún no se ha desplegado. Los snapshots no están cifrados de extremo a extremo: el operador del VPS puede leer las preferencias permitidas.
