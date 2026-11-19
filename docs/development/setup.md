# Configuración de desarrollo

## Entorno

1. Instala Windows 10/11 x64, Node.js 22+ con npm, Rust estable MSVC y Microsoft C++ Build Tools.
2. Instala WebView2 Runtime. Tauri necesita WiX/NSIS para algunos formatos de instalador; el CLI puede descargarlos en el primer empaquetado.
3. Instala PowerShell, WSL y/o Git for Windows según los shells que quieras usar.
4. Clona el repositorio e instala dependencias:

```powershell
git clone https://github.com/elkangri23/laural.git
cd laural
npm install
```

## Desarrollo

```powershell
npm run tauri dev
```

Vite inicia el frontend y Tauri carga el backend Rust. Los cambios de frontend se recargan durante desarrollo; cambios Rust requieren recompilación.

## Compilar

```powershell
npm run build
npm run tauri build
```

Los paquetes aparecen en `src-tauri/target/release/bundle/`. Para generar solo instaladores específicos usa la configuración CLI de Tauri y documenta el comando usado.

## Componentes principales

- Frontend: React, TypeScript, Vite.
- Terminal: xterm.js y FitAddon.
- Shell local: Rust, Tauri 2 y `portable-pty`.
- HTTP: reqwest hacia endpoints OpenAI-compatible.
- Secretos: keyring con almacén nativo de Windows.

## No incluido

WSL, Git Bash, Ollama, LM Studio y proveedores remotos son programas/servicios externos. Laural no los instala ni proporciona claves. La disponibilidad de `/models` o `/chat/completions` depende del proveedor.

## Antes de solicitar un cambio

- Revisa [requisitos](../requirements/README.md), [casos de uso](../use-cases/README.md), [ADR](../adr/README.md) y [modelo de amenazas](../security/threat-model.md).
- Cambios de comportamiento con impacto deben incluir criterios de aceptación y actualizar estos documentos.
- Nunca añadas `.env`, tokens, URLs privadas, proyectos de usuario o dumps de terminal a un commit.
- La suite formal de pruebas todavía no está definida. No presentar la compilación como prueba de comportamiento en runtime.
