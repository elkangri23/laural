# Registro de cambios

## Sin publicar

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
