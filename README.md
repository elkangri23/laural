# Laural

**Un terminal de escritorio para Windows con chat de IA y agentes configurables.** Conecta Ollama, LM Studio o cualquier API compatible con OpenAI; conserva la configuración y las credenciales en tu equipo.

> Proyecto en etapa inicial. El código y los instaladores están disponibles, pero todavía faltan funciones y validación de uso diario. Consulta [el estado y la hoja de ruta](docs/ROADMAP.md).

![Windows](https://img.shields.io/badge/Windows-10%2B-0078D4) ![License](https://img.shields.io/badge/license-MIT-green) ![Status](https://img.shields.io/badge/status-early%20development-orange)

## Qué ofrece

- Terminal con PowerShell, CMD, WSL y Git Bash.
- Pestañas y panel dividido vertical u horizontal.
- Doce temas de color y modos claro/oscuro, con preferencias guardadas localmente.
- Chat contextual con respuesta incremental, historial local borrable, salida reciente de terminal, proyecto abierto y archivos que el usuario elige adjuntar.
- Perfiles para Ollama, LM Studio, FreeLLMAPI y endpoints compatibles con OpenAI.
- Agente que propone comandos y cambios de archivos para revisión. Las políticas permiten confirmar comandos, aplicar reglas o activar el modo automático; las ediciones de archivos requieren aprobación explícita.
- Icono y favicon propios; la compilación para Windows se puede generar desde GitHub Actions al publicar una etiqueta `v*`.
- Aplicación local sin cuenta ni servicio propio. La sincronización está fuera del alcance de la primera versión.

Laural es una implementación independiente con marca e interfaz propias. No incluye código, recursos ni componentes de Warp.

## Descargas

La compilación x64 actual se encuentra en [Releases](https://github.com/elkangri23/laural/releases) cuando haya una versión publicada. En el checkout del desarrollador, los paquetes producidos por Tauri están en `src-tauri/target/release/bundle/`:

- `nsis/Laural_0.1.0_x64-setup.exe`
- `msi/Laural_0.1.0_x64_en-US.msi`

Los instaladores requieren validación manual en una instalación limpia. No se consideran una versión estable.

## Requisitos para desarrollar

- Windows 10 o posterior.
- Node.js 22 o posterior y npm.
- Rust estable con el destino MSVC.
- Microsoft C++ Build Tools y WebView2 Runtime.
- WiX y NSIS se descargan mediante Tauri al generar los instaladores, si no están instalados.
- Git Bash, WSL y los shells que se quieran usar en Laural deben estar instalados por separado.

## Empezar

```powershell
npm install
npm run tauri dev
```

Para generar los recursos web y los instaladores de Windows:

```powershell
npm run build
npm run tauri build
```

Más detalle en [Configuración de desarrollo](docs/development/setup.md).

## Configurar un modelo

Abre **Asistente IA → Conecta tu proveedor** y configura una URL base y un modelo. La aplicación obtiene la lista de modelos desde `/models` y envía mensajes a `/chat/completions`.

Valores habituales:

| Proveedor | URL base predeterminada |
| --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` |
| FreeLLMAPI local | `http://127.0.0.1:31415/v1` |

HTTP solo se acepta para `localhost` o loopback. Los endpoints remotos deben usar HTTPS. Las claves se guardan mediante el almacén de credenciales de Windows; no las añadas a issues, commits, archivos de configuración ni capturas.

## Documentación

- [Índice de documentos](docs/README.md)
- [Visión y alcance](docs/product/vision-and-scope.md)
- [Requisitos funcionales y no funcionales](docs/requirements/README.md)
- [Casos de uso](docs/use-cases/README.md)
- [Arquitectura](docs/architecture/overview.md)
- [Decisiones de arquitectura (ADR)](docs/adr/README.md)
- [Privacidad y modelo de amenazas](docs/security/README.md)
- [Hoja de ruta](docs/ROADMAP.md)
- [Sistema visual](docs/ui/design-system.md)
- [Contribuir](CONTRIBUTING.md)
- [Política de seguridad](SECURITY.md)

## Privacidad y seguridad

Laural no necesita una cuenta ni un backend propio. El contenido de terminal, proyecto y archivos seleccionados se envía al proveedor configurado solo al solicitar chat o un plan de agente; cada proveedor tiene sus propios términos y retención. Revisa el contexto antes de enviarlo.

Las reglas del agente reducen ejecuciones accidentales, pero no son un sandbox. Los comandos se ejecutan con los permisos de la cuenta de Windows y el modelo puede proponer acciones equivocadas. Consulta [el modelo de amenazas](docs/security/threat-model.md) antes de habilitar el modo automático.

## Licencia

Laural se distribuye bajo la licencia [MIT](LICENSE). Las dependencias conservan sus propias licencias.
