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
- Incluye el resultado de las pruebas con cobertura y de las comprobaciones de uso pertinentes.

## Pruebas con cobertura

En Windows, instala el instrumental Rust una vez con `rustup component add llvm-tools-preview` y `cargo install cargo-llvm-cov --version 0.9.1 --locked`. Tras `npm ci` y `npm run build`, ejecuta `npm run test:coverage`. El comando incluye las pruebas Vitest, cuatro pruebas del verificador de umbral y la instrumentación Rust. `npm run test:coverage-policy` ejecuta por separado los casos del verificador; `npm test` mide TypeScript y TSX con Vitest/V8 y `npm run test:rust` instrumenta la biblioteca Rust.

Abre `coverage/index.html` para la interfaz y `src-tauri/target/llvm-cov/html/index.html` para Rust. GitHub Actions publica ambos informes en el artefacto informes-cobertura y falla si la cobertura de líneas de `agent_files.rs`, `configuration_transfer.rs` o `git_panel.rs` baja del 85 %. El verificador también falla si falta un módulo o su cobertura es ambigua o inválida. Interpreta los porcentajes por capa. Las pruebas de instalación, PTY y conexión con proveedores requieren validación adicional.

Cada push y pull request también audita dependencias: `npm audit --audit-level=moderate` para escritorio y servicio, y `cargo audit --deny unsound` para Rust. La excepción Linux de GLib/GTK3 está documentada en el [informe de seguridad](../security/audit-report.md) y debe revisarse antes de publicar para Linux.

## Publicar una release con actualizador

Incrementa la misma versión semántica en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`, actualiza `CHANGELOG.md` y crea una etiqueta `v<versión>`. El workflow `.github/workflows/windows-release.yml` compila NSIS x64, firma los artefactos, crea la release alpha y actualiza `updates/latest.json` en `main`.

El repositorio necesita los secretos `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Para crear una pareja inicial, ejecuta `npm run tauri signer generate -- --write-keys <ruta-fuera-del-repositorio>` y responde al diálogo protegido para definir la contraseña. Fija la clave pública resultante en `tauri.conf.json` y transmite la clave privada/contraseña a `gh secret set` por entrada estándar, sin imprimirlas. No añadas las claves al repositorio, a los logs ni a una incidencia. Conserva una copia de recuperación cifrada: sin la clave privada original no se pueden firmar actualizaciones compatibles con los clientes instalados.

El instalador alpha.14 es el primero con capacidad de autoactualización; los anteriores deben descargar e instalar manualmente esa versión. La firma del updater no sustituye Authenticode ni la comprobación manual de un paquete cuando la fuente de publicación está comprometida.

### Comprobar terminales reales en Windows

Con PowerShell, CMD, Git Bash y una distribución predeterminada de WSL disponibles, ejecuta desde la raíz:

```powershell
cargo llvm-cov --manifest-path src-tauri/Cargo.toml --lib --html -- --include-ignored --nocapture
```

Esta prueba abre una pseudoterminal por shell, cambia su tamaño, espera el prompt, genera 1.500 líneas, verifica que recibe más de 24.000 bytes y la marca de la última línea, y comprueba el código de salida 37. La suite habitual deja esta prueba como opcional porque WSL y Git Bash dependen del equipo.
