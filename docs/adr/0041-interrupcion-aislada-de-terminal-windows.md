# ADR-0041: Interrumpir comandos de Windows dentro de su sesión ConPTY

- Estado: Aceptada
- Fecha: 2026-11-22
- Decisores: Laural contributors

## Contexto

La terminal envía `Ctrl+C` como el byte `0x03` a ConPTY. La prueba local mostró que `ping -t` en CMD no se detenía con ese byte, al borrar el indicador de línea ni al enviar la tecla por el protocolo privado 9001. `CTRL_BREAK_EVENT` dirigido al PID tampoco detuvo el comando; enviarlo sin aislar la sesión terminó el proceso de prueba. Ninguno de esos experimentos se conserva como solución.

Windows no permite limitar `CTRL_C_EVENT` a un grupo de procesos. `CTRL_BREAK_EVENT` sí admite un grupo, pero requiere que la sesión cree un grupo de procesos con `CREATE_NEW_PROCESS_GROUP`. Ese flag desactiva la recepción de `CTRL_C_EVENT` en dicho grupo. La implementación actual de `portable-pty` 0.9 crea procesos ConPTY con `EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT` y no expone una opción para añadir flags de creación.

## Decisión

- No enviar `CTRL_C_EVENT` ni `CTRL_BREAK_EVENT` sin aislamiento por sesión; una señal amplia puede interrumpir procesos ajenos.
- No simular “detener comando” terminando el árbol completo de procesos: puede cerrar procesos de fondo y perder el estado del shell.
- Mantener `Ctrl+C` como entrada PTY hasta implementar y probar una señal acotada a la sesión ConPTY seleccionada.
- Antes de cambiar el backend, realizar una prueba técnica que pueda crear cada shell con `CREATE_NEW_PROCESS_GROUP`, conectarse de forma segura a su consola y dirigir `CTRL_BREAK_EVENT` al grupo de esa sesión. Elegir una versión/fork de `portable-pty` o un backend alternativo solo después de demostrar el aislamiento y el comportamiento en CMD, PowerShell, Git Bash y WSL.

## Alternativas consideradas

- Enviar `CTRL_C_EVENT` a un grupo: Windows ignora el identificador de grupo para este evento; no garantiza aislamiento.
- Enviar `CTRL_BREAK_EVENT` al proceso/grupo actual: no ha interrumpido el comando en las pruebas existentes y, sin un grupo aislado, puede afectar procesos ajenos.
- Terminar descendientes del shell: el árbol de procesos no equivale necesariamente al comando en primer plano y puede incluir trabajo de fondo del usuario.
- Mantener solo el byte `0x03`: es la entrada PTY estándar, pero la prueba de CMD confirmó que no es suficiente para todos los programas en Windows.

## Consecuencias

- La interrupción fiable de CMD sigue abierta; el producto no debe presentarla como resuelta.
- La siguiente tarea de implementación es un prototipo aislado, no un cambio de señal global en producción.
- La prueba debe verificar que el comando activo se detiene, el prompt del shell sigue disponible, otras terminales permanecen intactas y el cierre de Laural sigue limpiando procesos.

## Evidencia / enlaces

- [Roadmap M1](../ROADMAP.md#m1--estabilidad-de-terminal-parcial)
- [Microsoft: grupos de procesos de consola](https://learn.microsoft.com/en-us/windows/console/console-process-groups)
- [Microsoft: flags de creación de procesos](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)
- [Microsoft: GenerateConsoleCtrlEvent](https://learn.microsoft.com/en-us/windows/console/generateconsolectrlevent)
- [Microsoft: señales Ctrl+C y Ctrl+Break](https://learn.microsoft.com/en-us/windows/console/ctrl-c-and-ctrl-break-signals)
- `portable-pty` 0.9 local: `src/win/psuedocon.rs`, llamada `CreateProcessW`.
