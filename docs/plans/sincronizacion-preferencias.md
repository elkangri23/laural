# Especificación: perfiles, portabilidad y sincronización

- **Estado:** F1 implementado con validación de Credential Manager e instalación aún pendiente; F2 implementado; F3 cuenta/API local parcial y página pública estática con publicador SSH local implementados; F4 sync manual/automático e historial cloud recuperable implementados localmente. Pendientes: credenciales/ensayo VPS para Google OAuth y recuperación, entrega Resend real, instalación y validación VPS. El estado público es manual y no usa comprobaciones en vivo (ADR-0046).
- **Fecha:** 2026-11-21.
- **Alcance:** Windows primero; perfiles locales, exportar/importar y sincronización opcional de preferencias.
- **Diseño formal:** [sincronización de preferencias y portabilidad](../designs/sincronizacion-preferencias-y-portabilidad.md).
- **Decisiones:** [ADR-0020](../adr/0020-perfiles-y-sincronizacion-opcional.md), [ADR-0023](../adr/0023-servicio-de-sincronizacion.md), [ADR-0025](../adr/0025-correo-transaccional-con-resend.md), [ADR-0026](../adr/0026-api-inicial-de-snapshots.md) y [ADR-0027](../adr/0027-registro-y-verificacion-de-correo.md).

## Estado actual

La app ofrece exportar/importar `.laural` local, y el cliente sync manual/automático está integrado. La persona puede consultar, comparar sin detalle de diferencias, elegir equipo/nube o subir el primer snapshot. Tras acordar la línea base, Laural intenta sincronizar al cambiar preferencias/perfiles, al abrir/iniciar sesión y cada tres horas. Mantiene en disco snapshots allowlist local/nube, revisión y marca pendiente; esta separación evita que la falta de consentimiento local para compartir un endpoint aceptado desde la nube lo borre ante otro cambio normal. Sin conexión conserva cambios locales y reintenta; si la nube avanzó, no sobreescribe y solicita elección. Rust usa la sesión en Credential Manager y crea una copia local sin claves antes de aplicar nube. El token no llega al WebView. El servicio no está publicado; validación VPS pendiente. Al cerrar sesión, el cliente revoca la sesión actual si puede contactar con el servicio y borra siempre el token local.

La API conserva versiones anteriores de preferencias sin caducidad automática, paginadas y borrables. Restaurar crea una revisión nueva protegida por concurrencia; el cliente crea una copia local `.laural` antes de aplicarla. La migración 010 y los nueve casos de integración se validaron en PostgreSQL 16 aislado; falta el ensayo en VPS. Este historial no sustituye copias de desastre fuera del VPS, que no se configurarán.

## Decisiones funcionales aprobadas

- La app debe seguir funcionando sin cuenta ni red. Exportar/importar será independiente del servicio.
- La sincronización de cuenta será opcional y solo cubrirá tema/apariencia, preferencia de actualización, tipo/nombre/modelo del proveedor, perfil activo y endpoint personalizado cuando se autorice para ese perfil.
- Nunca se sincronizan claves API, contraseñas, OAuth/session tokens, passkeys, factores MFA, conversaciones, comandos o salida de terminal, proyectos/rutas, actividad del agente ni políticas de ejecución.
- El perfil local predeterminado se llama **Usuario desconocido**; no representa una identidad autenticada.
- Exportar puede incluir claves solo tras selección explícita y contraseña obligatoria. La transferencia con claves usa Argon2id y AES-256-GCM con parámetros acotados; no existe exportación de claves en claro. Importar escribe directamente en Credential Manager y falla sin aplicar parcialmente la operación.
- El servicio oficial se ejecutará en el VPS del proyecto, con TypeScript, Fastify y PostgreSQL, en `https://sync.laurafernandezenfermeria.com`. No habrá E2EE en la primera versión; el operador podrá leer los campos permitidos.
- El correo transaccional lo enviará Resend desde el backend. Su API key será un secreto/variable del VPS y nunca estará en Git, la app de escritorio ni el instalador. Aún faltan dominio y remitente verificados.
- El cliente sincroniza los cambios guardados automáticamente, revisa la nube cada 3 horas mientras Laural está abierta y ofrece **Sincronizar ahora**. Al abrir o reanudar comprueba cambios pendientes.
- Primera carga, reemplazo o conflicto requieren elección explícita. No hay diferencias por campo, fusión por campo ni «última escritura gana» silenciosa. Antes de aplicar nube se crea una copia recuperable local. El historial cloud se implementa con retención indefinida hasta borrado explícito, consulta paginada, restauración como nueva revisión y eliminación por el usuario; eliminar la cuenta borra las versiones cloud en cascada. ADR-0045.
- El servicio ofrecerá email/contraseña, Google, passkeys y TOTP. La autenticación usa navegador externo y retorno local de un solo uso; las credenciales de sesión se guardan en Credential Manager.
- El PIN de correo tiene 6 dígitos, un uso y 5 minutos de vigencia. Según su propósito, verifica el correo o permite cambiar la contraseña; nunca inicia sesión ni quita MFA. El cambio de contraseña revoca sesiones.
- Si se pierden todos los factores, el administrador revisa pruebas independientes y decide manualmente. La retirada revoca sesiones, notifica al usuario y deja un registro mínimo; no hay endpoint público de borrado de factores.
- La página pública sin autenticación estará en `https://sync.laurafernandezenfermeria.com/status`. El proxy del mismo VPS sirve el contenido estático fuera del proceso API. Puede informar de una caída de la API o la base de datos, pero no de una caída total del VPS/red.

