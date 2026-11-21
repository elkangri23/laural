# Especificación: perfiles, portabilidad y sincronización

- **Estado:** F1 en implementación inicial; F2 implementado salvo validación automática de schema común; F3 cuenta/API local parciales y página pública de status implementada en Caddy; F4 cliente manual y auto-sync inicial implementados. Pendientes pruebas de reconexión, reanudación y VPS real. Factores adicionales, recuperación, revocación y despliegue siguen pendientes.
- **Fecha:** 2026-11-21.
- **Alcance:** Windows primero; perfiles locales, exportar/importar y sincronización opcional de preferencias.
- **Diseño formal:** [sincronización de preferencias y portabilidad](../designs/sincronizacion-preferencias-y-portabilidad.md).
- **Decisiones:** [ADR-0020](../adr/0020-perfiles-y-sincronizacion-opcional.md), [ADR-0023](../adr/0023-servicio-de-sincronizacion.md), [ADR-0025](../adr/0025-correo-transaccional-con-resend.md), [ADR-0026](../adr/0026-api-inicial-de-snapshots.md) y [ADR-0027](../adr/0027-registro-y-verificacion-de-correo.md).

## Estado actual

La app ofrece exportar/importar `.laural` local, y el cliente sync manual/automático está integrado. La persona puede consultar, comparar sin detalle de diferencias, elegir equipo/nube o subir el primer snapshot. Tras acordar la línea base, Laural intenta sincronizar al cambiar preferencias/perfiles, al abrir/iniciar sesión y cada tres horas. Mantiene en disco snapshots allowlist local/nube, revisión y marca pendiente; esta separación evita que la falta de consentimiento local para compartir un endpoint aceptado desde la nube lo borre ante otro cambio normal. Sin conexión conserva cambios locales y reintenta; si la nube avanzó, no sobreescribe y solicita elección. Rust usa la sesión en Credential Manager y crea una copia local sin claves antes de aplicar nube. El token no llega al WebView. El servicio no está publicado; validación VPS pendiente. Quitar cuenta solo borra el token local; revocación remota pendiente.

## Decisiones funcionales aprobadas

- La app debe seguir funcionando sin cuenta ni red. Exportar/importar será independiente del servicio.
- La sincronización de cuenta será opcional y solo cubrirá tema/apariencia, preferencia de actualización, tipo/nombre/modelo del proveedor, perfil activo y endpoint personalizado cuando se autorice para ese perfil.
- Nunca se sincronizan claves API, contraseñas, OAuth/session tokens, passkeys, factores MFA, conversaciones, comandos o salida de terminal, proyectos/rutas, actividad del agente ni políticas de ejecución.
- El perfil local predeterminado se llama **Usuario desconocido**; no representa una identidad autenticada.
- Exportar puede incluir claves solo tras selección explícita y contraseña obligatoria. La transferencia con claves usa Argon2id y AES-256-GCM con parámetros acotados; no existe exportación de claves en claro. Importar escribe directamente en Credential Manager y falla sin aplicar parcialmente la operación.
- El servicio oficial se ejecutará en el VPS del proyecto, con TypeScript, Fastify y PostgreSQL, en `https://sync.laurafernandezenfermeria.com`. No habrá E2EE en la primera versión; el operador podrá leer los campos permitidos.
- El correo transaccional lo enviará Resend desde el backend. Su API key será un secreto/variable del VPS y nunca estará en Git, la app de escritorio ni el instalador. Aún faltan dominio y remitente verificados.
- El cliente sincroniza los cambios guardados automáticamente, revisa la nube cada 3 horas mientras Laural está abierta y ofrece **Sincronizar ahora**. Al abrir o reanudar comprueba cambios pendientes.
- Primera carga, reemplazo o conflicto requieren elección explícita. No hay diferencias por campo, fusión por campo ni «última escritura gana» silenciosa. Antes de reemplazar se crea copia recuperable. Las copias visibles no caducan automáticamente; el usuario puede borrarlas y eliminar la cuenta borra las copias de nube.
- El servicio ofrecerá email/contraseña, Google, passkeys y TOTP. La autenticación usa navegador externo y retorno local de un solo uso; las credenciales de sesión se guardan en Credential Manager.
- El PIN de correo tiene 6 dígitos, un uso y 5 minutos de vigencia. Solo verifica correo o inicia una solicitud de recuperación; no permite entrar por sí solo ni quitar MFA.
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
2. **F2 — Contrato y adaptador local:** implementados schema cerrado v1, fixture, tipos Rust/TypeScript, validación con tope de 256 KiB y comando nativo para construir el snapshot desde preferencias y perfiles. El endpoint se incluye solo si su consentimiento por perfil está guardado. Pendiente validar automáticamente el JSON Schema canónico en Rust y TypeScript.
3. **F3 — Servicio y cuenta:** API Fastify, migraciones, registro/verificación por PIN, página web de email/contraseña, flujo loopback/PKCE y emisión de sesión opaca están implementados localmente tras bandera apagada. La app Tauri ya abre el navegador, valida state, canjea por HTTPS y almacena la sesión. Los límites por IP/ruta están implementados; CI aplica las migraciones y prueba el contador atómico en PostgreSQL. Faltan validar con el VPS/Caddy, probar rutas completas contra la base real del servicio, revocación remota, Google, passkeys, TOTP, recuperación, controles ante abuso coordinado y publicación.
4. **F4 — Sincronización:** cliente Rust con token nativo, botón manual, comparación/elección, auto-sync inicial, estado pendiente durable, revisión al abrir y cada tres horas, `If-Match`, idempotencia y copia local previa implementados. Pendientes pruebas de reconexión, suspensión/reanudación y VPS real.
5. **F5 — Estado y operación:** página estática `/status` y documento acotado implementados en Caddy, con actualización administrativa por SSH; pendientes validación del Caddyfile y despliegue en VPS, procedimientos operativos completos, recuperación y despliegue TLS.

