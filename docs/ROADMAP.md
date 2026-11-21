# Hoja de ruta

Estado al 21 de noviembre de 2026. «Implementado» describe código presente; «validación pendiente» señala que hace falta ejecutar y comprobar el flujo en Windows.

## M0 — Esqueleto de producto (implementado; validación de uso pendiente)

- Tauri 2, React/TypeScript y backend Rust.
- PowerShell, CMD, WSL y Git Bash, pestañas y división de dos terminales vertical u horizontal.
- Perfiles locales, descubrimiento de modelos y chat contextual con streaming y cancelación.
- Doce temas de color, modo claro/oscuro y preferencias locales.
- Regresiones de la app principal verifican que tema y modo se recuperan/guardan y que se ofrecen doce temas; también cubren creación de pestañas y alternancia de panel dividido.
- Configuración usa un diálogo modal nativo, enfoca su título al abrir y admite Escape; pruebas de interfaz cubren su apertura y cierre por teclado.
- Cambiar de perfil limpia la clave del formulario en memoria; una regresión confirma que probar y guardar envían el ID del perfil seleccionado y no la clave escrita para el anterior.
- Pruebas con un nuevo montaje verifican que tema/modo vuelven desde `localStorage` y que la app recupera el perfil activo al consultar el backend; falta verificar el reinicio del proceso instalado en Windows.
- Planes de agente, modos revisar/reglas/automático y aprobación explícita para cambios de archivos.
- Icono y favicon propios; build de Windows automatizable desde GitHub Actions.
- Código dividido para carga progresiva: entrada JS de 297,30 KB (89,85 KB gzip), terminal en bloque de 335,94 KB (85,03 KB gzip), Markdown de 164,75 KB cargado al necesitarlo y paneles secundarios bajo demanda. No quedan bloques mayores de 500 KB; medir arranque frío y memoria en una instalación Windows sigue pendiente.
- README, arquitectura, requisitos, ADR, casos de uso y documentación de contribución.

## M1 — Estabilidad de terminal (parcial)

- Prueba manual de PTY superada en PowerShell, CMD, Git Bash y WSL Ubuntu: entrada, redimensionamiento, recepción de las 1.500 líneas y código de salida 37. Los controles Copiar y Limpiar actúan sobre la selección/pantalla de la pestaña activa. El reinicio y la comprobación de bloques en la interfaz instalada siguen pendientes.
- Las regresiones de interfaz comprueban la captura de comandos, marcadores OSC de bloques/código de salida y líneas editadas en el shell. La ventana instalada está disponible, pero esta sesión quedó en la elección inicial de actualizaciones; siguen pendientes la revisión visual de bloques, interrupción, cierre y reinicio desde la ventana instalada.
- La salida visible de los bloques del agente se agrupa a un máximo aproximado de 30 actualizaciones por segundo; el contexto de terminal se mantiene inmediato y el lote final se vacía al completar el comando.
- Los paneles xterm no se vuelven a renderizar cuando solo cambia la salida de los bloques; una regresión cuenta los renders y confirma que permanecen estables.
- Acotada la memoria del historial visual: 2.500 líneas por xterm, 80 bloques globales y 8.000 caracteres por salida de bloque. El contexto independiente para el asistente conserva 24.000 caracteres.
- El panel espera a sus suscripciones antes de arrancar y coordina el cierre durante el arranque. Las regresiones cubren ocultar y mostrar una sesión y el cierre temprano. El evento de salida de Tauri vacía el registro y termina los procesos aunque la entrada esté ocupada. Probado con CMD real desde el backend. Pendiente validar el cierre desde la ventana instalada.
- Validar bloques de comandos, entrada editada y resultados en PowerShell, CMD, Git Bash y WSL; bash/prompt de usuario pueden sustituir las marcas de integración.
- Probar instalación y desinstalación limpia en Windows 10 y 11.

## M2 — Chat y proveedores (parcial)

