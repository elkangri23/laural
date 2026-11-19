# Hoja de ruta

El orden refleja dependencias del MVP. Las fechas se fijarán cuando se acuerde un ritmo de contribución. Cada hito necesita criterios de aceptación y una validación manual en Windows.

## M0 — Esqueleto de desarrollo (actual)

- Tauri 2, React/TypeScript y backend Rust.
- PowerShell, CMD, WSL y Git Bash, pestañas y una división vertical.
- Perfiles, descubrimiento de modelos, chat contextual sin streaming.
- Doce temas de color, modo claro/oscuro y preferencia local.
- Tamaños de texto ampliados; falta revisión visual de contraste en los doce temas y ambos modos.
- Planes del agente, políticas iniciales y escritura de archivo con aprobación.
- README, arquitectura, requisitos, ADR, casos de uso y contribución.
- Compilación MSI y NSIS ejecutada; instalación real no verificada.

## M1 — Estabilidad de terminal

- Probar arranque, cierre, reinicio, resize y salida larga en los cuatro shells.
- Corregir ciclo de vida de PTY y problemas de tabuladores/paneles.
- Bloques de comandos y navegación de salida.
- Instalación/desinstalación limpia en Windows 10 y 11.

## M2 — Chat y proveedores

- Streaming cancelable con manejo de respuesta parcial.
- Validación de contratos Ollama, LM Studio y OpenAI-compatible remoto.
- Vista previa clara del contexto que se enviará.
- Historial local opcional y controles para borrar conversaciones.

## M3 — Agente

- Mostrar autorización, modo aplicado y resultado por acción.
- Mejorar política de riesgos y añadir controles de detener.
- Revisar límites de rutas y respaldos bajo condiciones de carrera.
- Registrar acciones localmente sin guardar secretos ni enviar telemetría.

## M4 — Distribución pública

- Firma de instalador y procedencia de release.
- Build reproducible desde GitHub Actions para Windows x64.
- Instrucciones de actualización, checksum y notas de versión.
- Resolver incidencias críticas de la validación manual.

## Después del MVP

- Evaluar sincronización opcional de configuración y perfiles. No sincronizar secretos sin cifrado extremo a extremo, consentimiento, revocación y recuperación documentados.
- Evaluar otras plataformas solo después de acordar estrategia de PTY, credenciales y empaquetado.

## No planificado

Backend obligatorio, cuentas de usuario, monetización, telemetría por defecto, distribución de modelos y sandbox propio en la primera versión.
