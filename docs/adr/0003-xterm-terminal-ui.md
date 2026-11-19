# ADR-0003: xterm.js para renderizar terminales

- Estado: Aceptada
- Fecha: 2026-11-19
- Decisores: Laural contributors

## Contexto

La interfaz React necesita representar terminales con secuencias ANSI, cursor, selección, scrollback y redimensionado.

## Decisión

Usar xterm.js con `FitAddon` en cada panel de terminal y conectar los bytes a las sesiones PTY del backend.

## Alternativas consideradas

- Construir un emulador de terminal: costoso y proclive a incompatibilidades con shells y programas de consola.
- Control nativo embebido: aumentaría la dependencia de API específicas de Windows y dificultaría composición con paneles React.

## Consecuencias

- Se obtiene un emulador mantenido y conocido.
- La UI debe respetar el protocolo de terminal y decodificar bytes de salida sin perder secuencias.
- La calidad de fuente, accesibilidad, selección, clipboard y composición de paneles siguen siendo responsabilidad de Laural.
