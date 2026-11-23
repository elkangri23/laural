# Servicio de sincronización de Laural

Backend TypeScript con Fastify y PostgreSQL para snapshots permitidos de preferencias. Incluye API privada, registro/verificación por correo, login web por contraseña y passkey con PKCE, TOTP, códigos de recuperación, avisos de seguridad, revocación de sesiones, migraciones, autorización por sesión y control de revisión. La app permite consultar las 100 sesiones activas más recientes, revocar una sesión ajena o revocarlas todas sin cerrar la actual. La integración nativa usa HTTPS y Credential Manager. Caddy sirve la página pública `/status` y un documento editable solo por SSH, fuera del proceso Fastify para que siga disponible si la API se cae. **Google, avisos de passkey, recuperación administrativa y despliegue endurecido siguen pendientes; no publicar todavía en Internet.**

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

Para probar las migraciones y concurrencia del rate limit contra una base PostgreSQL real, usa una base local de pruebas vacía y ejecuta en PowerShell:

```powershell
$env:TEST_DATABASE_URL = "postgres://laural:contraseña-de-pruebas@127.0.0.1:5432/laural_test"
npm run test:postgres
Remove-Item Env:TEST_DATABASE_URL
```

La prueba crea un schema con nombre aleatorio, aplica las ocho migraciones y lo elimina al terminar; no modifica las tablas de la base fuera de ese schema. `npm run test:postgres` falla si no se define la URL. La cobertura normal omite esta prueba cuando `TEST_DATABASE_URL` no está configurada; CI la ejecuta con un PostgreSQL de servicio temporal.

Para generar un pepper desde PowerShell: `[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`. Para `TOTP_ENCRYPTION_KEY`, genera 32 bytes aleatorios y codifícalos como base64url sin relleno: `[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).TrimEnd('=').Replace('+','-').Replace('/','_')`. Guarda los resultados solo en el entorno de secretos del servicio; usa valores distintos para `RATE_LIMIT_PEPPER`, `AUTH_PIN_PEPPER` y `AUTH_RECOVERY_PEPPER`. Nunca pongas la clave TOTP en el repositorio.

En desarrollo se puede usar `npm run dev`; las tablas deben existir antes de arrancar. `GET /health/live` comprueba que el proceso responde y `GET /health/ready` realiza una consulta de disponibilidad a PostgreSQL. Las respuestas de salud no filtran errores internos.

## API disponible en esta fase

- `GET /v1/preferences/current`: devuelve snapshot y revisión (`ETag`); cuenta sin snapshot recibe `snapshot: null`, revisión `0`.
- `PUT /v1/preferences/current`: requiere `Authorization: Bearer …`, `If-Match: "<revisión>"` e `Idempotency-Key`. Responde `412` si hay una revisión distinta y `409` si se reutiliza una clave idempotente con otro contenido.
- `GET /auth/native`: recibe redirect loopback, state y PKCE S256; crea cookie `HttpOnly`, `Secure`, `SameSite=Strict` y sirve el formulario de cuenta en español.
- `POST /auth/native/login`: comprueba contraseña y correo verificado. Un login válido consume el flujo y redirige solo a `http://127.0.0.1:<puerto>/callback` con state y código de un solo uso.
- `POST /auth/native/passkey/options` y `/auth/native/passkey/verify`: crean y validan un reto WebAuthn ligado al flujo, con user verification y RP/origen exactos. El login es passwordless; cuando TOTP está activo se exige después.
- `GET /v1/auth/passkeys/status`: indica autenticadamente si el servicio tiene passkeys habilitadas.
- `POST /v1/auth/passkeys/manage-link`: requiere sesión emitida en los últimos diez minutos y devuelve un enlace de dos minutos con ticket en fragmento URL.
- `POST /auth/passkeys/manage/redeem` canjea ese ticket una sola vez por cookies web de gestión de cinco minutos. La página permite añadir y revocar hasta diez passkeys con CSRF y verificación de usuario.
- `POST /v1/auth/native/exchange`: canjea código + `codeVerifier`; devuelve un token aleatorio de sesión de 30 días solo al cliente que presenta el verificador PKCE. En PostgreSQL se almacena únicamente el SHA-256 del token.
- `DELETE /v1/auth/account`: requiere bearer, sesión emitida hace menos de diez minutos y JSON exacto `{ "confirmation": "ELIMINAR" }`; borra la cuenta y sus datos asociados por FK cascade. Limitado a tres intentos por IP/ruta cada quince minutos.
- La pantalla de navegador también permite registro, reenvío/verificación y restablecimiento de contraseña por PIN; el PIN nunca crea sesión.
- El body usa el schema canónico [snapshot v1](../shared/preference-snapshot-v1.schema.json), está limitado a 256 KiB y rechaza claves y propiedades desconocidas.
- Los endpoints personalizados remotos deben usar HTTPS; HTTP solo se admite para loopback. No se permiten credenciales, query string ni fragmento en la URL.

