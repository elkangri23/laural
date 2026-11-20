# Hoja de ruta

Estado al 20 de noviembre de 2026. «Implementado» describe código presente; «validación pendiente» señala que hace falta ejecutar y comprobar el flujo en Windows.

## M0 — Esqueleto de producto (implementado; validación de uso pendiente)

- Tauri 2, React/TypeScript y backend Rust.
- PowerShell, CMD, WSL y Git Bash, pestañas y división de dos terminales vertical u horizontal.
- Perfiles locales, descubrimiento de modelos y chat contextual con streaming y cancelación.
- Doce temas de color, modo claro/oscuro y preferencias locales.
- Planes de agente, modos revisar/reglas/automático y aprobación explícita para cambios de archivos.
- Icono y favicon propios; build de Windows automatizable desde GitHub Actions.
- README, arquitectura, requisitos, ADR, casos de uso y documentación de contribución.

## M1 — Estabilidad de terminal (parcial)

- Prueba manual de PTY superada en PowerShell, CMD, Git Bash y WSL Ubuntu: entrada, redimensionamiento, recepción de las 1.500 líneas y código de salida 37. El reinicio y la comprobación de bloques en la interfaz instalada siguen pendientes.
- Las regresiones de interfaz comprueban la captura de comandos, marcadores OSC de bloques/código de salida y líneas editadas en el shell. Se abrió el ejecutable local, pero la automatización de Windows no pudo activar su ventana tras dos intentos; siguen pendientes la revisión visual de bloques, interrupción, cierre y reinicio desde la ventana instalada.
- El panel espera a sus suscripciones antes de arrancar y coordina el cierre durante el arranque. Las regresiones cubren ocultar y mostrar una sesión y el cierre temprano. El evento de salida de Tauri vacía el registro y termina los procesos aunque la entrada esté ocupada. Probado con CMD real desde el backend. Pendiente validar el cierre desde la ventana instalada.
- Validar bloques de comandos, entrada editada y resultados en PowerShell, CMD, Git Bash y WSL; bash/prompt de usuario pueden sustituir las marcas de integración.
- Probar instalación y desinstalación limpia en Windows 10 y 11.

## M2 — Chat y proveedores (parcial)

- Chat incremental cancelable e historial local borrable implementados.
- Corregida la compilación de `keyring` para usar Windows Credential Manager; la clave se verifica tras guardar. En la comprobación local del 20 de noviembre de 2026 no había Ollama en `11434` ni LM Studio en `1234`; FreeLLMAPI en `31415` respondió `401` a una consulta sin autenticación. No se envió una clave. Pendiente configurar un proveedor de prueba y validar desde la aplicación.
- Probar manualmente `/models` y streaming de chat con Ollama, LM Studio, FreeLLMAPI y un endpoint OpenAI-compatible. La sonda local sin credenciales solo confirmó que Ollama/LM Studio no estaban activos y que FreeLLMAPI exige autenticación; no cuenta como prueba funcional del proveedor.
- Añadida regresión local que confirma que el cliente rechaza redirecciones HTTP del proveedor, para no enviar credenciales/contexto a otro destino. Las pruebas con proveedores instalados siguen pendientes.
- La vista previa del contexto y sus límites de envío están implementados; verificar que coincide con cada proveedor.
- El chat detecta respuestas truncadas o vacías, errores de formato y eventos demasiado grandes. La consulta de modelos reintenta una vez los fallos de conexión y HTTP 502–504 sin Retry-After. Pendiente la validación con proveedores reales.

## M3 — Agente (parcial)

- Planes y estados por acción; modos de autorización configurables. El validador de rutas ahora se comparte entre la vista previa del plan y las operaciones de archivo; los nombres reservados de Windows y la carpeta interna se rechazan antes de presentar el plan.
- Cancelación de generación, interrupción de comando activo y corte del ciclo automático implementados; probar cancelación y resultado en cada shell.
- Implementada una primera validación de operadores por shell y detección de alias y operaciones comunes de borrado, copia, movimiento, truncado y escritura. Las reglas siguen siendo heurísticas, no aíslan comandos y no interpretan perfiles personalizados.
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

- Sincronización opcional de configuración y proveedores, diferida según decisión del producto. No sincronizar secretos sin cifrado de extremo a extremo, consentimiento, revocación y recuperación documentados.
- Evaluar otras plataformas tras acordar estrategia de PTY, credenciales y empaquetado.

## No planificado para el MVP

Backend obligatorio, cuentas de usuario, monetización, telemetría por defecto, distribución de modelos y sandbox propio.

El centro de configuración está implementado en el código posterior a alpha.4. Consulta el [backlog con criterios de cierre](BACKLOG.md).

M2 y M3 incorporan vinculación del perfil a su URL y un conjunto acotado de consultas automáticas de Git. Consulta el backlog para el estado de validación.
M1: prueba de PTY real superada en los cuatro shells locales el 20 de noviembre de 2026. La prueba que queda ignorada por defecto en CI se ejecutó explícitamente y pasó; la comprobación visual de bloques en la ventana de Laural sigue pendiente.
La interfaz y el backend disponen de informes automáticos de cobertura en cada push y pull request.
M3 incorpora escritura temporal, reemplazo con backup por versión, creación exclusiva y pruebas de archivo bloqueado y aprobaciones concurrentes. La interfaz permite restaurar y limpiar copias manualmente con confirmación. La retención automática configurable continúa pendiente.
La interfaz lista las veinte copias más recientes por fecha. La retención automática por archivo es optativa y está implementada; su valor inicial conserva todas las versiones.
M3 aplica ahora filtros de sintaxis por shell en Rust antes de los modos automático y reglas. La aprobación explícita permite composiciones tras revisión humana.
M3 reconoce alias comunes de borrado y escritura en el filtro de comandos que requieren aprobación manual. La validación sigue siendo heurística y no interpreta perfiles personalizados.
La alpha.12 publica instaladores Windows x64. La alpha.13 configura el MSI en `es-ES` y NSIS en español; queda pendiente la instalación limpia y la comprobación visual del idioma.
