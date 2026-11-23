# Laural · src-tauri

src/lib.rs gestiona sesiones PTY y registra las operaciones Tauri. src/providers.rs contiene perfiles, peticiones HTTP y operaciones del agente. Consulta el [modelo de amenazas](../docs/security/threat-model.md) antes de ampliar permisos.

## Prueba manual de carga PTY en Windows

La prueba `carga_concurrente_de_salida_en_el_limite_de_terminales` abre 16 sesiones CMD mediante el mismo `shell_command` y ConPTY que usa la app. Cada sesión emite 1.000 líneas; verifica la marca final, la salida identificable y que no se crucen datos entre sesiones. Es intencionalmente ignorada en la suite habitual porque inicia 16 procesos interactivos.

Para ejecutarla explícitamente desde la raíz del repositorio:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib carga_concurrente_de_salida_en_el_limite_de_terminales -- --ignored --nocapture
```

La duración y el caudal impresos son una medida del harness de ConPTY y CMD, no del renderizado, IPC ni consumo de la aplicación completa.
