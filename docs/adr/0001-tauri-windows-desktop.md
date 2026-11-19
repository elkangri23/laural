# ADR-0001: Aplicación de escritorio con Tauri 2

- Estado: Aceptada
- Fecha: 2026-11-19
- Decisores: Laural contributors

## Contexto

Laural debe integrar terminales nativas de Windows con una interfaz de escritorio y compartir una misma aplicación entre UI y capacidades del sistema sin requerir un runtime de navegador completo empaquetado.

## Decisión

Usar Tauri 2, React y TypeScript para la interfaz, y Rust para capacidades locales. La primera plataforma es Windows x64.

## Alternativas consideradas

- Electron: madura y con un ecosistema extenso; empaqueta Chromium y Node.js, con mayor tamaño y superficie de ejecución para este MVP.
- Aplicación nativa WinUI: acceso directo al entorno Windows, pero requeriría reimplementar UI y aumentaría el coste de soporte multi-shell/UI.
- Aplicación web: no ofrece por sí sola acceso PTY nativo y distribución de escritorio requerida.

## Consecuencias

- Se comparte lógica de interfaz React y se mantiene el backend nativo en Rust.
- WebView2 Runtime es una dependencia de Windows.
- Los comandos Tauri deben exponerse mediante permisos y capacidades limitados.
- La distribución y firma de ejecutables Windows requieren decisiones de release posteriores.