- Chat incremental cancelable e historial local borrable implementados.
- Corregida la compilación de `keyring` para usar Windows Credential Manager; la clave se verifica tras guardar. En la comprobación local del 20 de noviembre de 2026 no había Ollama en `11434` ni LM Studio en `1234`; FreeLLMAPI en `31415` respondió `401` a una consulta sin autenticación. No se envió una clave. Pendiente configurar un proveedor de prueba y validar desde la aplicación.
- Probar manualmente `/models` y streaming de chat con Ollama, LM Studio, FreeLLMAPI y un endpoint OpenAI-compatible. La sonda local sin credenciales solo confirmó que Ollama/LM Studio no estaban activos y que FreeLLMAPI exige autenticación; no cuenta como prueba funcional del proveedor.
- Añadida regresión local que confirma que el cliente rechaza redirecciones HTTP del proveedor, para no enviar credenciales/contexto a otro destino. Las pruebas con proveedores instalados siguen pendientes.
- La vista previa del contexto y sus límites de envío están implementados; verificar que coincide con cada proveedor.
- Regresiones locales cubren los formatos de modelos OpenAI-compatible (`data[].id`) y Ollama (`models[].name`), incluidos duplicados, campos vacíos y fallback entre formatos. La conexión real de cada servicio sigue pendiente.
- Chat normal y streaming ahora comparten el mismo constructor de mensajes, el recorte de contexto y los límites de historial; una prueba verifica los roles y las marcas de dato no confiable.
- La cancelación interrumpe el envío HTTP y la lectura de cuerpos de respuesta de chat y planes; el streaming también se puede detener mientras llegan fragmentos. Una regresión local cubre operaciones pendientes sin proveedor activo.
- El chat detecta respuestas truncadas o vacías, errores de formato y eventos demasiado grandes. La consulta de modelos reintenta una vez los fallos de conexión y HTTP 502–504 sin Retry-After; una regresión local comprueba que respeta Retry-After y no duplica la petición. Pendiente la validación con proveedores reales.

## M3 — Agente (parcial)

- Planes y estados por acción; modos de autorización configurables. El validador de rutas ahora se comparte entre la vista previa del plan y las operaciones de archivo; los nombres reservados de Windows y la carpeta interna se rechazan antes de presentar el plan.
- Cancelación de generación, interrupción de comando activo y corte del ciclo automático implementados; probar cancelación y resultado en cada shell.
- Ampliada la revisión obligatoria para alias de alto riesgo conocidos de PowerShell, lanzadores de scripts y ejecutables con rutas explícitas; se añade una advertencia visible en Configuración. Los filtros siguen siendo heurísticos y no pueden interpretar alias, funciones ni perfiles personalizados del usuario.
- Las pruebas cubren comandos habituales que alteran permisos, atributos o enlaces. La autorización sigue siendo heurística: no aísla procesos ni puede interpretar alias, funciones o perfiles personalizados del usuario.
- En Windows, escritura, restauración y limpieza fijan la cadena canónica de directorios sin permitir su sustitución. El reemplazo usa handles de archivo y renombrados sin sobrescritura: guarda primero el original y solo coloca el temporal si el destino sigue libre. Las colisiones conservan el archivo concurrente y dejan el original en el backup; queda un intervalo breve entre ambos renombrados, recuperable desde las copias si el proceso se interrumpe.
- Historial de actividad del agente en Configuración: guarda solo tipo, resultado y hora, está limitado a 200 eventos/64 KiB y se puede borrar; no incluye contenido sensible ni se sincroniza.
- Retención optativa de 5/10/20/50/100 copias por archivo implementada; sin límite predeterminado para conservar el comportamiento. La limpieza es por archivo, no recursiva y está cubierta por regresión.

## M4 — Distribución pública (parcial)

- Build de MSI/NSIS disponible localmente; alpha.13 configura MSI `es-ES` y NSIS en español. Pendiente validar ambos instaladores en una instalación limpia.
- Workflow de GitHub Actions ejecutado correctamente en GitHub y artefactos generados.
- Updater Tauri integrado para NSIS x64: preferencia manual/automática, chequeo al inicio y cada seis horas, descarga separada, reinicio y versión en Configuración. Falta validar una actualización real de alpha.14 a la siguiente release.
- Firma del updater configurada con clave privada como secreto de GitHub Actions y clave pública fijada en la app; firma Authenticode sigue fuera del alcance.
- Validar instalación limpia, actualización y desinstalación.
- Publicación de alpha.14 validada en GitHub: instalador NSIS x64, firma `.sig` y `latest.json` firmados publicados; el manifiesto fue sincronizado a `main`.
- Validar en Windows la actualización real de alpha.14 a la siguiente versión, instalación limpia, reinicio y desinstalación.
- Resolver incidencias críticas de validación manual antes de declarar estable.

## Auditoría de seguridad (primera revisión completada; validación manual pendiente)

