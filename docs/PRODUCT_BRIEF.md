# Brief de producto: Laural

## Objetivo

Crear una aplicación de terminal open source para Windows con chat contextual y agente, usando una implementación, una marca y recursos propios. Distribuir bajo MIT.

## Alcance acordado

- Windows primero; PowerShell, CMD, WSL y Git Bash.
- Interfaz cuidada con 12 temas de color seleccionables y modos claro/oscuro.
- Terminal con pestañas, bloques de comandos y paneles divididos.
- Chat con salida del terminal, archivos seleccionados y el proyecto abierto como fuentes de contexto.
- Agente que propone comandos y cambios de archivo; el usuario controla la ejecución.
- Modos de autorización: confirmar acción, reglas configurables y automático explícito, con límites de riesgo.
- Ollama, LM Studio y API OpenAI-compatible, incluyendo FreeLLMAPI.
- Operación sin cuenta ni backend obligatorio.
- Código y un instalador para Windows.
- Sincronización de configuración y proveedores diferida.

## Requisitos de privacidad y seguridad

- Guardar claves en el almacén protegido de Windows.
- Mostrar plan y resultado de acciones del agente.
- Mantener escrituras de archivo bajo aprobación explícita.
- Limitar alcance de archivos al proyecto y conservar respaldos de archivos existentes.
- Enviar solo el contexto necesario al proveedor que el usuario configuró, tras acción explícita de enviar.
- Tratar modo automático como comodidad con riesgo, no como sandbox.
- Si se añade sincronización, diseñar consentimiento, cifrado y recuperación aparte.

## Decisiones arquitectónicas

Tauri 2, React/TypeScript, backend Rust con `portable-pty`, xterm.js, protocolo de chat OpenAI-compatible y almacenamiento local JSON más Windows Credential Manager. Consulta [los ADR](adr/README.md).

## Estado del prototipo

- Tauri, UI propia en español, xterm.js y sesiones PTY para los cuatro shells.
- Pestañas, una vista dividida vertical y apertura de carpeta/proyecto.
- Selector local de 12 temas, modo claro/oscuro persistente e interfaz tipográfica más legible.
- Perfiles múltiples, descubrimiento de modelos, claves en Credential Manager y chat sin streaming con contexto acotado.
- Plan de agente, modos de confirmación/reglas/política automática y edición de archivo con aprobación.
- Los bloqueos de riesgo son heurísticos; cancelar agentes, reglas por directorio, bloques, historial, chat persistente y streaming siguen pendientes.
- Compilación de Windows x64 generó MSI y NSIS. La instalación limpia y pruebas manuales siguen pendientes.
- FreeLLMAPI se comprobó usando `/v1/models` y una solicitud mínima a `/v1/chat/completions`; la clave no se guardó en el proyecto.
- La inspección de Warp solo confirmó el objetivo instalado. No se reutilizaron código, recursos ni análisis para implementar Laural.

## Secuencia sugerida

1. Validar instalación y ciclo de vida de terminales en Windows limpio.
2. Completar bloques, historial de comandos y cancelación.
3. Añadir streaming y persistencia local de chats con borrado explícito.
4. Revisar límites del agente y mejorar feedback por acción.
5. Firmar y automatizar releases.
6. Evaluar sincronización opcional después del MVP.
