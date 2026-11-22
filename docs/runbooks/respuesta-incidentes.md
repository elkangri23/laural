# Runbook: respuesta a incidentes del servicio de sincronización

- **Estado:** borrador operativo; requiere completar datos del VPS y ensayo antes de habilitar cuentas externas
- **Responsable:** propietario/administrador del servicio
- **Relacionado:** [ADR-0023](../adr/0023-servicio-de-sincronizacion.md), [ADR-0024](../adr/0024-sin-copias-fuera-del-vps.md), [ADR-0032](../adr/0032-pagina-publica-de-estado.md), [runbook de recuperación de cuenta](recuperacion-cuenta.md)

## Alcance

Este procedimiento cubre sospecha de acceso no autorizado, exposición de credenciales, alteración o pérdida de snapshots, caída de API/PostgreSQL/Resend y mantenimiento urgente. Solo puede ejecutarlo el administrador autorizado por SSH. La página pública de estado comparte el VPS: no estará disponible durante una caída total del host.

El servicio aún no está desplegado. No habilitar cuentas externas hasta ensayar este runbook, documentar cómo se administra y reinicia cada servicio, establecer monitorización y decidir si habrá una copia de PostgreSQL dentro del VPS. **No se crearán ni enviarán copias fuera del VPS**, por decisión del propietario. La pérdida total del VPS puede destruir de forma permanente las cuentas y preferencias sincronizadas; no existe un procedimiento probado de recuperación ante desastre ni un RPO/RTO acordado.

## Severidad

| Nivel | Criterio | Respuesta |
| --- | --- | --- |
| SEV-1 | Acceso no autorizado posible, credenciales/secretos expuestos, datos alterados o borrados, o sesiones comprometidas | Contener el servicio afectado inmediatamente, proteger cuentas, informar al propietario y preservar evidencia mínima dentro del VPS. |
| SEV-2 | API, PostgreSQL o correo indisponibles; fallos generalizados de login/sync sin indicios de acceso no autorizado | Confirmar alcance, comunicar degradación y recuperar el componente sin borrar datos ni reiniciar migraciones a ciegas. |
| SEV-3 | Fallo aislado o mantenimiento planificado sin impacto sobre integridad de datos | Registrar el caso, informar si afecta a usuarios y resolver en la siguiente ventana segura. |

## Primeros pasos

1. Asignar un identificador aleatorio al incidente y registrar hora UTC de detección, responsable, severidad y síntomas observables. No copiar claves, tokens, PIN, códigos MFA, cuerpos de solicitudes ni snapshots en el ticket.
2. Confirmar si el VPS y el acceso SSH siguen bajo control. Si hay indicios de compromiso del propio host o de la cuenta del proveedor, tratar el host y sus secretos como comprometidos; no declarar resuelto el incidente tras reiniciar procesos.
3. Reducir el impacto: pausar el componente o las escrituras afectadas mediante el mecanismo operativo del VPS. Si el alcance aún no se conoce, priorizar poner la API en mantenimiento antes que arriesgar más cambios de snapshots. No usar una ruta administrativa web; el estado público solo se modifica mediante SSH y archivos validados.
4. Publicar un aviso general en `/status` si Caddy y el VPS están disponibles. Usar únicamente estado, título, resumen y fecha UTC permitidos; no incluir datos de cuentas, direcciones, IP, rutas internas, causa explotable ni detalles de investigación. El documento estático no demuestra que API/PostgreSQL estén operativos.
5. Mantener la configuración local de Laural como fuente recuperable por cada usuario y explicar que la sincronización puede estar pausada. No pedir que envíen archivos de configuración, claves API, chats, historial de terminal ni datos de proyectos.

## Procedimientos por tipo

### Sospecha de toma de cuenta o sesión

1. Si es necesario, pausar la autenticación/sync afectada mientras se confirma el alcance.
2. Revocar las sesiones de la cuenta por los controles de sesión disponibles. El PIN de correo puede verificar el buzón o permitir un cambio de contraseña, pero **no** retira MFA ni acredita por sí solo la titularidad de los factores.
3. Seguir el [runbook de recuperación de cuenta](recuperacion-cuenta.md) si se perdieron factores. No usar una ruta de bypass, editar factores directamente sin la prueba y aprobación requeridas ni conceder acceso solo por correo.
4. Revisar los registros mínimos disponibles en PostgreSQL y Caddy dentro del VPS. No exportarlos a servicios externos. Registrar solo el identificador de cuenta interno, periodo, acciones tomadas y resultado; evitar incluir contenido de solicitudes.