- Aplicada CSP local y retirada la capacidad `opener` no utilizada.
- Acotadas respuestas de proveedor, enumeración de proyectos, escrituras, datos IPC y concurrencia de consultas.
- npm audit sin vulnerabilidades conocidas. Cargo audit conserva avisos de mantenimiento y una advertencia GLib de la cadena Linux de Tauri; revisar el árbol al actualizar Tauri.
- Pendiente una prueba manual de instalación limpia, revisión de firma/actualización y ensayos de agente con perfiles personalizados. La auditoría no certifica sandbox del terminal.

## Después del MVP

- Paleta de acciones y búsqueda de comandos recientes: atajo `Ctrl+K`, navegación por resultados con flechas/Enter, selección de sesiones, copia de comandos para revisión y accesos a proyectos, Git, recetas, ayuda y notificaciones. La navegación Historial filtra los 100 comandos recientes efímeros. El menú general de Laural ofrece accesos directos a terminal, proyecto, búsqueda, proveedor, configuración y ayuda; enfoca la primera opción y admite flechas, Inicio, Fin y Escape. El panel lateral del asistente se puede ocultar y la preferencia se guarda localmente; Más opciones ofrece accesos rápidos de terminal. El acento cumple contraste WCAG AA en las doce paletas y ambos modos; textos secundarios compartidos y seis colores de navegación/paneles cumplen AA sobre sus fondos reales en claro y oscuro. Falta revisión visual de la aplicación instalada y validar el portapapeles en Windows.
- Panel Git inicial: muestra rama, archivos preparados/modificados y diff preparado/no preparado del proyecto abierto. Invoca Git directamente sin shell, fija límites de tiempo/salida y no ejecuta diff externo, textconv ni `fsmonitor`. La persona puede añadir el diff a chat/agente de forma explícita, quitarlo antes de enviar y revisarlo en la vista previa; el backend limita el tamaño a 160 KiB y lo marca como dato no confiable. Pendiente prueba manual en repositorios limpios, grandes y con nombres de archivo inusuales en Windows.
- Recetas de tareas iniciales: el modo Agente incluye recetas editables/locales con vista previa de objetivo y pasos; usar una receta solo rellena el compositor y requiere enviar para generar el plan. El diálogo mantiene el foco dentro y lo mueve al formulario al crear/editar; regresiones confirman persistencia al cerrar y reabrir el panel. Las políticas existentes continúan aprobando cada acción con efectos. Pendiente validar reinicio de la app instalada, uso con lector de pantalla y límites de entrada en Windows; importar/exportar y sincronizar siguen fuera de alcance.
- **Portabilidad y sincronización opcional:** [diseño formal](designs/sincronizacion-preferencias-y-portabilidad.md) aprobado; la portabilidad local está en Configuración y el cliente manual/automático de sync está implementado inicialmente. Se eligieron servicio Fastify/PostgreSQL en el VPS, `sync.laurafernandezenfermeria.com`, status público en el mismo VPS, autenticación completa y sincronización cada tres horas con Laural abierta. Decisión del propietario: no habrá copias de desastre fuera del VPS; la pérdida total del host puede borrar cuentas y snapshots sincronizados. La existencia de una copia PostgreSQL dentro del mismo VPS sigue sin decidirse. La app ya presenta y exige aceptar el riesgo en cada equipo antes de permitir sync; falta validar contra VPS.
- Evaluar otras plataformas tras acordar estrategia de PTY, credenciales y empaquetado.

## M8 — Portabilidad local (implementación inicial)

El flujo de exportar/importar `.laural` ya está integrado en Configuración. Incluye vista previa, fusión o reemplazo, validación de formato y URLs, exclusión de claves por defecto, cifrado Argon2id + AES-256-GCM cuando se eligen claves, copia previa local y rollback de credenciales ante fallos del almacén. La importación no guarda claves en el WebView.

Añadidas regresiones que simulan el fallo al escribir una credencial y comprueban tanto el rollback satisfactorio como el mensaje/localización de copia cuando el rollback también falla. Pendiente antes de dar M8 por cerrado: pruebas de integración con fallos reales de Credential Manager y escritura de `providers.json`, ensayo manual de exportación/importación en Windows limpio, comprobación de recuperación de copias y obtener cobertura Rust específica. En el entorno actual `cargo-llvm-cov` ejecuta los tests pero no produce datos de cobertura válidos. La sincronización de cuenta sigue siendo una fase posterior.

- Exportar/importar sin cuenta ni conexión al servicio, con schema versionado, vista previa, fusión/reemplazo y backup previo.
- Exportar claves solo con consentimiento, contraseña obligatoria y cifrado autenticado; importarlas directamente en Credential Manager y revertir fallos sin aplicar parcialmente.
- Completar pruebas de cobertura de formatos, claves, corrupción, contraseñas, migración y rollback.

