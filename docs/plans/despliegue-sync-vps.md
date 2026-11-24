# Despliegue del servicio de sincronización en el VPS

- **Estado:** DESPLEGADO el 2026-11-24 en el VPS y verificado en vivo
  en `https://sync.laurafernandezenfermeria.com` (commit
  `f74dff8`, que incluye el ajuste de `TRUST_PROXY` y los ficheros
  de despliegue). Decisiones aprobadas el 2026-11-23 por Antonio Moles.
- **Servicio:** backend TypeScript + Fastify + PostgreSQL en `server/`,
  en `https://sync.laurafernandezenfermeria.com`.
- **Alcance:** solo sincronización opcional de preferencias y perfiles
  de proveedor. Las actualizaciones de la app **no** pasan por este
  servicio: van por GitHub Releases, vía `updates/latest.json`
  (Tauri updater).
- **Documentación relacionada:** [servicio de sincronización](../../server/README.md),
  [plan de sincronización](sincronizacion-preferencias.md),
  [diseño aprobado](../designs/sincronizacion-preferencias-y-portabilidad.md),
  [runbook de recuperación](../runbooks/recuperacion-cuenta.md).

## Decisiones aprobadas (2026-11-23)

### 1. Forma de despliegue: Docker Compose

El servicio se despliega con Docker Compose, como el resto del VPS
(retaton y Meridiano-cero).

Consecuencia: el `Dockerfile` y el `compose.yaml` del servicio están
en `server/` (creados en el despliegue del 2026-11-24).

### 2. Proxy: nginx existente

El proxy en producción es el nginx que ya sirve los otros subdominios
del VPS, no Caddy.

Consecuencia: hay que traducir `server/deploy/Caddyfile` a nginx:
proxy a Fastify en `127.0.0.1:18080` y `/status` (más `/status.json`,
`/status.css` y `/status.js`) servido como estático aparte, fuera del
proceso API, para que siga disponible si cae la API o PostgreSQL.
El Caddyfile queda como referencia de ese comportamiento, no como
proxy en producción en este VPS. Dos proxies no pueden escuchar a la
vez en 80/443.

En el despliegue (2026-11-24) el puerto es el 18080, no el 8080:
el 8080 de loopback ya lo usa retaton/Reverb. TLS con el certificado
comodín Sectigo `*.laurafernandezenfermeria.com`, el mismo que el
resto de subdominios (válido hasta 2027-04-30). La configuración
está en `server/deploy/nginx-sync.laurafernandezenfermeria.com.conf`.

### 3. PostgreSQL: dedicado + copia local nocturna

PostgreSQL dedicado para Laural, en su propio contenedor dentro del
mismo Compose. Las 14 migraciones de `server/migrations/` (001–014)
son solo suyas y no tocan a retaton ni a Meridiano-cero.

Además, copia local nocturna (`pg_dump`) guardada en el propio VPS:
cron del host a las 04:00 (`docker-compose -f server/compose.yaml
run --rm backup`), retención de 7 días.

Aclaración: esa copia **no** es copia de desastre y **no** protege
ante la pérdida total del VPS. Se mantiene la decisión aprobada de
no enviar copias fuera del VPS. La copia local solo ayuda ante un
borrado accidental o una migración mala.

### 4. Registro: abierto al público desde el principio

Cualquier persona podrá crear cuenta en cuanto el servicio esté en
`sync.laurafernandezenfermeria.com`.

Consecuencia: al ser público desde el primer día, las validaciones
pendientes (ver «Antes de abrir el registro») deben completarse
**antes** de abrirlo, no después.

### 5. Autenticación: email + TOTP ahora, Google/passkeys después

Se lanza con email + contraseña + TOTP, que es lo que está
implementado. Google y passkeys se añaden después.

Desviación del diseño aprobado: el diseño exigía los cuatro métodos
(email, Google, passkeys y TOTP) en la primera versión y rechazaba
hacerlo por fases. Esta decisión lo cambia: se lanza por fases y el
diseño debe actualizarse en consecuencia.

Nota (2026-11-24): el código de Google, passkeys y recuperación
administrativa ya existe en `server/` (migraciones 008–014), pero
sigue apagado por flags al abrir, según esta decisión y la 7.

### 6. Correo: `noreply@laurafernandezenfermeria.com` (Resend)

Remitente para verificación de cuenta, PIN de restablecimiento y
avisos de seguridad: `noreply@laurafernandezenfermeria.com`,
reutilizando el dominio principal, ya verificado en Resend.

La API key de Resend va solo como secreto del VPS, nunca en Git ni
en la app de escritorio.

### 7. Recuperación de cuenta: sin mecanismo administrativo al abrir

Al abrir no habrá mecanismo administrativo para retirar factores.
Si una persona pierde el TOTP y los códigos de recuperación, pierde
la cuenta y tiene que crear otra.