El [backlog](../BACKLOG.md) contiene criterios de cierre por tarea; la [hoja de ruta](../ROADMAP.md) ordena las entregas. La suite local actual del servicio tiene 76 pruebas, 94,06 % de líneas y 91,50 % de ramas; la prueba PostgreSQL se omite localmente si no se configura `TEST_DATABASE_URL`. CI aplica las cuatro migraciones y verifica el rate limit con PostgreSQL real. Siguen pendientes las rutas completas contra la base del servicio, la validación Caddy/VPS y las pruebas manuales de Windows. Los módulos restantes de autenticación, cifrado y recuperación deberán cumplir al menos 85 % en líneas y ramas antes de habilitarse.

## Pendientes antes de producción

- **Decisión aprobada:** no enviar copias de desastre fuera del VPS. No hay copias de desastre configuradas hoy; la pérdida total del VPS puede borrar definitivamente cuentas y preferencias de nube. No se ofrece garantía de recuperación tras perder el host.
- Definir por separado si se conservará una copia local de PostgreSQL en el propio VPS. Puede ayudar ante ciertos errores de datos, pero no protege frente a la pérdida del VPS y no debe llamarse copia de desastre.
- **Propuesta por aprobar:** emitir códigos de recuperación de un solo uso al activar MFA; permitir revisión manual del administrador solo con PIN de correo más un factor/prueba independiente preexistente. Sin ella no se retiran factores. Revocar sesiones y notificar al aprobar; registrar categoría de evidencia y decisión, no el contenido de pruebas.
- Informar claramente del riesgo de pérdida total del VPS antes de activar la sincronización. Mantener la app local-first y no presentar la nube como única copia de la configuración.
- Fijar límites de cuenta/dispositivos/peticiones, monitorización y procedimiento de incidentes.
- Configurar dominio/remitente en Resend y sus registros DNS; crear API key de solo envío restringida al dominio y guardarla como secreto del VPS. No pegarla en el chat ni incluirla en GitHub. Configurar credenciales de Google fuera del repositorio.

El diseño técnico y estos criterios operativos recomendados están en el [diseño formal](../designs/sincronizacion-preferencias-y-portabilidad.md). Se deben aprobar e implementar antes de habilitar cuentas para el público.