## M9 — Servicio, cuenta y status público (parcial)

- API Fastify local para health y snapshots privados; schema compartido cerrado, límite 256 KiB, autenticación de sesiones, aislamiento por cuenta, revisiones `ETag`/`If-Match`, idempotencia, validación de endpoints y migraciones PostgreSQL. Añadida página pública `/status` y documento acotado, servido por Caddy fuera del proceso API. Caddy no está instalado en este equipo; VPS pendiente.
- Publicar API Fastify/PostgreSQL bajo `https://sync.laurafernandezenfermeria.com` solo después de validar proxy, carga y flujos de cuenta/snapshot con PostgreSQL en el VPS.
- Implementado parcialmente: registro/verificación de email con Argon2id, PIN HMAC de 5 minutos, Resend y límites por cuenta; página propia de login en navegador, callback loopback restringido, state/PKCE S256, código de un uso (2 min) y sesión de 30 días persistida solo como hash. Desactivado por defecto.
- Integración de escritorio implementada: abre navegador externo, listener temporal solo en `127.0.0.1`, validación de `state`, canje PKCE por HTTPS y token guardado en Credential Manager. Quitar cuenta intenta revocar esa sesión en el servidor y siempre borra la credencial local, incluso sin red; la UI informa si no pudo confirmar la revocación. La revocación de otras sesiones/dispositivos y cierre total de cuenta siguen pendientes, igual que validación VPS, abuso distribuido, Resend verificado, Google, passkeys/TOTP, recuperación y borrado.
- Implementación de `/status`, `/status.json` y assets estáticos: Caddy los sirve fuera de Fastify, estado y avisos allowlist, consulta cada minuto, documento persistente actualizado por SSH y validador local. Ante fallos del status, la página muestra estado desconocido sin detalles internos. Pendiente instalar/probar el Caddyfile y el archivo en el VPS; caída total del VPS también interrumpe el status.
- CI prueba las cuatro migraciones, el rate limit concurrente y las rutas Fastify de snapshots contra PostgreSQL temporal: aislamiento entre cuentas, lectura/escritura, `ETag`/conflicto, idempotencia y rechazo de campos desconocidos. El flujo de integración con almacenes PostgreSQL reales para registro Argon2id, verificación PIN, login PKCE, emisión de sesión y acceso a sync pasó en CI. Siguen pendientes el flujo Tauri habilitado y la IP detrás de Caddy en VPS; completar retención, recuperación, publicación de avisos y operación. No desplegar para usuarios hasta completar estos controles, mitigar abuso coordinado y verificar entrega Resend real.

## M10 — Cliente y sincronización (parcial)

- Implementados en Configuración: **Sincronizar ahora**, lectura/comparación inicial, elección de snapshot completo sin mostrar diferencias, y carga explícita de la configuración local cuando la nube está vacía.
- El cliente Rust consulta y escribe la API por HTTPS usando la sesión de Credential Manager; emplea `ETag`, `If-Match`, clave de idempotencia y detección de conflicto. El token no llega al WebView.
- Añadidos auto-sync después de guardar tema, apariencia, modo de actualización, proveedor o selección activa; revisión al abrir/iniciar sesión, al recuperar conexión, al volver a la app y cada tres horas. Las comprobaciones cercanas se agrupan. Un archivo local atómico conserva snapshots allowlist local/nube, revisión y marca de pendiente. Si el servicio no responde, conserva el pendiente y reintenta; si avanzó otra revisión, detiene la escritura y solicita elección. Un endpoint compartido aceptado desde la nube no provoca una falsa diferencia ni se borra al guardar otra preferencia si este equipo aún no consintió volver a compartirlo.
- Aplicar la nube crea primero un `.laural` recuperable sin API keys; sustituye los perfiles de forma atómica. Las claves locales quedan en Credential Manager y los IDs se remapean si cambia el destino para no reutilizar una clave contra otro endpoint.
- La nube solo recibe el allowlist aprobado; endpoint personalizado sujeto a consentimiento. Al descargar un endpoint compartido, la app desactiva el consentimiento local para volver a compartirlo.
- Pruebas de regresión cubren la reanudación automática al regresar la conexión/primer plano y la prohibición de sincronizar antes de aceptar el riesgo. El lector local exige todos los campos del estado y rechaza JSON dañado, snapshots inválidos, estado incompleto y archivos sobredimensionados. Pendiente: probar suspensión/reanudación y conflictos contra el VPS habilitado, y validar visualmente los estados en Windows.
- Implementado el aviso obligatorio de pérdida total del VPS y ausencia de cifrado de extremo a extremo. La aceptación se guarda solo en el equipo y bloquea auto-sync, comparación, subida y aplicación de snapshots hasta que el usuario la confirme; se mantienen excluidas las claves API.
- Excluir siempre claves, chats, terminal/historial, proyectos/rutas y política del agente.

