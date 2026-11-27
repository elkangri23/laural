# Laural

**Un terminal de escritorio para Windows con chat de IA y agentes configurables.** Conecta Ollama, LM Studio o cualquier API compatible con OpenAI; conserva la configuración y las credenciales en tu equipo.

> Proyecto en etapa inicial. El código y los instaladores están disponibles, pero todavía faltan funciones y validación de uso diario. Consulta [el estado y la hoja de ruta](docs/ROADMAP.md).

![Windows](https://img.shields.io/badge/Windows-10%2B-0078D4) ![License](https://img.shields.io/badge/license-MIT-green) ![Status](https://img.shields.io/badge/status-early%20development-orange)

## Qué ofrece

- Terminal con PowerShell, CMD, WSL y Git Bash.
- Sugerencias inline locales opcionales de PSReadLine para nuevas sesiones PowerShell; desactivadas por defecto y sin enviar el historial a la IA.
- Pestañas, bloques navegables de comando/salida y panel dividido vertical u horizontal.
- Panel Git de solo lectura con rama, cambios y diff preparado/no preparado. Está acotado por tamaño/tiempo y no envía el contenido al asistente automáticamente.
- Recetas de tareas para el modo Agente: plantillas locales editables con vista previa que preparan instrucciones; el plan requiere envío y conserva las aprobaciones actuales.
- Paleta con `Ctrl+K` para buscar acciones, sesiones y comandos recientes; el historial dura solo la sesión y los comandos se copian para revisarlos antes de pegarlos.
- Doce temas de color y modos claro/oscuro, con preferencias guardadas localmente.
- Chat contextual con respuesta incremental y Markdown formateado (listas, tablas, enlaces y código), historial local borrable, vista previa del contexto, salida reciente de terminal, proyecto abierto y archivos elegidos. Los bloques de comandos compatibles ofrecen prepararlos en el shell activo; el usuario revisa la línea y pulsa Enter para ejecutarla.
- Perfiles para Ollama, LM Studio, FreeLLMAPI y endpoints compatibles con OpenAI.
- Cuenta opcional para sincronizar preferencias: email, passkeys y TOTP integrados; el servicio incorpora Google OIDC/PKCE detrás de flag. Las credenciales reales de Google y el VPS todavía requieren configuración y validación.
- Agente que propone comandos y cambios de archivos para revisión. Las políticas permiten confirmar comandos, aplicar reglas o activar el modo automático; se puede cancelar la planificación, detener comandos en ejecución y las ediciones de archivos requieren aprobación explícita.
- Icono y favicon propios; la compilación para Windows se puede generar desde GitHub Actions al publicar una etiqueta `v*`.
- Actualizaciones Windows firmadas desde GitHub, con instalación manual o automática y versión visible en Configuración.
- Configuración organizada en cinco apartados: Personalización, IA, Agente y terminal, Datos y cuenta, y Aplicación; navegación por teclado y accesos de retorno entre diálogos.
- Interfaz con selector español/inglés. La traducción sigue en curso; los permisos del agente, las reglas, advertencias de seguridad, encabezados de Ajustes y estado de carga de la terminal ya usan el idioma elegido.
- La app funciona sin cuenta ni servicio. Permite exportar/importar `.laural` con vista previa; la versión v2 incluye el idioma, lee archivos v1 conservando el idioma local y las claves se excluyen por defecto o se incluyen cifradas con contraseña. La sincronización del cliente también emite snapshots v2 y lee v1/v2; si el servicio VPS aún solo admite v1, conserva la configuración local y deja la sincronización pendiente. Antes de publicar esta versión hay que desplegar y validar el servicio v2 en el VPS. Configuración también ofrece historial cloud paginado, restauración como nueva revisión y borrado de versiones. Las claves API quedan excluidas de la nube. Consulta el [diseño aprobado](docs/designs/sincronizacion-preferencias-y-portabilidad.md), el [plan de implementación](docs/plans/sincronizacion-preferencias.md), el [plan de idiomas y snapshot v2](docs/plans/implementacion-ajustes-idiomas.md) y el [estado técnico del servicio](server/README.md).
- Las claves de proveedor se guardan en Windows Credential Manager, no en el archivo de perfiles. Consulta [privacidad y seguridad](docs/security/privacy.md).

Laural es una implementación independiente con marca e interfaz propias. No incluye código, recursos ni componentes de Warp.

## Descargas

La pre-release `0.1.0-alpha.17` para Windows x64 está disponible en [Releases](https://github.com/elkangri23/laural/releases/tag/v0.1.0-alpha.17). El instalador NSIS está firmado para el actualizador; el manifiesto también está firmado y el asset `SHA256SUMS.txt` contiene la suma del instalador. En el checkout del desarrollador, los paquetes producidos por Tauri están en `src-tauri/target/release/bundle/`:

- `nsis/Laural_0.1.0-alpha.17_x64-setup.exe`
- `msi/Laural_0.1.0-alpha.17_x64_es-ES.msi`

SHA-256 del instalador NSIS: `B965085B9EB6F193DBFE19BF1FB847FD1D179D0FB909EB791D7D62980A3B1DF8`. Desde alpha.14, los paquetes NSIS incorporan actualizaciones firmadas; las versiones anteriores requieren instalar alpha.14 manualmente. Alpha.17 incluye instalador firmado, `latest.json` firmado y `SHA256SUMS.txt`. En Windows, alpha.16 detecta alpha.17 y el modo manual descarga el instalador hasta dejarlo listo para instalar. Las regresiones cubren ambos modos; falta completar la instalación interactiva, probar el modo automático y validar instalación limpia y desinstalación. No se considera una versión estable.

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
- [Servicio de sincronización (estado y desarrollo)](server/README.md)
- [Decisiones de arquitectura (ADR)](docs/adr/README.md)
- [Privacidad y modelo de amenazas](docs/security/README.md)
- [Hoja de ruta](docs/ROADMAP.md)
- [Sistema visual](docs/ui/design-system.md)
- [Contribuir](CONTRIBUTING.md)
- [Política de seguridad](SECURITY.md)
- [Sincronización de preferencias: estado, privacidad y tareas](docs/plans/sincronizacion-preferencias.md)

## Privacidad y seguridad

Laural no necesita una cuenta ni un backend propio. El contenido de terminal, proyecto y archivos seleccionados se envía al proveedor configurado solo al solicitar chat o un plan de agente; cada proveedor tiene sus propios términos y retención. Revisa el contexto antes de enviarlo.

Las reglas del agente reducen ejecuciones accidentales, pero no son un sandbox. Los comandos se ejecutan con los permisos de la cuenta de Windows y el modelo puede proponer acciones equivocadas. Consulta [el modelo de amenazas](docs/security/threat-model.md) antes de habilitar el modo automático.

## Licencia

Laural se distribuye bajo la licencia [MIT](LICENSE). Las dependencias conservan sus propias licencias.

## Guías de uso y mantenimiento

[Instalación](docs/instalacion.md) · [Configuración](docs/configuracion.md) · [Backlog](docs/BACKLOG.md) · [Hoja de ruta](docs/ROADMAP.md) · [Decisiones de arquitectura](docs/adr/README.md) · [Casos de uso](docs/use-cases/README.md)
Las [instrucciones de pruebas con cobertura](docs/development/setup.md#pruebas-con-cobertura) explican cómo obtener los informes y el umbral CI de líneas para módulos Rust críticos.
