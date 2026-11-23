# Registro de cambios

## Sin publicar

- El agente ahora exige revisión para cmdlets PowerShell que crean, limitan, borran o escriben en registros clásicos de eventos; las consultas de eventos siguen siendo de lectura.
- La revisión del agente ahora cubre cmdlets y aliases de PowerShell que modifican propiedades de elementos, incluidos valores del Registro; las consultas de lectura siguen sin revisión adicional.
- La regresión del transporte PTY cubre el máximo exacto de 32 KiB y el rechazo del byte adicional.
- El decodificador PTY acepta solo Base64 estándar con relleno canónico; rechaza espacios, caracteres ajenos al alfabeto y relleno omitido antes de decodificar.
- El formato de evento PTY Base64 ahora usa un fixture compartido por Rust y TypeScript, con una prueba en cada runtime para evitar divergencias del contrato.
- Las terminales inactivas detienen el parpadeo del cursor; solo la visible y activa mantiene la animación, que se reactiva al volver a ella.
- El gate de CI Rust exige ahora 85 % de cobertura de líneas en el módulo de transporte Base64 de terminal; el gate de ramas continúa limitado a módulos con decisiones de código medibles.
- La salida de terminal viaja como Base64 en vez de arrays JSON numéricos, con límite estricto de 32 KiB al decodificar. Una carga de 32 KiB se serializa en menos de la mitad de bytes y mantiene el round-trip exacto.
- Las terminales omiten peticiones de redimensionado repetidas cuando filas y columnas no cambiaron; los tamaños nuevos se aplican sin demora.
- El chat acumula los fragmentos del streaming y solo compone el texto al solicitar una instantánea visual, reduciendo concatenaciones sin cambiar el ritmo de actualización. El benchmark sintético comparativo obtuvo ≈9,6 % menos tiempo al acumular 270.000 caracteres con 375 lecturas; no representa una medición del proceso de escritorio.
- Durante el streaming del asistente, los deltas se acumulan cada 50 ms sin actualizar el estado global de React en cada lote; la interfaz se actualiza como máximo cada 200 ms. Primer fragmento y respuesta final inmediatos, y no se pierden fragmentos si falla la conexión. Regresiones dirigidas cubren los límites temporales, éxito y error.
- El CI mide los commits de React con 20 deltas durante un segundo simulado y limita el total a 14; esto evita reintroducir una actualización global por cada lote.
- El historial del chat agrupa escrituras locales cada 500 ms durante streaming, hasta diez veces menos frecuentes, y fuerza el guardado al ocultar la ventana.
- Las filas del chat ya no se vuelven a renderizar cuando un delta solo actualiza otra respuesta.
- El Markdown de la respuesta activa se actualiza como máximo cada 200 ms durante el streaming; el primer fragmento y el resultado final aparecen de inmediato.
- La captura de texto de la terminal para contexto y bloques se agrupa durante 16 ms; la salida visible sigue inmediata y el lote pendiente se vacía al cerrar la sesión.
- Una regresión sintética confirma que 1.500 eventos PTY en una ráfaga producen una sola actualización de contexto, limitada a los últimos 24.000 caracteres; no representa una medición de CPU con carga real.
- El acumulador de contexto PTY conserva fragmentos en una cola acotada, suelta referencias al recortarlos y une el texto una vez por lote.
- Microbenchmark local del módulo real con Node 24: 1.500 fragmentos de 180 caracteres dieron una mediana de 0,127 ms con el acumulador nuevo frente a 2,789 ms con el anterior (22×); salidas idénticas. Es una medición aislada, no de la app completa.
- Los bloques secundarios de comandos actualizan su estado a 20 Hz en vez de 30 Hz; el terminal visible sigue escribiendo al instante y los bloques vacían siempre el último fragmento al terminar.
- Cada bloque de comando ahora está memoizado: una salida nueva no vuelve a limpiar y renderizar las otras 29 entradas visibles.
- El historial activo del chat se limita a los últimos 100 mensajes, igual que el almacenamiento y el límite del backend; evita crecimiento indefinido y solicitudes rechazadas al superar el máximo.
- Antes del IPC, el contexto del chat se reduce a los últimos 20 mensajes y 8.000 caracteres Unicode por mensaje, los mismos límites que aplica Rust; evita reenviar respuestas largas completas.
- La limpieza de contadores del limitador ahora trabaja en lotes de hasta 1.000 filas y evita consultas de purga simultáneas dentro de una misma instancia; una regresión PostgreSQL verifica el tamaño real del lote.
- Nueva medición de recursos del proceso release abierto: durante 62 s y con PowerShell presente sin salida/chat, el árbol se mantuvo en 9 procesos, 108,2–108,3 MiB de working set y añadió 0,07 s de CPU. Arranque frío e instalación limpia siguen sin medirse.
- Añadido un runbook de respuesta a incidentes del servicio de sync y actualizado el de recuperación de cuenta para reflejar TOTP/códigos implementados localmente. Se registró una segunda muestra de memoria en reposo de la app Windows y sus límites.
- Mejorado el rendimiento del streaming: los fragmentos del asistente se agrupan cada 50 ms y Markdown evita renderizar mensajes que no cambiaron. La terminal limita a 16 sesiones y cada PTY envía eventos solo a su propia pestaña, con menos eventos por salida.
- Añadidas regresiones para el límite de terminales y el renderizado agrupado del chat. Auditoría actual: npm sin vulnerabilidades conocidas; se mantienen documentados los avisos transitivos Rust sin parche compatible.
- Endurecida la autorización del agente ante evaluación de comandos y cambios persistentes del shell: `eval`, `source`, dot-sourcing, traps, asignaciones compuestas como `PATH+=...` y cambios de variables de sesión/entorno en CMD, PowerShell, Bash y WSL ahora requieren revisión manual. Consultas simples como `$env:PATH` siguen permitidas; perfiles personalizados siguen fuera del alcance.
- En Bash y WSL, las mutaciones con `declare`, `typeset`, `readonly`, `local` y `enable` requieren revisión; listados explícitos como `declare -p PATH`, `readonly -p` y `enable -a/-p` continúan disponibles sin aprobación.
- En PowerShell, las mutaciones de incremento/decremento en prefijo y sufijo (`++$contador`, `++ $contador`, `($contador)++`, `$contador --`) y las asignaciones a variables entre paréntesis requieren revisión. Las lecturas entre paréntesis siguen permitidas.
- Los cmdlets PowerShell `Set-Variable`, `New-Variable`, `Clear-Variable`, `Remove-Variable` y alias como `sv`, `nv`, `clv`, `rv` y `set` requieren revisión; `Get-Variable`/`gv` continúan disponibles para consulta.
- Las escrituras/borrados a través de los proveedores `Variable:` y `Env:` con `Set-Item`, `New-Item`, `Remove-Item` y `Clear-Item` (incluidos alias) también requieren revisión; `Get-Item` de lectura sigue permitido.
- En PowerShell, los modos automático y por reglas ahora requieren confirmación manual porque los perfiles de usuario pueden redefinir comandos con alias y funciones. La política no intenta adivinar qué comandos alteró cada perfil.
- Añadido borrado definitivo de cuenta de sincronización con autenticación de menos de diez minutos y confirmación `ELIMINAR`. El servidor elimina datos asociados en cascada y limita solicitudes; Tauri borra token y estado local de sync, sin borrar perfiles, preferencias ni claves locales. Añadidas pruebas API, cascada PostgreSQL y UI. Pendiente ensayo Windows/VPS y tratamiento operativo de resultado ambiguo por timeout.
- Añadidos avisos de seguridad por correo para activar/desactivar TOTP y renovar códigos de recuperación. La notificación queda en una cola PostgreSQL dentro de la transacción de MFA, se reintenta con espera exponencial y usa una clave idempotente de Resend; no incluye códigos, IP ni datos de dispositivo. Añadidas migración 007 y pruebas PostgreSQL de reintento/flujo MFA. Pendiente probar Resend real y monitorizar la cola antes de habilitar cuentas.
- Integrado TOTP para las cuentas de sincronización: challenge de login, enrolamiento desde Cuenta, códigos de recuperación de un uso y revocación de otras sesiones al cambiar el factor. Los códigos nuevos no se activan hasta confirmar que se guardaron; los códigos previos siguen activos durante una rotación pendiente. Añadidas migración 006, API documentada, pruebas de servicio/login/UI y un flujo de integración PostgreSQL real. MFA sigue detrás del flag; faltan Google/passkeys y validación de despliegue.
- Implementado el restablecimiento de contraseña mediante PIN de correo de seis dígitos y cinco minutos. Respuestas genéricas, HMAC separado, límites y máximo de intentos; el cambio de contraseña invalida sesiones y no inicia sesión ni modifica MFA. Añadidas migración PostgreSQL, correo Resend y pruebas unitarias/de integración. Falta el despliegue/validación del VPS con Resend.
- Documentado el runbook de recuperación de cuenta: el PIN solo demuestra acceso al buzón y el administrador necesita una prueba preexistente e independiente para retirar factores. Sin esa prueba, la solicitud se deniega. El procedimiento todavía no se puede operar; MFA, códigos, acción administrativa local al VPS y ensayos siguen pendientes.
- Añadida gestión de sesiones de cuenta: consulta limitada a 100 sesiones con fechas y marca «Este equipo», y revocación individual de otras sesiones con confirmación. No se guardan ni muestran IP, ubicación, tokens o huellas de dispositivo; se cubre la API con PostgreSQL real en CI.
- Añadida una acción confirmada para revocar todas las demás sesiones, incluida cualquier sesión fuera de las 100 mostradas; el token de este equipo se valida de nuevo dentro de la operación SQL y se mantiene activo.
- Añadida limpieza transaccional al iniciar el servicio y cada hora: PINs de más de 15 minutos, flows/códigos PKCE de más de 24 horas, sesiones revocadas o vencidas e idempotencias de más de 30 días. Las pruebas PostgreSQL comprueban que borra lo antiguo y conserva los registros recientes.
- Los tests de interfaz ahora esperan la resolución real de los módulos lazy antes de interactuar con sus botones, evitando depender de un retardo fijo y corrigiendo falsos fallos en Windows CI.
- Añadida revocación remota de la sesión actual al cerrar cuenta: endpoint autenticado con limitador, invalidación por hash en PostgreSQL y cliente Tauri que borra siempre Credential Manager aunque no haya conexión. La interfaz distingue revocación confirmada de cierre solo local.
- Ampliada la integración PostgreSQL para cubrir registro con Argon2id, verificación de PIN sin inicio de sesión, login nativo PKCE, creación de sesión por hash y uso posterior de sync; el correo se captura en un mailer de prueba y no sale del proceso. El job PostgreSQL de CI pasó.
- La integración PostgreSQL ahora atraviesa Fastify y el almacén real de snapshots: verifica aislamiento por cuenta, lectura/escritura, `ETag`/conflicto, idempotencia y rechazo de campos no permitidos. CI ejecuta esta prueba junto con las migraciones y el rate limit; la integración de login/verificación y el VPS aún quedan pendientes.
- Añadida prueba de integración PostgreSQL aislada: aplica migraciones v1–v5, verifica rate limits, autenticación y restablecimiento con una base efímera en CI. Para correrla localmente, `server` requiere `TEST_DATABASE_URL`.
- El servicio aplica límites persistentes por IP y ruta en PostgreSQL, comparte los contadores entre instancias y guarda solo huellas HMAC de IP. Se limitan auth y snapshots; el exceso recibe `429` con `Retry-After` y el proxy confiable queda restringido a loopback.
- La comprobación al reconectar/volver a primer plano agrupa eventos y se prueba junto a la reanudación. El lector del estado de sync local valida campos obligatorios, contenido, integridad y tamaño antes de usarlo.
- Al recuperar la conexión o volver a la app, se programa una comprobación sincronizada de preferencias; las comprobaciones cercanas se agrupan y la aceptación local de riesgos sigue siendo obligatoria.
- La sincronización queda bloqueada hasta aceptar en este equipo el riesgo de pérdida total del VPS y la lectura de preferencias por su operador. La aceptación protege tanto el flujo automático como las acciones manuales; las claves API siguen excluidas.
- Separada la carga de la terminal, el renderizado Markdown y paneles secundarios: la entrada JavaScript baja de 824 KB a 297 KB; la terminal se sirve en su propio bloque de 336 KB y el Markdown se carga al necesitarlo. Ningún bloque supera 500 KB.
- Mejorado el contraste de etiquetas secundarias de navegación y paneles en ambos modos; pruebas de regresión comparan sus tokens reales con los fondos que usan.
- Mejorado el contraste del texto secundario en modo claro y añadidas regresiones que comprueban ese texto sobre las tres superficies principales de ambos modos.
- Comprobado contraste WCAG AA (4,5:1) del acento como texto en las doce paletas y ambos modos; se oscureció el verde azulado claro para cumplir el umbral.
- El panel Git permite incluir explícitamente el diff en el contexto de chat o agente; aparece como adjunto removible y se muestra en la vista previa antes de enviarlo. El backend limita el tamaño y trata el contenido como dato no confiable.
- El menú general lleva el foco a la primera opción y permite recorrer las acciones con flechas, Inicio y Fin; Escape cierra y devuelve el foco al botón.
- El menú general junto al nombre de Laural ofrece accesos a terminal, proyecto, búsqueda, proveedor, configuración y ayuda; se cierra al pulsar Escape o fuera del menú.
- El menú Más opciones de terminal ofrece accesos rápidos a Git, bloques, asistente, proveedor, copiar selección y limpiar.
- El diálogo de recetas mantiene el foco dentro, permite cerrarlo con Escape y enfoca el formulario al crear o editar.
- Añadida una regresión que verifica la persistencia de recetas propias al cerrar y volver a abrir el panel.
- Los controles de terminal permiten copiar la selección actual y limpiar la pantalla sin ejecutar comandos adicionales.
- La navegación Historial abre una vista filtrada de comandos recientes de la sesión; desde ahí solo se copian, nunca se ejecutan.
- El panel lateral del asistente se puede ocultar y volver a mostrar; la preferencia se conserva en este equipo.
- La paleta de comandos ahora permite recorrer acciones y comandos recientes con las flechas y abrir/copiar con Enter.
- El menú de los tres puntos del perfil local abre configuración, portabilidad y sincronización.
- La paleta `Ctrl+K` incorpora accesos a proyectos, Git, recetas, ayuda y notificaciones.
- El selector del espacio personal ahora muestra su estado local y accesos a proyectos y sincronización.
- Conectados los botones de Ayuda y Notificaciones con sus paneles y acciones correspondientes.
- Añadida la página pública `/status` del servicio, con estado e incidencias desde un documento JSON validado y limitado. La actualización administrativa se hace por SSH mediante archivo persistente; la vista nunca expone errores internos y muestra estado desconocido ante fallos. Aún no está desplegada en el VPS.
- Añadidas recetas de tareas locales y editables para el modo Agente. La vista previa muestra objetivo y pasos; usar una receta solo rellena el compositor. Las recetas no ejecutan comandos, no amplían permisos y no se exportan ni sincronizan.
- Añadido un panel Git local de solo lectura: rama, lista de cambios y diff preparado/no preparado del proyecto abierto. Usa argumentos fijos sin shell, limita proceso y salida, desactiva diff externo/textconv/fsmonitor y no envía contenido al asistente. Pruebas manuales con repositorios reales pendientes.
- El asistente ahora representa Markdown con títulos, listas, tablas, enlaces y código formateado. HTML arbitrario no se ejecuta, los esquemas de enlace se limitan a HTTP(S)/mailto y las imágenes remotas no se cargan.
- Añadida sincronización automática tras guardar tema, modo, proveedor o perfil activo; también al iniciar sesión, al abrir Laural y cada tres horas. Un estado local atómico guarda los snapshots permitidos local/nube, revisión y marca pendiente. Reintenta al volver la conexión y detiene escrituras si otra revisión remota avanzó. Preserva endpoints aceptados desde nube sin re-compartirlos desde este dispositivo; al revocar explícitamente el consentimiento local, quita el endpoint de nube. El servidor sigue sin estar desplegado; falta validar VPS y reconexión/reanudación en Windows.
- Conectado el cliente de escritorio con la API privada de snapshots: consulta `ETag`, escribe con `If-Match` e idempotencia, y no expone la sesión al WebView. Configuración permite comparar, elegir entre equipo/nube y subir por primera vez; aplicar la nube crea antes un `.laural` local sin claves. Las API keys permanecen en Credential Manager y los endpoints no compartidos no se envían. Pendientes auto-sync al guardar, comprobación cada tres horas, cola offline y prueba con VPS habilitado.
- El ejecutor de migraciones ahora es compartido con la integración PostgreSQL: CI comprueba que aplica las cuatro migraciones de forma idempotente antes de probar límites concurrentes. El placeholder del pepper de rate limit ya no pasa la validación; el servicio requiere configurar un secreto real antes de arrancar.
- Añadido el primer servicio privado de snapshots: Fastify, schema v1 cerrado, límite de tamaño, revisión condicional, idempotencia transaccional en PostgreSQL, autenticación mediante hash de sesión y migraciones. Aún no se puede publicar: faltan validación de VPS/Caddy, pruebas PostgreSQL de autenticación, status público operativo y controles de producción.
- Añadido el flujo de registro/verificación por correo, desactivado por defecto: contraseñas Argon2id, PIN aleatorio de seis cifras con HMAC, cinco minutos, cinco intentos y límites de reenvío por cuenta. Resend se configura solo en el servidor; verificar correo no inicia sesión.
- CI incorpora una tarea independiente de Linux para compilar el servicio de sincronización, ejecutar su suite de cobertura y publicar el informe como artefacto.
- Añadida página propia de login en español con contraseña en navegador externo, cookie HttpOnly/CSRF, redirect loopback exacto y canje PKCE de un solo uso. La app abre el navegador, valida `state`, canjea por HTTPS y guarda el token de 30 días solo en Credential Manager; PostgreSQL conserva el hash. Rutas de cuenta desactivadas por defecto.
- Añadido en Configuración el acceso a cuenta: callback IPv4 loopback efímero, comprobación de state en tiempo constante, canje PKCE sin seguir redirecciones y estado de sesión sin exponer el token al frontend. El cierre de sesión ya intenta revocar el token actual y siempre elimina la credencial local.
- Iniciado el contrato v1 compartido para preferencias sincronizables con schema cerrado, fixture común y tipos Rust/TypeScript. Rechaza versiones/campos desconocidos, perfiles duplicados, endpoints no válidos y snapshots mayores de 256 KiB.
- Guardado el tipo de proveedor y el consentimiento opcional por perfil para compartir el endpoint en una futura sincronización; queda desactivado por defecto y los perfiles anteriores conservan sus destinos.
- Añadido el constructor nativo del snapshot v1: incluye tema, apariencia, actualización, proveedor activo y metadatos permitidos. Solo incorpora URLs de perfiles con consentimiento; no consulta ni serializa claves.
- Añadida la primera versión de exportar/importar configuración `.laural` en Configuración, con vista previa y opciones de fusión/reemplazo. Las claves API se excluyen por defecto; al incluirlas, el archivo exige contraseña y usa Argon2id + AES-256-GCM. La importación crea una copia local previa y revierte cambios de claves si falla la aplicación.
- Añadidas regresiones de fallo de escritura de credenciales para comprobar el rollback correcto y la ruta de recuperación si el almacén también falla.
- Endurecido el diseño de exportación/importación: las claves quedan fuera por defecto y solo podrán exportarse con contraseña obligatoria y cifrado autenticado; nunca en texto plano. Documentado el alcance y los límites reales de Credential Manager.
- Añadida paleta `Ctrl+K` para buscar acciones, sesiones y comandos recientes. El historial es efímero y elegir un comando solo lo copia para revisión; no lo ejecuta.
- Verificada la compatibilidad del descubrimiento de modelos con respuestas OpenAI-compatible y Ollama; se ordenan y deduplican los nombres, y se rechazan listas inválidas o vacías.
- Unificadas la preparación del historial y el contexto de chat normal/streaming; una regresión comprueba límites, roles admitidos y etiquetado del contexto como dato no confiable.
- Añadidas regresiones de la aplicación principal para persistencia de tema/modo, disponibilidad de los doce temas, pestañas de shell y orientación de paneles divididos.
- Agrupadas las actualizaciones visuales de salida de terminal en lotes de 33 ms; el contexto queda actualizado inmediatamente y el último lote se muestra al terminar el comando.
- Evitados los renders de los paneles xterm cuando solo se actualizan los bloques de salida; el reinicio conserva una función estable por pestaña.
- Reducido el historial xterm por pestaña de 5.000 a 2.500 líneas; los bloques mantienen los últimos 8.000 caracteres y se conservan hasta 80 bloques. El contexto del asistente mantiene su límite de 24.000 caracteres.
- Configuración incluye un historial local y borrable de actividad del agente con solo tipo de acción, resultado y hora.
- El agente rechaza al recibir el plan los nombres reservados, rutas inválidas de Windows y la carpeta interna de copias; la comprobación se comparte con las operaciones de archivo.
- En Windows, los archivos existentes se mueven a backup y se sustituyen mediante handles con renombrado sin sobrescritura; se fijan los directorios ante cambios concurrentes y se restaura el original si el segundo paso falla y el destino sigue libre.
- Endurecidas la restauración y limpieza de copias en Windows: se fijan los directorios del recorrido; la restauración abre el archivo sin seguir reparse points ni permitir su sustitución mientras se lee.
- El filtro del agente requiere confirmación para comandos habituales de copia, movimiento, truncado y escritura de archivos en Windows y shells tipo Bash.
- Ampliada la revisión obligatoria a comandos habituales que cambian permisos, atributos o crean enlaces simbólicos en Windows y shells tipo Bash.
- Añadida regresión de proveedor que comprueba que una redirección HTTP no reenvía la solicitud autenticada a otro destino.
- La cancelación de chat y planes interrumpe el envío HTTP y la lectura de los cuerpos de respuesta; añadida regresión local con una operación pendiente.
- Añadida prueba local que confirma que el descubrimiento de modelos respeta `Retry-After` y no duplica solicitudes cuando el proveedor pide esperar.
- Mejorada la navegación por teclado de Configuración: el diálogo enfoca el título al abrir y Escape cierra mediante el evento nativo; añadidas pruebas de apertura y cancelación.
- Añadida regresión de cambio entre perfiles que comprueba que la clave en memoria del proveedor anterior no se envía al probar ni guardar el nuevo perfil.
- Añadida prueba de arranque en frío simulado: tema y modo se recuperan del almacenamiento local, y el perfil activo vuelve a cargarse sin rellenar la clave en el formulario.
- Endurecida la autorización del agente para exigir revisión ante alias peligrosos conocidos de PowerShell, ejecución de scripts y lanzadores de shells; Configuración explica que los perfiles personalizados no están aislados.