## M11 — Preparación para producción (pendiente)

- El riesgo de no tener copias fuera del VPS ya se documenta y se muestra antes de habilitar sync. Acordar si habrá una copia local de PostgreSQL y aclarar que no sobrevive a la pérdida del host.
- Implementado un límite persistente de solicitudes por IP y ruta, con contador atómico en PostgreSQL, huella HMAC sin IP en claro y confianza de proxy restringida a loopback. Pendiente verificar migración/contención bajo carga con PostgreSQL y Caddy reales, calibrar umbrales y añadir alertas operativas.
- Añadida una integración aislada que aplica las cuatro migraciones en PostgreSQL real y verifica límites concurrentes compartidos por dos instancias, renovación de ventana y separación por ruta/IP. El job de servicio en CI pasó con PostgreSQL temporal. Falta validar cabeceras de IP detrás de Caddy en el VPS.
- Implementar códigos de recuperación y runbook de revisión manual con una prueba independiente preexistente; sin ella el administrador no retira MFA. La sesión actual se revoca al cerrar sesión; quedan gestión/revocación de otros dispositivos y notificación al usuario.
- Fijar límites de cuenta/dispositivo/solicitud, monitorización y procedimiento de incidentes.
- Completar revisión de seguridad, cobertura de líneas y ramas (mínimo 85 % para lógica crítica), instalación/actualización Windows y plan de incidentes.

## M12 — Carga progresiva (implementación inicial)

- La entrada JavaScript bajó de 824 KB a 297 KB mediante división de terminal, Markdown y paneles secundarios. La terminal se carga en un bloque propio; Markdown y paneles se solicitan cuando se necesitan. Ningún bloque supera 500 KB.
- Pendiente medir tiempo de arranque y memoria en una instalación real de Windows; dividir bloques no implica por sí solo una reducción del total de código que la app solicita al iniciar.

## No planificado para el MVP

Backend obligatorio, cuentas de usuario, monetización, telemetría por defecto, distribución de modelos y sandbox propio.

El centro de configuración está implementado en el código posterior a alpha.4. Consulta el [backlog con criterios de cierre](BACKLOG.md).

M2 y M3 incorporan vinculación del perfil a su URL y un conjunto acotado de consultas automáticas de Git. Consulta el backlog para el estado de validación.
M1: prueba de PTY real superada en los cuatro shells locales el 20 de noviembre de 2026. La prueba que queda ignorada por defecto en CI se ejecutó explícitamente y pasó; la comprobación visual de bloques en la ventana de Laural sigue pendiente.
La interfaz y el backend disponen de informes automáticos de cobertura en cada push y pull request. La suite de interfaz tiene 108 pruebas y 74,08 % de cobertura global de líneas. El servicio local tiene 78 pruebas, 94,24 % de líneas y 91,71 % de ramas; CI ejecuta además tres integraciones PostgreSQL. Rust tiene 83 pruebas superadas y 1 ignorada. La cobertura de líneas del componente Git es 92 % y la del componente de recetas es 98,86 %. La cobertura Rust local sigue sin datos válidos en el entorno Windows/MSVC.
M3 incorpora escritura temporal, reemplazo con backup por versión, creación exclusiva y pruebas de archivo bloqueado y aprobaciones concurrentes. La interfaz permite restaurar y limpiar copias manualmente con confirmación. La retención automática configurable continúa pendiente.
La interfaz lista las veinte copias más recientes por fecha. La retención automática por archivo es optativa y está implementada; su valor inicial conserva todas las versiones.
M3 aplica ahora filtros de sintaxis por shell en Rust antes de los modos automático y reglas. La aprobación explícita permite composiciones tras revisión humana.
M3 reconoce alias comunes de borrado y escritura en el filtro de comandos que requieren aprobación manual. La validación sigue siendo heurística y no interpreta perfiles personalizados.
La alpha.12 publica instaladores Windows x64. La alpha.13 configura el MSI en `es-ES` y NSIS en español; queda pendiente la instalación limpia y la comprobación visual del idioma.