### Secreto o credencial de servidor expuestos

1. Identificar qué secreto se expuso sin pegar su valor en el ticket. Invalidarlo en el proveedor cuando aplique y generar un reemplazo mediante el canal seguro establecido para el VPS.
2. Actualizar la configuración del servicio y reiniciar/revalidar solo mediante el gestor real documentado para ese despliegue. Revocar sesiones si existe posibilidad de exposición de tokens o acceso a la base de datos.
3. Probar health, autenticación afectada, envío de correo si corresponde y una operación de sync controlada antes de retirar el aviso de mantenimiento.
4. **No sustituir `TOTP_ENCRYPTION_KEY` de forma aislada:** las semillas actuales están cifradas con esa clave. La rotación requiere una migración probada que descifre y vuelva a cifrar los factores. Si la clave se expuso y no existe esa migración, pausar el flujo de cuenta/MFA afectado y mantener la autenticación deshabilitada hasta definir una salida segura; la recuperación administrativa aún no está implementada. Nunca improvisar una sustitución en producción.
5. Rotar claves del updater/firma solo si la clave de publicación está realmente afectada; la rotación cambia la confianza de las actualizaciones y debe seguir el procedimiento de release.

### Caída de API, PostgreSQL o Resend

1. Comprobar `/health/live`, `/health/ready` y `/status` desde una ubicación autorizada. El status público puede seguir respondiendo aunque la API o PostgreSQL fallen.
2. Para fallos de correo, no repetir PINes manualmente ni reducir controles MFA; dejar que la cola idempotente aplique su política de reintentos y comunicar el impacto en login/recuperación.
3. Para errores de PostgreSQL, detener escrituras si la integridad es incierta. No volver a ejecutar migraciones manualmente ni recrear la base de datos para recuperar disponibilidad.
4. Restaurar únicamente con un procedimiento ensayado y una copia cuya existencia y ubicación dentro del mismo VPS estén confirmadas. Si no existe una copia válida, explicar que no hay garantía de recuperación; no inventar datos ni dar por reconciliados snapshots locales y cloud.

### Pérdida, corrupción o sync divergente

1. Pausar las escrituras para evitar propagar la divergencia y preservar el estado actual del servidor.
2. No aplicar a ciegas un snapshot de usuario. La app debe pedir elegir entre la configuración local y la nube cuando detecte conflicto; la investigación no debe omitir esa elección.
3. Si se confirma pérdida total del VPS, explicar que las preferencias cloud pueden ser irrecuperables. La copia local/exportación de cada usuario es independiente; el administrador no debe solicitar su envío por correo.

## Recuperación y cierre

1. Mantener el aviso de incidente hasta verificar salud de API y base, login/MFA cuando estén habilitados, correo si aplica y lectura/escritura controlada de un snapshot de prueba.
2. Comparar los resultados de la prueba con los registros previos y revisar que no haya escrituras duplicadas o cambios de cuenta cruzados.
3. Retirar el aviso público mediante actualización atómica y validada del documento de estado. No publicar cronología técnica sensible.
4. Registrar causa categorizada, impacto estimado, duración, secretos rotados, sesiones revocadas, validaciones realizadas y tareas preventivas. No guardar secretos, PIN, códigos, tokens, IP ni contenido de snapshots en el informe.
5. Revisar si el modelo de amenazas, el backlog, la guía de recuperación o este runbook necesitan cambios. El cierre técnico no equivale a certificar que los datos se recuperaron.

## Datos del despliegue que faltan antes de operar

- Host/VPS y persona suplente autorizada para SSH.
- Gestor de procesos y nombres reales de los servicios Fastify, PostgreSQL y Caddy; procedimiento validado para parar, iniciar y obtener logs mínimos.
- Ruta/permisos del estado público y mecanismo de validación/sustitución atómica en ese VPS.
- Monitorización/alertas y canal de contacto con el administrador; actualmente no se asume que exista.
- Existencia, ubicación, cifrado y retención de una eventual copia **local al VPS** de PostgreSQL; decidir si se crea. Ninguna copia fuera del host.
- Resultado de un ensayo de caída, revocación de sesión, rotación de secreto no cifrador y recuperación desde copia local, si se aprueba.
- Para rotar `TOTP_ENCRYPTION_KEY`, un plan probado de migración de semillas cifradas y validación de login MFA.