### Rutas públicas de Caddy

- `GET /status`: HTML en español, servido desde archivos estáticos.
- `GET /status.json`: documento público persistente, leído directamente desde disco por Caddy.
- `GET /status.css` y `GET /status.js`: recursos estáticos propios. El status se sirve antes del proxy API y sigue disponible si Fastify/PostgreSQL no responden.

El registro y login de navegador están desactivados por defecto. Para probarlos, define `EMAIL_AUTH_ENABLED=true`, `RESEND_API_KEY`, `RESEND_FROM`, `AUTH_PIN_PEPPER`, `AUTH_RECOVERY_PEPPER` y `TOTP_ENCRYPTION_KEY` en el entorno privado del proceso. Para activar passkeys, configura además `PASSKEYS_ENABLED=true`, `PASSKEY_RP_NAME`, `PASSKEY_RP_ID` y `PASSKEY_ORIGIN` HTTPS con host coincidente. Usa peppers distintos de al menos 32 bytes y una clave AES aleatoria de 32 bytes codificada en base64url. Nunca subas esas variables. Las contraseñas se derivan con Argon2id. Los PIN se guardan como HMAC con separación por propósito; caducan a los cinco minutos, tienen cinco intentos y se limitan por cuenta a un envío por minuto y tres en quince minutos. El PIN de restablecimiento cambia la contraseña y revoca todas las sesiones, pero no inicia sesión ni altera MFA. Las respuestas no revelan si la cuenta existe y el correo avisa de estos límites. La ruta de restablecimiento aplica límites adicionales por IP y cuenta. TOTP cifra la semilla con AES-256-GCM ligado al ID de cuenta; muestra los códigos de recuperación una vez y guarda solo HMAC. El login acepta TOTP o consume un código de recuperación una sola vez; la gestión de factores requiere una sesión de menos de diez minutos. Activar, rotar o desactivar un factor revoca otras sesiones y encola un aviso sin códigos ni metadatos de dispositivo. Passkeys requieren verificación de usuario, credenciales discoverable y un RP/origen HTTPS exactos; si TOTP está habilitado, también se solicita tras la passkey. La gestión de passkeys requiere sesión reciente y ticket de un solo uso. El trabajador envía con Resend cada 15 segundos, limita el lote a 20, reintenta hasta ocho veces y retiene resultados terminales durante 30 días. Mantén los flags apagados en Internet hasta validar PostgreSQL, límites tras Caddy, entrega/monitorización de correo, avisos de passkey, Google y el VPS.

Fastify aplica límites por IP y ruta a autenticación y snapshots. El contador vive en PostgreSQL y se actualiza de forma atómica para que varias instancias compartan el límite; la clave se calcula con HMAC y `RATE_LIMIT_PEPPER`, no se persiste la IP. El servicio solo confía en `X-Forwarded-For` desde loopback, que es donde Caddy conecta con Fastify. Al exceder el límite responde `429` con `Retry-After`; si PostgreSQL no permite comprobar el límite, la solicitud se rechaza. Los límites incluyen 10 inicios de flujo o login por minuto, 3 registros/reenvíos/solicitudes de restablecimiento cada 15 minutos, 10 verificaciones/canjes por minuto, 10 confirmaciones de restablecimiento por minuto, 120 lecturas y 30 escrituras de snapshots por minuto. El proceso de migraciones aplica `004_request_rate_limits.sql`, `005_password_reset.sql` y `006_account_mfa.sql` en orden antes de arrancar esta versión.