## 0.1.0-alpha.14

- Consulta de actualizaciones firmadas de GitHub al iniciar y cada seis horas; preferencia de instalación manual o automática, indicador visible, descarga separada de instalación y versión instalada en Configuración.
- Los paquetes NSIS de Windows se verifican con una clave pública integrada antes de instalar. El primer paquete con updater debe instalarse manualmente sobre versiones anteriores a alpha.14.
- Publicación automatizada de releases alpha y manifiesto de actualización firmado para Windows x64.
- Añadidas pruebas de actualización manual, preferencia inicial y progreso de descarga.
- Configuración opcional para conservar 5, 10, 20, 50 o 100 copias recientes por archivo y limpiar las antiguas después de guardar/restaurar; por defecto no se elimina historial.
- La lista de copias se ordena por fecha de creación en vez de por el nombre aleatorio de la carpeta.
- Aplicada CSP local estricta en WebView y retirado el permiso de apertura externa no utilizado.
- Limitadas las respuestas no streaming de proveedores a 2 MB, la exploración de proyectos a 1.000 entradas y 200 archivos, la concurrencia a ocho solicitudes, las escrituras/contexto del terminal a 1 MB y los datos IPC de chat/proveedor.
- Añadidos regresiones para respuestas sobredimensionadas, identificadores/concurrencia y límites del escaneo del proyecto.
- Documentada la primera auditoría, incluidas dependencias con avisos de mantenimiento y riesgos residuales del agente.
- Validar la instalación limpia, actualización y desinstalación de Windows en entornos de usuario.
- Revisar la validación del agente con perfiles y alias personalizados de PowerShell, CMD, WSL y Git Bash.

