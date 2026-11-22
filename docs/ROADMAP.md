# Hoja de ruta

Estado al 22 de noviembre de 2026. «Implementado» describe código presente; «validación pendiente» señala que hace falta ejecutar y comprobar el flujo en Windows.

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

- Prueba de ciclo de vida PTY ejecutada el 22-11-2026 en PowerShell, CMD, Git Bash y WSL Ubuntu: entrada, redimensionamiento, 1.500 líneas, marcador final y salida 37; los cuatro shells cerraron correctamente.
- Las regresiones de interfaz comprueban la captura de comandos, marcadores OSC de bloques/código de salida y líneas editadas en el shell. El test detectó que `0x03` no detiene `ping -t` en CMD. Tampoco lo corrigieron limpiar el indicador heredado ni enviar una tecla por el protocolo privado 9001. El ensayo con `CTRL_BREAK_EVENT` global terminó el proceso de prueba; dirigido al PID, no detuvo el comando. Se retiraron los experimentos. La interrupción fiable sigue abierta y requiere otra estrategia compatible con ConPTY; también siguen pendientes la revisión visual de bloques, cierre desde la ventana instalada y reinicio con perfiles personalizados.
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
- Ampliada la revisión obligatoria para alias de alto riesgo conocidos de PowerShell, lanzadores de scripts y ejecutables con rutas explícitas; se añade una advertencia visible en Configuración. Los filtros no pueden interpretar alias/funciones no incluidos ni perfiles personalizados del usuario.
- El filtro clasifica ahora comandos por ejecutable y shell, reconoce operaciones habituales de escritura/borrado de CMD y alias conocidos de PowerShell, detecta operaciones Git de riesgo aun con opciones globales y exige revisión para cambios de registro, servicios, cuentas locales, tareas programadas, firewall, políticas de ejecución, logs de eventos e instalación/retirada de paquetes con gestores de Windows y WSL. Las pruebas incluyen consultas seguras de solo lectura para evitar falsos positivos; faltan perfiles/funciones personalizadas.
- Las pruebas de autorización confirman que sintaxis/riesgo se comprueban antes de las reglas; las reglas requieren coincidencia exacta y automático conserva solo tres consultas Git. Pendiente validar los perfiles personalizados y las variantes de cada shell en la ventana instalada.
- CI de cobertura del 22-11-2026: 106 pruebas Rust pasaron y 1 quedó ignorada; cobertura de líneas Rust 62,48 % total y 64,78 % en `providers.rs`. Interfaz: 115/115 pruebas y 74,64 % de líneas.
- Las pruebas cubren comandos habituales que alteran permisos, atributos o enlaces. La autorización sigue siendo heurística: no aísla procesos ni puede interpretar alias/funciones no incluidos o perfiles personalizados del usuario.
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
- Panel Git inicial: muestra rama, archivos preparados/modificados y diff preparado/no preparado del proyecto abierto. Invoca Git directamente sin shell, fija límites de tiempo/salida y no ejecuta diff externo, textconv ni `fsmonitor`. El estado usa porcelain NUL para conservar nombres con espacios/Unicode y registros de rename. Pruebas con repositorios reales cubren estado limpio, diff mayor que 160 KiB, nombre inusual y ausencia de cambios al índice; `git_panel.rs` alcanza 87,94 % de líneas y 72,97 % de ramas en CI; el diff se marca como dato no confiable. Pendiente revisión visual en la app instalada y prueba manual con repositorios del usuario.
- Recetas de tareas iniciales: el modo Agente incluye recetas editables/locales con vista previa de objetivo y pasos; usar una receta solo rellena el compositor y requiere enviar para generar el plan. Los controles anuncian la selección con `aria-pressed`, exponen límites de entrada mediante `aria-describedby`, devuelven el foco a “Crear receta” cuando se elimina la última y al control invocador conectado al cerrar. Si se pega un nombre, objetivo o pasos por encima del límite, el editor conserva el texto completo y bloquea el guardado hasta corregirlo; no descarta contenido silenciosamente. Las pruebas cubren máximos, entradas excesivas, persistencia, uso sin ejecución y restauración de foco con o sin control invocador conectado. Suite local: 123/123 pruebas de interfaz; `TaskRecipes` mide 98,92 % de líneas y 89,90 % de ramas. Las políticas existentes continúan aprobando cada acción con efectos. Pendiente CI, validar reinicio de la app instalada y uso con lector de pantalla en Windows; la inspección visual local no se pudo realizar porque el capturador de ventanas devolvió un error. Importar/exportar y sincronizar siguen fuera de alcance.
- **Portabilidad y sincronización opcional:** [diseño formal](designs/sincronizacion-preferencias-y-portabilidad.md) aprobado; la portabilidad local está en Configuración y el cliente manual/automático de sync está implementado inicialmente. Se eligieron servicio Fastify/PostgreSQL en el VPS, `sync.laurafernandezenfermeria.com`, status público en el mismo VPS, autenticación completa y sincronización cada tres horas con Laural abierta. Decisión del propietario: no habrá copias de desastre fuera del VPS; la pérdida total del host puede borrar cuentas y snapshots sincronizados. La existencia de una copia PostgreSQL dentro del mismo VPS sigue sin decidirse. La app ya presenta y exige aceptar el riesgo en cada equipo antes de permitir sync; falta validar contra VPS.
- Evaluar otras plataformas tras acordar estrategia de PTY, credenciales y empaquetado.

