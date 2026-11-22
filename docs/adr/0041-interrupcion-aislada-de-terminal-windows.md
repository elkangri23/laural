# ADR-0041: Interrumpir comandos de Windows dentro de su sesión ConPTY

- Estado: Aceptada
- Fecha: 2026-11-22
- Decisores: Laural contributors

## Contexto

La terminal envía `Ctrl+C` como el byte `0x03` a ConPTY. El ejemplo oficial MiniTerm de Microsoft también intercepta `Ctrl+C` y escribe `\x03` al pipe de entrada. Ensayos anteriores no detuvieron `ping -t` en CMD con ese byte, al borrar el indicador de línea ni al enviar una tecla por el protocolo privado 9001. Sin embargo, la reproducción nueva con el `shell_command("cmd")` real de Laural, respuesta al sondeo DSR y espera del banner localizado de `ping` confirmó que ETX detiene el comando y permite enviar un `echo` al prompt. Pasó cinco ejecuciones seguidas con el flag Win32 de ConPTY activo. La primera versión de la reproducción usó el cambio de título como señal de inicio; ese evento precede al banner y no demuestra que `ping` ya esté listo para recibir el control. `CTRL_BREAK_EVENT` dirigido al PID tampoco detuvo el comando; enviarlo sin aislar la sesión terminó el proceso de prueba. Un prototipo de `AttachConsole(pid)` seguido de `CTRL_BREAK_EVENT` al grupo 0 también terminó el propio proceso de prueba (`STATUS_CONTROL_C_EXIT`). Un prototipo parcheó temporalmente `portable-pty` para crear el grupo ConPTY con `CREATE_NEW_PROCESS_GROUP`; la señal dirigida al PID de CMD no terminó `ping -t`, y el prompt no volvió. Ese parche se retiró y los procesos se limpiaron.

Windows no permite limitar `CTRL_C_EVENT` a un grupo de procesos. `CTRL_BREAK_EVENT` sí admite un grupo, pero requiere que la sesión cree un grupo de procesos con `CREATE_NEW_PROCESS_GROUP`. Ese flag desactiva la recepción de `CTRL_C_EVENT` en dicho grupo. La implementación actual de `portable-pty` 0.9 crea procesos ConPTY con `EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT` y no expone una opción para añadir flags de creación.

## Decisión

- No enviar `CTRL_C_EVENT` ni `CTRL_BREAK_EVENT` sin aislamiento por sesión; una señal amplia puede interrumpir procesos ajenos.
- No simular “detener comando” terminando el árbol completo de procesos: puede cerrar procesos de fondo y perder el estado del shell.
- Mantener `Ctrl+C` como entrada PTY: el ensayo directo con el comando y prompt de Laural confirma que `0x03` interrumpe `ping` en CMD y conserva la sesión.
- No basar la solución en descubrir el grupo en primer plano mediante `GetConsoleProcessList`: la API solo devuelve PID conectados a la consola y no indica qué proceso/grupo está en primer plano. Microsoft la marca además como no recomendada y sin equivalente VT.
- No cambiar el backend ni emitir señales globales por los fallos anteriores: la regresión PTY nueva cubre CMD ya iniciado, espera el banner de `ping`, envía ETX seguido de un comando centinela y verifica que el prompt responde. La reproducción manual desde el teclado real de la aplicación instalada sigue pendiente.
- Cualquier alternativa debe demostrar que el shell conserva el prompt, que otras terminales permanecen intactas y que el cierre de Laural sigue limpiando procesos. Elegir una versión/fork de `portable-pty` o un backend alternativo solo tras tener esa prueba reproducible.

## Alternativas consideradas

- Enviar `CTRL_C_EVENT` a un grupo: Windows ignora el identificador de grupo para este evento; no garantiza aislamiento.
- Enviar `CTRL_BREAK_EVENT` al proceso/grupo actual: no ha interrumpido el comando en las pruebas existentes y, sin un grupo aislado, puede afectar procesos ajenos.
- Adjuntar Laural a la consola ConPTY y enviar `CTRL_BREAK_EVENT` al grupo 0: el prototipo local terminó el proceso emisor; no es una opción segura.
- Crear un grupo aislado solo para `cmd.exe` y señalar el PID de ese grupo: el evento no detuvo `ping -t`; no identifica necesariamente el grupo del comando en primer plano.
- Terminar descendientes del shell: el árbol de procesos no equivale necesariamente al comando en primer plano y puede incluir trabajo de fondo del usuario.
- Mantener solo el byte `0x03`: es la entrada PTY estándar, pero la prueba de CMD confirmó que no es suficiente para todos los programas en Windows.

## Consecuencias

- El backend PTY interrumpe `ping` en CMD de manera repetible; la ruta física de teclado en la aplicación instalada necesita validación manual antes de cerrar M1.
- La prueba verifica que el comando se detiene, el prompt sigue disponible y el cierre de ConPTY limpia el proceso. La validación manual debe además confirmar que otras terminales permanecen intactas.

## Evidencia / enlaces

- [Roadmap M1](../ROADMAP.md#m1--estabilidad-de-terminal-parcial)
- [Microsoft: grupos de procesos de consola](https://learn.microsoft.com/en-us/windows/console/console-process-groups)
- [Microsoft: flags de creación de procesos](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)
- [Microsoft: GenerateConsoleCtrlEvent](https://learn.microsoft.com/en-us/windows/console/generateconsolectrlevent)
- [Microsoft: señales Ctrl+C y Ctrl+Break](https://learn.microsoft.com/en-us/windows/console/ctrl-c-and-ctrl-break-signals)
- [Microsoft: GetConsoleProcessList](https://learn.microsoft.com/en-us/windows/console/getconsoleprocesslist)
- [Microsoft Terminal: ejemplo MiniTerm que reenvía Ctrl+C como `\x03`](https://github.com/microsoft/terminal/blob/main/samples/ConPTY/MiniTerm/MiniTerm/Terminal.cs)
- `portable-pty` 0.9 local: `src/win/psuedocon.rs`, llamada `CreateProcessW`.