## Datos incluidos y excluidos

| Dato | Local | Exportación/importación | Nube |
| --- | --- | --- | --- |
| Apariencia, tema y actualización | Sí | Sí | Sí |
| Proveedor: tipo, nombre, modelo y perfil activo | Sí | Sí | Sí |
| Endpoint personalizado | Sí | Sí | Solo con consentimiento por perfil |
| Claves API | Credential Manager | Opcional, cifradas con contraseña | Nunca |
| Credenciales de cuenta, passkeys y MFA | Almacén apropiado | Nunca | No forman parte del snapshot |
| Agente, chat, historial/comandos, proyecto, rutas y actividad | Local donde exista | Excluido | Excluido |

## Flujos y criterios de aceptación

1. **Transferencia sin cuenta:** exportar/importar funciona sin servicio. La app valida el archivo y muestra una vista previa antes de aplicar cambios.
2. **Exportación con claves:** requiere consentimiento y contraseña; el archivo alterado, corrupto, excesivo o con contraseña incorrecta no modifica la configuración.
3. **Primer acceso a la nube:** si no hay snapshot, Laural pregunta antes de la primera carga. Si hay dos snapshots diferentes, ofrece conservar el local o el de nube y advierte cuál será reemplazado.
4. **Cambios en línea y fuera de línea:** tras acordar líneas base local/nube, cambios guardados intentan sincronizar. Un error de red conserva una marca pendiente local y se reintenta al abrir y cada tres horas; una revisión remota avanzada detiene la escritura y muestra elección. Un endpoint aceptado desde nube se conserva si el equipo no consintió volver a compartirlo; apagar un consentimiento local existente lo elimina del próximo snapshot.
5. **Conflicto concurrente:** el cliente usa revisiones condicionales e idempotencia. Si la revisión remota avanzó, detiene escrituras y pide elegir un snapshot completo; nunca sobrescribe sin aviso.
6. **Seguridad de cuenta:** la autorización se comprueba por cuenta en cada lectura/escritura. Una cuenta no puede leer ni modificar otra. El PIN vence, no se reutiliza y nunca sustituye MFA.
7. **Estado público:** cualquier visitante puede ver disponibilidad general, estado de sincronización/correo, incidentes, acciones en curso y mantenimientos. La página no publica datos de usuarios, logs, IPs, secretos ni detalles internos.

## Entregas y tareas

