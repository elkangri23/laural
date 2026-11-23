# ADR-0051: Control de flujo de salida PTY con créditos

- Estado: aceptada; implementada localmente.
- Fecha: 2026-11-23

## Contexto

Agrupar salida PTY en lotes reduce escrituras y decodificaciones, pero no limita lo que el backend puede enviar si xterm o el WebView consumen más despacio. El búfer interno de xterm tiene un límite de descarte; depender de él podría perder salida y el backend no conoce el ritmo de consumo.

## Decisión

- Cada sesión PTY mantiene un contador de bytes emitidos y aún no confirmados, con una ventana máxima de 256 KiB.
- El hilo lector reserva el tamaño del siguiente fragmento, de hasta 32 KiB, antes de emitirlo. Si no hay créditos suficientes, espera en una condición y deja que el búfer del PTY aplique presión al proceso shell.
- La interfaz confirma el número de bytes agregado al terminar el callback de `xterm.write`. Una confirmación nula, superior a los pendientes o posterior al cierre se rechaza.
- Un error al emitir revierte la reserva. Cerrar o destruir la sesión marca el flujo cerrado y despierta al lector antes de terminar el proceso.
- La ventana y el tamaño de lectura son límites por terminal; no se impone un bloqueo global entre terminales.

## Consecuencias y límites

- La cola de eventos y bytes no confirmados queda acotada por terminal; además, el hilo lector puede retener como máximo un fragmento de 32 KiB mientras espera créditos.
- Si xterm deja de procesar salida, el shell puede bloquearse por backpressure hasta que se cierre la terminal. Esto conserva la salida ya leída y evita crecimiento ilimitado de memoria.
- El ACK confirma que xterm procesó los bytes, no que el usuario los haya visto en pantalla ni que el navegador los haya persistido.

## Verificación

- Pruebas Rust comprueban que ACK libera al lector, que valores inválidos se rechazan y que el cierre despierta al hilo bloqueado.
- Pruebas de componente verifican que la interfaz confirma bytes después del callback de xterm y que el total confirmado coincide con la salida agrupada.
- `terminal_flow.rs` queda protegido por el gate de CI de 85 % de cobertura de líneas.

## Referencias

- [ADR-0002: backend Rust y PTY](0002-rust-pty-backend.md)
- [ADR-0003: xterm.js](0003-xterm-terminal-ui.md)