## 0.1.0-alpha.13

- Las claves de API se guardan y recuperan mediante Windows Credential Manager; se verifica su persistencia antes de confirmar el guardado.
- Los errores al leer credenciales ya no se silencian ni provocan peticiones sin autenticación por accidente.
- Los instaladores MSI y NSIS se generan en español.

## 0.1.0-alpha.12

- El agente aplica una primera validación de operadores según PowerShell, CMD, WSL o Git Bash antes de los modos automático y reglas.
- Se reconocen alias habituales de borrado y escritura para exigir aprobación manual.
- Se generan instaladores MSI y NSIS de Windows x64 y se publican sus sumas SHA-256.

## 0.1.0-alpha.11 y anteriores

- Se pueden listar y restaurar copias anteriores de archivos modificados por el agente; cada restauración respalda el estado actual.
- Añadida limpieza manual confirmada de copias de seguridad por archivo.
- Los cambios del agente se preparan y preservan mediante archivos temporales y copias versionadas; se rechazan rutas de dispositivos y enlaces simbólicos.

## 0.1.0-alpha.7

- Al salir de la aplicación se cierran las sesiones activas aunque haya una escritura en curso. El contexto de salida larga y los bloques comparten un recorte que respeta caracteres Unicode.
- La terminal registra los eventos antes de iniciar el shell, conserva la sesión al ocultar una pestaña y ofrece reiniciar una sesión terminada. Al cerrar una pestaña se libera su contexto.
- La consulta de modelos repite una vez los fallos temporales de conexión o pasarela.
- El chat conserva los caracteres divididos entre paquetes, procesa eventos de varias líneas y avisa si la respuesta está incompleta, vacía, mal formada o supera el límite.

