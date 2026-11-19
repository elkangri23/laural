# Hoja de ruta

Estado al 19 de noviembre de 2026. «Implementado» describe código presente; «validación pendiente» señala que hace falta ejecutar y comprobar el flujo en Windows.

## M0 — Esqueleto de producto (implementado; validación de uso pendiente)

- Tauri 2, React/TypeScript y backend Rust.
- PowerShell, CMD, WSL y Git Bash, pestañas y división de dos terminales vertical u horizontal.
- Perfiles locales, descubrimiento de modelos y chat contextual con streaming y cancelación.
- Doce temas de color, modo claro/oscuro y preferencias locales.
- Planes de agente, modos revisar/reglas/automático y aprobación explícita para cambios de archivos.
- Icono y favicon propios; build de Windows automatizable desde GitHub Actions.
- README, arquitectura, requisitos, ADR, casos de uso y documentación de contribución.

## M1 — Estabilidad de terminal (pendiente)

- Validar el inicio, cierre, reinicio, redimensionamiento y salida larga en los cuatro shells.
- Revisar ciclo de vida de PTY al cambiar paneles, cerrar pestañas y cerrar la app.
- Validar bloques de comandos, entrada editada y resultados en PowerShell, CMD, Git Bash y WSL; bash/prompt de usuario pueden sustituir las marcas de integración.
- Probar instalación y desinstalación limpia en Windows 10 y 11.

## M2 — Chat y proveedores (parcial)

- Chat incremental cancelable e historial local borrable implementados.
- Probar manualmente `/models` y streaming de chat con Ollama, LM Studio, FreeLLMAPI y un endpoint OpenAI-compatible.
- La vista previa del contexto y sus límites de envío están implementados; verificar que coincide con cada proveedor.
- Gestionar errores de formato, límites del proveedor y reintento de conexión.

## M3 — Agente (parcial)

- Planes y estados por acción; modos de autorización configurables.
- Cancelación de generación, interrupción de comando activo y corte del ciclo automático implementados; probar cancelación y resultado en cada shell.
- Añadir análisis de riesgo por shell; las reglas actuales son heurísticas y no aíslan comandos.
- Revisar límites de rutas y respaldos bajo condiciones de carrera.
- Registrar acciones localmente sin guardar secretos ni enviar telemetría.

## M4 — Distribución pública (parcial)

- Build de MSI/NSIS disponible localmente y workflow para GitHub Actions.
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