Las rutas de cuenta no deben exponerse públicamente todavía: faltan revisar límites ante tráfico real, Google, passkeys y validar la IP tras Caddy y entrega/operación real de correo. CI aplica las siete migraciones y prueba rate limit, snapshots, login, MFA, outbox/reintentos, borrado en cascada, restablecimiento, revocación y retención con PostgreSQL temporal y correo simulado. Estas pruebas no sustituyen las comprobaciones de despliegue. El borrado definitivo exige que la sesión se haya emitido en los últimos diez minutos y la confirmación literal; si se pierde la respuesta de red, el resultado remoto puede ser ambiguo. Tauri elimina el token y el estado local de sync, pero mantiene preferencias, perfiles y claves del equipo; si una limpieza local falla, la interfaz permite reintentarla. El cliente abre el navegador, valida state, usa listener loopback y HTTPS, guarda el token en Credential Manager y al cerrar sesión intenta revocarlo; si la red falla elimina el token local y advierte que el servidor podría seguir aceptándolo. Los flujos PKCE caducan en 10 minutos, los códigos en 2 minutos y las sesiones en 30 días. El código y la sesión son secretos aleatorios opacos; solo sus SHA-256 se almacenan en PostgreSQL. No se registran cabeceras ni se habilitan logs de petición.

### Retención de registros temporales

El servicio limpia registros transitorios en una transacción al iniciar y cada hora: verificadores de PIN de más de 15 minutos, flows y códigos PKCE de más de 24 horas, sesiones vencidas o revocadas, claves de idempotencia de más de 30 días y avisos de seguridad entregados/abandonados de más de 30 días. Los avisos pendientes no se borran por antigüedad. Los contadores del rate limit se purgan de forma oportunista cada 512 solicitudes, en lotes de hasta 1.000 filas y con una limpieza simultánea como máximo por instancia; una acumulación mayor se drena progresivamente con el tráfico y se puede solapar entre instancias. El plazo de PIN conserva la ventana de límite por cuenta de 15 minutos; las idempotencias se retienen el tiempo máximo de vida de una sesión. La limpieza nunca elimina snapshots de preferencias ni cuentas. Si falla una pasada, se registra solo un mensaje genérico y se vuelve a intentar en la siguiente.

### Status público servido por Caddy

`server/deploy/Caddyfile` sirve `/status`, `/status.css` y `/status.js` desde `server/dist/server/web` del release y `/status.json` desde `/var/lib/laural/status/status.json`; el resto se envía a Fastify. Así la página permanece disponible si falla el proceso API o PostgreSQL, mientras Caddy y el VPS sigan activos. La ruta de status no pasa por Fastify.

`server/web/status.json` es un ejemplo que empieza en estado `unknown`; no afirma que el servicio real esté disponible. En VPS, copia el ejemplo a `/var/lib/laural/status/status.json` fuera de las releases. Para cada aviso nuevo, escribe primero un archivo temporal, valida y después reemplaza con `mv` en el mismo filesystem. Usa `npm run status:validate -- /ruta/al/status.json` tras `npm run build`; el validador no imprime el contenido. Da al usuario de Caddy permiso de lectura y al administrador permiso de escritura; no hay endpoint web ni panel administrativo.

El schema cerrado limita el archivo a 16 KiB, el resumen a 240 caracteres y los avisos a ocho entradas; admite estado, clase, título, mensaje y fecha UTC. La página presenta avisos como texto, sin HTML. No publiques nombres/correos de usuarios, logs, IP, URLs privadas, detalles de vulnerabilidades, claves ni tokens. La página comparte el VPS: una caída completa del host o de Caddy también la deja inaccesible. Antes de habilitar cuentas siguen siendo obligatorios TLS, validar rate limits detrás de Caddy, probar rutas de cuenta contra PostgreSQL, entrega Resend real y revisión de despliegue.

Consulta el contrato en [OpenAPI](openapi.yaml), el [diseño aprobado](../docs/designs/sincronizacion-preferencias-y-portabilidad.md) y el [plan por fases](../docs/plans/sincronizacion-preferencias.md).

## Límites pendientes antes de producción

Faltan validar límites detrás de Caddy en el VPS, desplegar TLS, monitorizar, acordar el proceso de incidentes, verificar Resend/remitente y alertas de cola, ensayar el borrado de cuenta y su limpieza local, implementar/ensayar la recuperación administrativa conforme al [runbook](../docs/runbooks/recuperacion-cuenta.md), habilitar Google/passkeys y completar la revisión de lanzamiento. La página pública de status está en el código pero aún no se ha desplegado. Los snapshots no están cifrados de extremo a extremo: el operador del VPS puede leer las preferencias permitidas.