## 0.1.0-alpha.6

- Corregidas las marcas de bloque en Windows PowerShell 5 y Bash, incluida la primera orden de una sesión de PowerShell.
- Cada perfil conserva su URL y sus credenciales. Las reglas del agente autorizan solo líneas completas y el modo automático admite tres consultas de Git.

## 0.1.0-alpha.5

- Centro de configuración local y guías de instalación, preferencias y mantenimiento.

## Alpha.4 y versiones anteriores

- Bloques navegables con comando, salida y código de salida por marcas OSC 133; integración inicial de PowerShell, CMD y Bash/WSL.
- Cancelación del plan del agente, Ctrl+C para el comando activo y corte de acciones automáticas después de un error.
- Vista previa del contenido exacto y recortado de terminal, proyecto y archivos elegidos.
- Respuestas incrementales del chat con cancelación e historial local borrable, limitado a 100 mensajes.
- División de terminal horizontal además de la vertical.
- Bloqueo adicional de operadores de composición y sustitución en comandos del agente.
- Icono propio y workflow de build de Windows para GitHub Actions.
- Hoja de ruta y requisitos actualizados para separar implementación y validación manual.

## 0.1.0 — Prototipo inicial

- Terminal Tauri con PowerShell, CMD, WSL y Git Bash, pestañas y división vertical.
- Configuración de proveedores, descubrimiento de modelos y chat contextual inicial.
- Planificación del agente, políticas iniciales de comandos y cambios de archivo con aprobación.
- Selector de doce paletas, modos claro/oscuro y preferencias locales.
- Sistema visual documentado y accesible desde el panel Apariencia.
- Escritura temporal y reemplazo de archivos aprobados con copia de seguridad por versión.
- Rechazo de nombres de dispositivos y destinos con puntos de reanálisis.
- Paquetes Windows x64 MSI y NSIS; la instalación limpia sigue pendiente de validación.

La versión `0.1.0` es un prototipo de desarrollo, no una release estable.
