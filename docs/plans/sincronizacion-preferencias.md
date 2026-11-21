# Especificación: perfiles, portabilidad y sincronización

- **Estado:** diseño aprobado; implementación pendiente.
- **Fecha:** 2026-11-21.
- **Alcance:** Windows primero; perfiles locales, exportar/importar y sincronización opcional de preferencias.
- **Diseño formal:** [sincronización de preferencias y portabilidad](../designs/sincronizacion-preferencias-y-portabilidad.md).
- **Decisiones:** [ADR-0020](../adr/0020-perfiles-y-sincronizacion-opcional.md) y [ADR-0023](../adr/0023-servicio-de-sincronizacion.md).

## Estado actual

La versión actual no tiene cuentas, servicio de sincronización ni flujos de exportar/importar configuración. Los perfiles viven en `providers.json`, la política del agente en `agent.json`, la apariencia y la preferencia de actualización en `localStorage`, y las claves de proveedores en Windows Credential Manager. El diseño aprobado no implica que estas funciones estén disponibles en el instalador.

## Decisiones funcionales aprobadas

- La app debe seguir funcionando sin cuenta ni red. Exportar/importar será independiente del servicio.
- La sincronización de cuenta será opcional y solo cubrirá tema/apariencia, preferencia de actualización, tipo/nombre/modelo del proveedor, perfil activo y endpoint personalizado cuando se autorice para ese perfil.
- Nunca se sincronizan claves API, contraseñas, OAuth/session tokens, passkeys, factores MFA, conversaciones, comandos o salida de terminal, proyectos/rutas, actividad del agente ni políticas de ejecución.
- El perfil local predeterminado se llama **Usuario desconocido**; no representa una identidad autenticada.
- Exportar puede incluir claves solo tras selección explícita y contraseña obligatoria. La transferencia con claves usa Argon2id y AES-256-GCM con parámetros acotados; no existe exportación de claves en claro. Importar escribe directamente en Credential Manager y falla sin aplicar parcialmente la operación.
- El servicio oficial se ejecutará en el VPS del proyecto, con TypeScript, Fastify y PostgreSQL, en `https://sync.laurafernandezenfermeria.com`. No habrá E2EE en la primera versión; el operador podrá leer los campos permitidos.
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
4. **Cambios en línea y fuera de línea:** guarda primero en local. Un cambio guardado intenta sincronizarse; si no hay red, conserva un estado pendiente duradero y visible.
5. **Conflicto concurrente:** el cliente usa revisiones condicionales e idempotencia. Si la revisión remota avanzó, detiene escrituras y pide elegir un snapshot completo; nunca sobrescribe sin aviso.
6. **Seguridad de cuenta:** la autorización se comprueba por cuenta en cada lectura/escritura. Una cuenta no puede leer ni modificar otra. El PIN vence, no se reutiliza y nunca sustituye MFA.
7. **Estado público:** cualquier visitante puede ver disponibilidad general, estado de sincronización/correo, incidentes, acciones en curso y mantenimientos. La página no publica datos de usuarios, logs, IPs, secretos ni detalles internos.

## Entregas y tareas

1. **F1 — Portabilidad local:** contrato versionado, adaptador de perfil, exportación/importación, cifrado de claves, vista previa, backup/rollback y pruebas de cobertura.
2. **F2 — Servicio y cuenta:** Fastify/PostgreSQL, migraciones, email, email/contraseña, Google, passkeys, TOTP, PIN, revocación de sesión y borrado de cuenta.
3. **F3 — Sincronización:** snapshot cerrado, cliente Rust, estado y cola offline, revisiones condicionales, consentimiento de endpoint, conflictos, **Sincronizar ahora** y revisión cada 3 horas con Laural abierta.
4. **F4 — Estado y operación:** página `/status`, avisos de mantenimiento/incidentes desde operación protegida, backups, procedimientos de recuperación y despliegue TLS.

El [backlog](../BACKLOG.md) contiene criterios de cierre por tarea; la [hoja de ruta](../ROADMAP.md) ordena las entregas. Los módulos críticos de sync, cifrado, autenticación y recuperación requieren al menos 85 % de cobertura de líneas y ramas, además de pruebas de integración en PostgreSQL y pruebas manuales de Windows.

## Pendientes antes de producción

- **Propuesta por aprobar:** backup lógico diario de PostgreSQL, cifrado antes de subirlo a almacenamiento fuera del VPS, retención de 30 días, aviso si falla y prueba de restauración trimestral en entorno aislado. Objetivo inicial de recuperación: hasta 24 h de cambios podrían perderse. No hay backups configurados ahora; el diseño no afirma lo contrario.
- **Propuesta por aprobar:** emitir códigos de recuperación de un solo uso al activar MFA; permitir revisión manual del administrador solo con PIN de correo más un factor/prueba independiente preexistente. Sin ella no se retiran factores. Revocar sesiones y notificar al aprobar; registrar categoría de evidencia y decisión, no el contenido de pruebas.
- Implementar tombstones de borrado fuera del backup y reaplicarlos antes de reabrir el servicio tras restaurar. Informar que las copias de desastre cifradas pueden persistir hasta 30 días; son distintas de las copias visibles de recuperación.
- Fijar límites de cuenta/dispositivos/peticiones, monitorización y procedimiento de incidentes.
- Configurar proveedor de correo y credenciales de Google fuera del repositorio; nunca publicar secretos en GitHub.

El diseño técnico y estos criterios operativos recomendados están en el [diseño formal](../designs/sincronizacion-preferencias-y-portabilidad.md). Se deben aprobar e implementar antes de habilitar cuentas para el público.
