# Casos de uso: portabilidad y sincronización

- **Estado:** diseño aprobado; ninguna de estas funciones está implementada todavía.
- **Especificación:** [plan de sincronización](../plans/sincronizacion-preferencias.md).
- **Diseño técnico:** [diseño formal](../designs/sincronizacion-preferencias-y-portabilidad.md).

## UC-17 — Exportar/importar perfil sin cuenta

**Actor:** usuario de Laural.

**Precondición:** Laural tiene configuración local; no se requiere red ni cuenta.

**Flujo:** la persona exporta preferencias/perfiles sin claves, importa el archivo en otro equipo, revisa la vista previa y elige fusionar o reemplazar.

**Aceptación:** el formato versionado se valida antes de escribir; las copias se crean antes de reemplazar; errores/corrupción no dejan una importación parcial; las claves siguen en Credential Manager.

## UC-18 — Transferir claves con un archivo protegido

**Actor:** usuario de Laural.

**Precondición:** existe una clave guardada para un perfil.

**Flujo:** la persona activa **Incluir claves**, establece contraseña, exporta y luego introduce la contraseña al importar el archivo.

**Aceptación:** sin contraseña no hay claves en el archivo; cifrado autenticado con parámetros acotados; claves descifradas solo en memoria y escritas directamente a Credential Manager; el reemplazo de varias credenciales se revierte si falla.

## UC-19 — Activar sync y elegir snapshot inicial

**Actor:** usuario con una cuenta.

**Precondición:** cuenta verificada y preferencias locales.

**Flujo:** desde Configuración abre el acceso de cuenta en el navegador externo. En el primer inicio, Laural consulta la nube y, si está vacía, pregunta si se carga el snapshot local.

**Aceptación:** el navegador devuelve código de un solo uso mediante callback loopback; tokens se guardan en Credential Manager; la carga exige confirmación; ningún secreto de proveedor se envía.

## UC-20 — Sincronizar, desconectarse y resolver conflicto

**Actor:** usuario con sync habilitado en uno o más dispositivos.

**Flujo:** Laural intenta sincronizar al guardar una preferencia, al pulsar **Sincronizar ahora**, cada tres horas mientras está abierta y al reanudar si corresponde. Sin red guarda primero en local y marca cambios pendientes. Si otra revisión avanzó, presenta la elección entre snapshot local y nube.

**Aceptación:** escritura condicional e idempotente; no hay «última escritura gana» silenciosa; no se muestran diferencias por campo; la copia recuperable se crea antes de reemplazar; un schema futuro/corrupto no se trata como nube vacía.

## UC-21 — Recuperar cuenta tras perder factores

**Actor:** titular de cuenta y administrador del servicio.

**Flujo:** el titular demuestra control del buzón con PIN de seis dígitos, un solo uso y cinco minutos, y presenta solicitud. El administrador revisa evidencia independiente y aprueba o deniega.

**Aceptación:** el PIN por sí solo no inicia sesión ni retira MFA; sin decisión administrativa no cambia factores. Al aprobar se retiran los factores perdidos, se revocan sesiones, se avisa al usuario y se registra solo categoría/fecha de decisión. El checklist de evidencia se define en el runbook antes de activar el flujo.

## UC-22 — Consultar estado público

**Actor:** visitante sin cuenta.

**Flujo:** abre `https://sync.laurafernandezenfermeria.com/status` para consultar salud general, incidentes, acciones en curso y ventanas de mantenimiento.

**Aceptación:** no requiere autenticación; no muestra usuarios, logs, IPs, claves ni diagnósticos internos; si no puede verificar disponibilidad muestra estado desconocido/último chequeo. La página estática sobrevive a una caída de API/DB, pero no a una caída completa del VPS/red.