## M8 — Portabilidad local (implementación inicial)

El flujo de exportar/importar `.laural` ya está integrado en Configuración. Incluye vista previa, fusión o reemplazo, validación de formato y URLs, exclusión de claves por defecto, cifrado Argon2id + AES-256-GCM cuando se eligen claves, copia previa local y rollback de credenciales ante fallos del almacén. La importación no guarda claves en el WebView.

Las regresiones Rust cubren fallo de formato/versión/secciones, parámetros y codificación cifrada, contraseña, límites, preferencias, perfiles y claves. Se verifican escritura/lectura/borrado de una credencial efímera en Credential Manager de Windows, creación y reemplazo de `providers.json` temporal sin dejar archivos temporales, restauración de una clave eliminada si falla el guardado y aviso con ruta de copia si también falla el rollback. CI (22-11-2026): 103 pruebas Rust pasaron y 1 quedó ignorada; `configuration_transfer.rs` alcanzó 94,02 % de líneas, 78,43 % de ramas y 94,10 % de funciones. Pendiente probar fallos reales del almacén, exportar/importar en una instalación limpia y comprobar la recuperación de copias.

- Exportar/importar sin cuenta ni conexión al servicio, con schema versionado, vista previa, fusión/reemplazo y backup previo.
- Exportar claves solo con consentimiento, contraseña obligatoria y cifrado autenticado; importarlas directamente en Credential Manager y revertir fallos sin aplicar parcialmente.
- Completar pruebas de cobertura de formatos, claves, corrupción, contraseñas, migración y rollback.

## M9 — Servicio, cuenta y status público (parcial)

- Implementado el borrado definitivo de cuenta con autenticación reciente, confirmación literal, rate limit y eliminación transaccional en cascada. La app conserva datos locales y permite reintentar la limpieza local. Faltan instalación de prueba y ensayo contra el VPS.

- API Fastify local para health y snapshots privados; schema compartido cerrado, límite 256 KiB, autenticación de sesiones, aislamiento por cuenta, revisiones `ETag`/`If-Match`, idempotencia, validación de endpoints y migraciones PostgreSQL. Añadida página pública `/status` y documento acotado, servido por Caddy fuera del proceso API. Caddy no está instalado en este equipo; VPS pendiente.
- Publicar API Fastify/PostgreSQL bajo `https://sync.laurafernandezenfermeria.com` solo después de validar proxy, carga y flujos de cuenta/snapshot con PostgreSQL en el VPS.
- Implementado parcialmente: registro/verificación de email con Argon2id, PIN HMAC de 5 minutos, Resend y límites por cuenta; página propia de login en navegador, callback loopback restringido, state/PKCE S256, código de un uso (2 min) y sesión de 30 días persistida solo como hash. Desactivado por defecto.
- Integración de escritorio implementada: abre navegador externo, listener temporal solo en `127.0.0.1`, validación de `state`, canje PKCE por HTTPS y token guardado en Credential Manager. Quitar cuenta intenta revocar esa sesión en el servidor y siempre borra la credencial local, incluso sin red; la UI informa si no pudo confirmar la revocación. Configuración lista las 100 sesiones activas más recientes y permite revocar individualmente otras sesiones. Borrar cuenta elimina en cascada sus datos de nube tras login reciente y frase `ELIMINAR`; el cliente borra token y estado local de sync, pero conserva preferencias y claves de proveedor. Pendientes validar la instalación Windows, respuesta perdida y VPS, abuso distribuido, Resend verificado, Google, passkeys y recuperación administrativa.
- Implementación de `/status`, `/status.json` y assets estáticos: Caddy los sirve fuera de Fastify, estado y avisos allowlist, consulta cada minuto, documento persistente actualizado por SSH y validador local. Ante fallos del status, la página muestra estado desconocido sin detalles internos. Pendiente instalar/probar el Caddyfile y el archivo en el VPS; caída total del VPS también interrumpe el status.
- CI prueba migraciones, rate limit concurrente, snapshots, flujo de cuenta, listado/revocación de sesiones, restablecimiento, MFA, reintentos de correo y limpieza en PostgreSQL temporal. El restablecimiento usa PIN de seis dígitos, límites, Argon2id, revoca sesiones y no crea sesión ni altera MFA. Siguen pendientes validar flujo Tauri y la IP detrás de Caddy en VPS, Google, passkeys, recuperación administrativa y operación. No desplegar para usuarios hasta mitigar abuso coordinado y verificar Resend real.
- Integrado localmente TOTP: enrolamiento/factores/códigos, challenge tras contraseña, protección transaccional contra replay, gestión con sesión reciente, códigos activados solo tras confirmación y rotación idempotente. Activar, rotar o desactivar crea en la misma transacción un evento de correo; un trabajador con `FOR UPDATE SKIP LOCKED` lo envía por Resend con reintentos limitados, espera exponencial e idempotencia. Los avisos no contienen códigos ni datos de dispositivo; los eventos entregados/abandonados se eliminan tras 30 días. CI verifica el flujo con PostgreSQL real. Cobertura del módulo MFA: 88,78 % de líneas y 87,80 % de ramas. Pendientes entrega Resend real, Google/passkeys, validación Tauri/VPS y operación. La autenticación sigue desactivada por defecto.