No se manipulan filas a mano ni se promete recuperación. El runbook
de recuperación queda pendiente de implementar el mecanismo, pero
no bloquea la apertura. Hay que avisar de esto antes de habilitar
sync y de activar TOTP.

## Despliegue realizado (2026-11-24)

- Repo en el VPS: `/opt/laural` (rama `main`, commit `f74dff8`).
- DNS: registro A `sync` → `51.75.143.107` creado en IONOS (TTL 3600).
- `server/Dockerfile` y `server/compose.yaml` (API + PostgreSQL 17
  dedicado), secretos solo en `server/.env` del VPS (permiso 600).
- `server/.env.example` con los nombres de variables y placeholders.
- nginx: `server/deploy/nginx-sync.laurafernandezenfermeria.com.conf`
  instalado en `sites-available`/`sites-enabled`, TLS Sectigo.
- `TRUST_PROXY` configurable (`server/src/config.ts`): la API confía
  en `172.16.0.0/12` para `X-Forwarded-For`, de modo que el rate
  limit distingue la IP real de cada cliente detrás de nginx + Docker.
- Copia local nocturna: cron del host a las 04:00, retención 7 días.
- `/status` y `/status.json` publicados (`state: operational`).

Verificación en vivo el 2026-11-24:

- Tests de `server/tests/config.test.ts`: 16 pasados (incluidos los
  nuevos casos de `TRUST_PROXY`).
- Migraciones aplicadas: 27 tablas en PostgreSQL.
- `GET /health/live` y `/health/ready`: 200.
- `GET /v1/preferences/current` sin auth: 401; `POST /v1/auth/register`
  vacío: 400.
- Rate limit: 31 peticiones directas desde el host a
  `/v1/auth/passkeys/status` dieron 30× 401 y 1× 429 (límite 30/60 s);
  la siguiente petición por nginx desde otra IP dio 401, no 429:
  cada cliente tiene su propio cubo, `TRUST_PROXY` funciona.
- `GET /status` y `/status.json`: 200 por HTTPS.

## Cambios tras el despliegue (2026-11-24)

- La raíz `/` redirige a `/status` (commit `33a574d`): la API no
  tiene ruta raíz y devolvía 404.
- El CSP de `/status` necesitaba `connect-src 'self'` porque
  `status.js` hace `fetch("/status.json")` desde el navegador; sin
  él la página se quedaba en «Estado sin confirmar» (commit
  `76ffed9`, también en el Caddyfile de referencia).
- Página de acceso `/auth/native` en acordeón (commits `0b64c82` y
  `a700aca`): cada paso es una sección numerada y solo se ve una
  abierta a la vez (entrar, crear cuenta, verificar PIN,
  restablecer contraseña); tras cada envío el servidor reabre la
  sección que toca (crear cuenta → verificar PIN). Sin JavaScript,
  por la CSP. Verificado en navegador el 2026-11-24.
- Páginas de acceso separadas (commits `3b91f6f`, `3932265`,
  `821e568` y `3be1cf7`, desplegado 2026-11-24, verificado en vivo):
  el acordeón se sustituye por una página por paso — iniciar sesión
  (`/auth/native/login`), crear cuenta (`/auth/native/register`),
  verificar correo (`/auth/native/verification`) y restablecer
  contraseña (`/auth/native/password-reset`) —, cada una con su
  formulario y enlaces entre ellas; los POST re-renderizan la página
  que toca (registro → verificación; verificación y restablecer →
  inicio de sesión). La recuperación tiene página propia
  (`/auth/native/recovery`) pero apagada: la ruta no existe (404)
  mientras el flag esté desactivado. El CSRF viaja en la URL de los
  enlaces porque el servidor solo guarda su resumen (sha256); es de
  un solo flujo, caduca a los 10 minutos y no sirve sin la cookie
  HttpOnly del flujo.

## Pendiente tras el despliegue

- Primer registro real de una cuenta (idealmente la de Antonio):
  es lo que demostrará la entrega real de correo con Resend de
  extremo a extremo (PIN de verificación). La clave de Resend es la
  misma que ya usa retaton en producción.
- Ensayar la restauración desde la copia nocturna (`pg_dump`) en una
  base de pruebas, sin tocar producción.
- Ensayar el flujo completo contra el VPS: registro, verificación,
  login PKCE, snapshot, conflicto, revocación de sesiones y borrado
  de cuenta.
- Monitorización e incidentes para el servicio y `/status`.
- Avisar del riesgo de pérdida total del VPS y de la ausencia de
  cifrado de extremo a extremo antes de habilitar sync, y de que sin
  recuperación administrativa perder TOTP y códigos es perder la
  cuenta (punto 7).
