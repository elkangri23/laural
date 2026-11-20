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
- El panel espera a sus suscripciones antes de arrancar y coordina el cierre durante el arranque. Las regresiones cubren ocultar y mostrar una sesión y el cierre temprano. El evento de salida de Tauri vacía el registro y termina los procesos aunque la entrada esté ocupada. Probado con CMD real desde el backend. Pendiente validar el cierre desde la ventana instalada.
- Validar bloques de comandos, entrada editada y resultados en PowerShell, CMD, Git Bash y WSL; bash/prompt de usuario pueden sustituir las marcas de integración.
- Probar instalación y desinstalación limpia en Windows 10 y 11.

## M2 — Chat y proveedores (parcial)

- Chat incremental cancelable e historial local borrable implementados.
- Corregida la compilación de `keyring` para usar Windows Credential Manager; la clave se verifica tras guardar. Pendiente probar FreeLLMAPI, Ollama y LM Studio desde una instalación limpia.
- Probar manualmente `/models` y streaming de chat con Ollama, LM Studio, FreeLLMAPI y un endpoint OpenAI-compatible.
- La vista previa del contexto y sus límites de envío están implementados; verificar que coincide con cada proveedor.
- El chat detecta respuestas truncadas o vacías, errores de formato y eventos demasiado grandes. La consulta de modelos reintenta una vez los fallos de conexión y HTTP 502–504 sin Retry-After. Pendiente la validación con proveedores reales.

## M3 — Agente (parcial)

- Planes y estados por acción; modos de autorización configurables.
- Cancelación de generación, interrupción de comando activo y corte del ciclo automático implementados; probar cancelación y resultado en cada shell.
- Implementada una primera validación de operadores por shell y detección de alias de riesgo comunes. Las reglas siguen siendo heurísticas, no aíslan comandos y no interpretan perfiles personalizados.
- Revisar límites de rutas y respaldos bajo condiciones de carrera.
- Registrar acciones localmente sin guardar secretos ni enviar telemetría.

## M4 — Distribución pública (parcial)

- Build de MSI/NSIS disponible localmente; alpha.13 configura MSI `es-ES` y NSIS en español. Pendiente validar ambos instaladores en una instalación limpia.
- Workflow de GitHub Actions ejecutado correctamente en GitHub y artefactos generados.
- Validar instalación limpia, actualización y desinstalación.
- Firma y procedencia verificable dependen de credenciales de publicación que no están configuradas.
- Resolver incidencias críticas de validación manual antes de declarar estable.

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
La interfaz lista las veinte copias recientes de un archivo del agente. Cada restauración respalda primero la versión actual.
M3 aplica ahora filtros de sintaxis por shell en Rust antes de los modos automático y reglas. La aprobación explícita permite composiciones tras revisión humana.
M3 reconoce alias comunes de borrado y escritura en el filtro de comandos que requieren aprobación manual. La validación sigue siendo heurística y no interpreta perfiles personalizados.
La alpha.12 publica instaladores Windows x64. La alpha.13 configura el MSI en `es-ES` y NSIS en español; queda pendiente la instalación limpia y la comprobación visual del idioma.