1. **F1 — Portabilidad local:** implementación inicial en el escritorio. Restan pruebas de integración de fallos del almacén, ensayo de restauración en Windows y objetivo de cobertura específica.
2. **F2 — Contrato y adaptador local:** implementados schema cerrado v1, fixture, tipos Rust/TypeScript, validación con tope de 256 KiB y comando nativo para construir el snapshot desde preferencias y perfiles. El endpoint se incluye solo si su consentimiento por perfil está guardado. Ajv valida el fixture con el JSON Schema canónico; pruebas Rust y TypeScript comparan todas las enumeraciones y comprueban campos prohibidos.
3. **F3 — Servicio y cuenta:** API Fastify, migraciones, registro/verificación y restablecimiento por PIN, login web/loopback PKCE, TOTP/códigos, passkeys passwordless y flujo administrativo de recuperación/reenrolamiento están integrados localmente tras flags apagados. El login con passkey conserva el challenge TOTP cuando está activo; la gestión exige una sesión reciente y usa ticket de un uso, CSRF y sesión web corta. Altas y bajas de passkey encolan avisos genéricos en la misma transacción. El login TOTP bloquea replay y consume códigos de recuperación una vez; la app gestiona enrolamiento/rotación/desactivación con sesión reciente y los cambios revocan otras sesiones. Restablecer contraseña no crea sesión ni altera MFA. Quedan pruebas e2e con autenticadores/Google, validar notificaciones con Resend/VPS, credenciales/despliegue Google OAuth (ADR-0047), ensayo de recuperación y despliegue.
4. **F4 — Sincronización:** cliente Rust con token nativo, botón manual, comparación/elección, auto-sync, estado pendiente durable, revisión al abrir y cada tres horas, `If-Match`, idempotencia y copia local previa implementados. Historial cloud paginado/restaurable/borrable validado en PostgreSQL 16 aislado (ADR-0045); pendientes pruebas de suspensión/reanudación y validación VPS real.
5. **F5 — Estado y operación:** página estática `/status` y documento acotado implementados en Caddy, con actualización administrativa por SSH. El [runbook de recuperación de cuenta](../runbooks/recuperacion-cuenta.md) define PIN, prueba independiente, decisión manual, revocación y auditoría mínima. La cola local notifica cambios de factor; pendientes entrega/monitorización real, mecanismo administrativo local al VPS, ensayo del runbook, validación Caddy/VPS y despliegue TLS.

El [backlog](../BACKLOG.md) contiene criterios de cierre por tarea; la [hoja de ruta](../ROADMAP.md) ordena las entregas. La suite y cobertura se actualizan con cada entrega; sin `TEST_DATABASE_URL`, las pruebas PostgreSQL se omiten. CI verifica migraciones, rate limit, snapshots, cuenta, restablecimiento, revocaciones y retención con PostgreSQL temporal. Siguen pendientes validar Caddy/VPS, pruebas manuales de Windows y passkeys con autenticadores reales. Los módulos restantes de autenticación, cifrado y recuperación deberán cumplir al menos 85 % en líneas y ramas antes de habilitarse.

## Pendientes antes de producción

- **Decisión aprobada:** no enviar copias de desastre fuera del VPS. No hay copias de desastre configuradas hoy; la pérdida total del VPS puede borrar definitivamente cuentas y preferencias de nube. No se ofrece garantía de recuperación tras perder el host.
- Definir por separado si se conservará una copia local de PostgreSQL en el propio VPS. Puede ayudar ante ciertos errores de datos, pero no protege frente a la pérdida del VPS y no debe llamarse copia de desastre.
- **Decisión aprobada:** los códigos de recuperación de un solo uso se emiten al activar MFA y los cambios de factor revocan sesiones ajenas. Activar/desactivar TOTP y confirmar una rotación genera un aviso durable al correo verificado; la revisión administrativa local requiere PIN más prueba independiente preexistente. Sin prueba no se retiran factores. Tras la aprobación, el titular confirma un TOTP nuevo antes de retirar factores anteriores; no se crea sesión. El flujo está implementado localmente, pero no debe operarse en producción hasta configurar Resend y ensayarlo en VPS.
- Informar claramente del riesgo de pérdida total del VPS antes de activar la sincronización. Mantener la app local-first y no presentar la nube como única copia de la configuración.
- Fijar límites de cuenta/dispositivos/peticiones, monitorización y procedimiento de incidentes.
- Configurar dominio/remitente en Resend y sus registros DNS; crear API key de solo envío restringida al dominio y guardarla como secreto del VPS. No pegarla en el chat ni incluirla en GitHub. Configurar credenciales de Google fuera del repositorio.

El diseño técnico y estos criterios aprobados están en el [diseño formal](../designs/sincronizacion-preferencias-y-portabilidad.md) y el [runbook de recuperación](../runbooks/recuperacion-cuenta.md). Deben implementarse y ensayarse antes de habilitar cuentas para el público.
