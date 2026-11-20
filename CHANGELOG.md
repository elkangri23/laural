# Registro de cambios

## Sin publicar

- Se pueden listar y restaurar copias anteriores de los archivos modificados por el agente, con confirmación y respaldo del contenido actual.

- El agente prepara los cambios de archivo antes de aplicarlos, preserva versiones anteriores y rechaza rutas de dispositivos y enlaces simbólicos.

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
- Icono/favico propio y workflow de build de Windows para GitHub Actions.
- Hoja de ruta y requisitos actualizados para separar implementación y validación manual.

Los cambios relevantes se anotan por versión. La versión `0.1.0` es un prototipo de desarrollo, no una release estable.

## 0.1.0 — Prototipo inicial

- Terminal Tauri con PowerShell, CMD, WSL y Git Bash.
- Pestañas y división vertical.
- Configuración de proveedores, descubrimiento de modelos y chat contextual inicial.
- Planificación del agente, políticas iniciales de comandos y cambios de archivo con aprobación.
- Selector de doce paletas, modos claro/oscuro y preferencia local.
- Sistema visual documentado y accesible desde el panel Apariencia.
- Paquetes Windows x64 MSI y NSIS generados; falta validación de instalación limpia.
- Escritura temporal y reemplazo de archivos aprobados con copia de seguridad por versión.
- Rechazo de nombres de dispositivos y destinos con puntos de reanálisis.
## Sin publicar

- Se pueden listar y restaurar copias anteriores de los archivos modificados por el agente, con confirmación y respaldo del contenido actual.
- Añade limpieza confirmada de copias de seguridad por archivo.
- Los modos automático y reglas bloquean operadores y expansiones de variables según el shell de la terminal.
- El filtro del agente reconoce alias habituales de borrado y escritura de archivos.
