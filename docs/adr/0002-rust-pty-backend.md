# ADR-0002: Backend Rust y `portable-pty` para shells

- Estado: Aceptada
- Fecha: 2026-11-19
- Decisores: Laural contributors

## Contexto

PowerShell, CMD, WSL y Git Bash necesitan una sesión interactiva real, con entrada, salida, redimensionado y cierre desde la aplicación.

## Decisión

Gestionar una sesión PTY desde Rust mediante `portable-pty`. Abrir el ejecutable instalado por el usuario y transferir entrada/salida a la UI como datos de terminal.

## Alternativas consideradas

- Ejecutar comandos con `std::process::Command` sin PTY: no admite una experiencia interactiva fiable.
- Implementar bindings directos a ConPTY: ofrece control nativo, pero añade código específico de Windows y más mantenimiento.
- Ejecutar un shell en un servidor local: añade procesos y protocolo sin beneficio necesario para el MVP.

## Consecuencias

- Los shells deben estar instalados en el equipo.
- El proceso hijo tiene los permisos del usuario que ejecuta Laural; no queda aislado.
- Se deben manejar salidas de proceso, buffers, redimensionado y limpieza de sesiones con cuidado.
- `portable-pty` reduce el código de plataforma, pero su compatibilidad debe validarse con las versiones de Windows objetivo.
