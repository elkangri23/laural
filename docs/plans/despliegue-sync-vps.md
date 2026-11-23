# Despliegue del servicio de sincronización en el VPS

- **Estado:** decisiones aprobadas el 2026-11-23 por Antonio Moles.
  El servicio **no está desplegado todavía**.
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

Consecuencia: hay que crear el `Dockerfile` y el `compose.yaml` del
servicio, que hoy no existen en el repo aunque el diseño los mencione
como pendientes de crear.

### 2. Proxy: nginx existente

El proxy en producción es el nginx que ya sirve los otros subdominios
del VPS, no Caddy.

Consecuencia: hay que traducir `server/deploy/Caddyfile` a nginx:
proxy a Fastify en `127.0.0.1:8080` y `/status` (más `/status.json`,
`/status.css` y `/status.js`) servido como estático aparte, fuera del
proceso API, para que siga disponible si cae la API o PostgreSQL.
El Caddyfile queda como referencia de ese comportamiento, no como
proxy en producción en este VPS. Dos proxies no pueden escuchar a la
vez en 80/443.

### 3. PostgreSQL: dedicado + copia local nocturna

PostgreSQL dedicado para Laural, en su propio contenedor dentro del
mismo Compose. Las 7 migraciones de `server/migrations/` son solo
suyas y no tocan a retaton ni a Meridiano-cero.

Además, copia local nocturna (`pg_dump`) guardada en el propio VPS.

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

## Qué falta para que sea montable

Esto no es todavía un manual de despliegue en producción. Falta:

- Crear `server/Dockerfile` y `server/compose.yaml` (API + PostgreSQL
  dedicado), con los secretos fuera del repositorio.
- Crear la configuración de nginx para `sync.laurafernandezenfermeria.com`
  según el punto 2, con TLS.
- Crear `server/.env.example` con los nombres de variables y
  placeholders vacíos (sin valores reales).
- Definir la copia local nocturna de PostgreSQL: ruta, retención y
  ensayo de restauración, dejando claro que no es copia de desastre.
- Verificar que el remitente de Resend entrega correo real desde el VPS.
- Validar los rate limits detrás de nginx y la IP real tras el proxy.
- Ensayar el flujo completo contra el VPS: registro, verificación,
  login PKCE, snapshot, conflicto, revocación de sesiones y borrado
  de cuenta.

## Antes de abrir el registro

Como el registro será público desde el principio (punto 4), antes de
abrirlo hay que haber completado: validación del proxy y la carga con
PostgreSQL en el VPS, entrega real de correo con Resend, rate limits
detrás de nginx, aviso de riesgo de pérdida total del VPS y de
ausencia de cifrado de extremo a extremo antes de habilitar sync,
y monitorización e incidentes para el servicio y `/status`.