## M10 — Cliente y sincronización (parcial)

- El fixture compartido se valida con el JSON Schema canónico en Ajv. Las pruebas Rust y TypeScript cotejan exactamente las enumeraciones y rechazan valores/propiedades prohibidos para detectar divergencias entre los validadores.

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
- La integración aislada aplica siete migraciones en PostgreSQL real y verifica límites concurrentes compartidos, renovación de ventana, autenticación, restablecimiento, MFA, outbox de seguridad y reintento idempotente. CI ejecuta esa suite con PostgreSQL temporal. Falta validar cabeceras de IP detrás de Caddy en el VPS.
- Runbook de recuperación documentado: código de un uso o revisión manual del administrador con PIN de buzón más prueba de titularidad preexistente e independiente; sin ella se deniega la retirada de factores. TOTP, códigos y cola de avisos integrados localmente; siguen faltando passkeys, el mecanismo administrativo local al VPS y ensayo del procedimiento.
- Fijar límites de cuenta/dispositivo/solicitud, monitorización y procedimiento de incidentes.
- Completar revisión de seguridad, cobertura de líneas y ramas (mínimo 85 % para lógica crítica), instalación/actualización Windows y plan de incidentes.

## M12 — Carga progresiva (implementación inicial)

- La entrada JavaScript bajó de 824 KB a 297 KB mediante división de terminal, Markdown y paneles secundarios. La terminal se carga en un bloque propio; Markdown y paneles se solicitan cuando se necesitan. Ningún bloque supera 500 KB.
- Pendiente medir tiempo de arranque y memoria en una instalación real de Windows; dividir bloques no implica por sí solo una reducción del total de código que la app solicita al iniciar.

## No planificado para el MVP

Backend obligatorio, cuentas de usuario, monetización, telemetría por defecto, distribución de modelos y sandbox propio.

El centro de configuración está implementado en el código posterior a alpha.4. Consulta el [backlog con criterios de cierre](BACKLOG.md).

M2 y M3 incorporan vinculación del perfil a su URL y un conjunto acotado de consultas automáticas de Git. Consulta el backlog para el estado de validación.
M1: prueba PTY real superada en los cuatro shells locales el 22 de noviembre de 2026, incluida la prueba ignorada por defecto en CI ejecutada explícitamente. La comprobación visual de bloques y los controles de interrupción/cierre desde la ventana de Laural siguen pendientes.
La interfaz y el backend disponen de informes automáticos de cobertura en cada push y pull request. Última cobertura verificada en CI (22-11-2026): interfaz, 119/119 pruebas y 74,64 % de líneas; Rust, 106 pruebas y 1 ignorada, 62,48 % de líneas total y 64,78 % en `providers.rs`. `git_panel.rs` alcanza 87,94 % de líneas y 72,97 % de ramas; `TaskRecipes` 98,86 % de líneas y 90,47 % de ramas; `configuration_transfer.rs` mantiene 94,02 % de líneas, 78,43 % de ramas y 94,10 % de funciones. El servicio mantiene la última medición local documentada: 121/121 pruebas con PostgreSQL, 93,07 % de líneas y 86,90 % de ramas. `cargo llvm-cov` sigue sin datos válidos en el entorno Windows/MSVC; CI genera el informe Rust.
M3 incorpora escritura temporal, reemplazo con backup por versión, creación exclusiva y pruebas de archivo bloqueado y aprobaciones concurrentes. La interfaz permite restaurar y limpiar copias manualmente con confirmación. La retención automática configurable está implementada y cubre pruebas de límite y limpieza.
La interfaz lista las veinte copias más recientes por fecha. La retención automática por archivo es optativa y está implementada; su valor inicial conserva todas las versiones.
M3 aplica ahora filtros de sintaxis por shell en Rust antes de los modos automático y reglas. La aprobación explícita permite composiciones tras revisión humana.
M3 reconoce alias comunes de borrado y escritura en el filtro de comandos que requieren aprobación manual. La validación sigue siendo heurística y no interpreta perfiles personalizados.
La alpha.12 publica instaladores Windows x64. La alpha.13 configura el MSI en `es-ES` y NSIS en español; queda pendiente la instalación limpia y la comprobación visual del idioma.
