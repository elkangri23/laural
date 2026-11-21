# Registro de cambios

## Sin publicar

- Añadida la página pública `/status` del servicio, con estado e incidencias desde un documento JSON validado y limitado. La actualización administrativa se hace por SSH mediante archivo persistente; la vista nunca expone errores internos y muestra estado desconocido ante fallos. Aún no está desplegada en el VPS.
- Añadidas recetas de tareas locales y editables para el modo Agente. La vista previa muestra objetivo y pasos; usar una receta solo rellena el compositor. Las recetas no ejecutan comandos, no amplían permisos y no se exportan ni sincronizan.
- Añadido un panel Git local de solo lectura: rama, lista de cambios y diff preparado/no preparado del proyecto abierto. Usa argumentos fijos sin shell, limita proceso y salida, desactiva diff externo/textconv/fsmonitor y no envía contenido al asistente. Pruebas manuales con repositorios reales pendientes.
- El asistente ahora representa Markdown con títulos, listas, tablas, enlaces y código formateado. HTML arbitrario no se ejecuta, los esquemas de enlace se limitan a HTTP(S)/mailto y las imágenes remotas no se cargan.
- Añadida sincronización automática tras guardar tema, modo, proveedor o perfil activo; también al iniciar sesión, al abrir Laural y cada tres horas. Un estado local atómico guarda los snapshots permitidos local/nube, revisión y marca pendiente. Reintenta al volver la conexión y detiene escrituras si otra revisión remota avanzó. Preserva endpoints aceptados desde nube sin re-compartirlos desde este dispositivo; al revocar explícitamente el consentimiento local, quita el endpoint de nube. El servidor sigue sin estar desplegado; falta validar VPS y reconexión/reanudación en Windows.
- Conectado el cliente de escritorio con la API privada de snapshots: consulta `ETag`, escribe con `If-Match` e idempotencia, y no expone la sesión al WebView. Configuración permite comparar, elegir entre equipo/nube y subir por primera vez; aplicar la nube crea antes un `.laural` local sin claves. Las API keys permanecen en Credential Manager y los endpoints no compartidos no se envían. Pendientes auto-sync al guardar, comprobación cada tres horas, cola offline y prueba con VPS habilitado.
- Añadido el primer servicio privado de snapshots: Fastify, schema v1 cerrado, límite de tamaño, revisión condicional, idempotencia transaccional en PostgreSQL, autenticación mediante hash de sesión y migraciones. Aún no se puede publicar: faltan login/emisión de sesión, rate limits por origen, status público y pruebas con PostgreSQL real.
- Añadido el flujo de registro/verificación por correo, desactivado por defecto: contraseñas Argon2id, PIN aleatorio de seis cifras con HMAC, cinco minutos, cinco intentos y límites de reenvío por cuenta. Resend se configura solo en el servidor; verificar correo no inicia sesión.
- CI incorpora una tarea independiente de Linux para compilar el servicio de sincronización, ejecutar su suite de cobertura y publicar el informe como artefacto.
- Añadida página propia de login en español con contraseña en navegador externo, cookie HttpOnly/CSRF, redirect loopback exacto y canje PKCE de un solo uso. La app abre el navegador, valida `state`, canjea por HTTPS y guarda el token de 30 días solo en Credential Manager; PostgreSQL conserva el hash. Rutas de cuenta desactivadas por defecto.
- Añadido en Configuración el acceso a cuenta: callback IPv4 loopback efímero, comprobación de state en tiempo constante, canje PKCE sin seguir redirecciones y estado de sesión sin exponer el token al frontend. La retirada actual elimina la credencial local; la revocación remota sigue pendiente.
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
