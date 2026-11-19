# Decisiones de arquitectura (ADR)

Los ADR registran por qué se eligió una opción y qué costes trae. Un ADR aceptado no implica que todos sus detalles estén terminados. Para cambiar una decisión, crea un ADR nuevo que la sustituya y conserva el anterior.

| ADR | Decisión | Estado |
| --- | --- | --- |
| [0001](0001-tauri-windows-desktop.md) | Aplicación de escritorio con Tauri 2 | Aceptada |
| [0002](0002-rust-pty-backend.md) | Backend Rust y `portable-pty` para sesiones de shell | Aceptada |
| [0003](0003-xterm-terminal-ui.md) | xterm.js para dibujar terminales | Aceptada |
| [0004](0004-openai-compatible-providers.md) | API compatible con OpenAI como interfaz inicial de proveedores | Aceptada |
| [0005](0005-windows-credential-storage.md) | Guardar claves en Credential Manager de Windows | Aceptada |
| [0006](0006-agent-plan-and-approval.md) | Planes del agente validados y acciones con controles locales | Aceptada |
| [0007](0007-local-first-no-sync-mvp.md) | Sin cuenta ni sincronización en el MVP | Aceptada |
| [0008](0008-independent-implementation-mit.md) | Implementación independiente y licencia MIT | Aceptada |
| [0009](0009-local-json-profile-storage.md) | Perfiles y política en JSON local, secretos aparte | Aceptada |

## Crear un ADR

Copia [la plantilla](template.md), asigna el siguiente número y registra la decisión antes de implementar un cambio que afecte a arquitectura, privacidad, compatibilidad o formatos persistidos.
