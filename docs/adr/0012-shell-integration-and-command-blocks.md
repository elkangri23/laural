# ADR-0012: Marcas de shell y bloques de comando

- Estado: aceptado
- Fecha: 2026-11-19

## Contexto

La terminal necesita conocer límites de comandos sin inferirlos a partir de texto de salida, ya que cada shell y prompt puede tener formatos propios.

## Decisión

Laural captura la línea enviada desde xterm y reconoce las secuencias OSC 133 de comienzo de prompt y finalización de comando. En PowerShell envuelve el prompt de la sesión preservando el prompt anterior; en CMD y Bash configura marcas de sesión. Los bloques guardan comando, salida acotada y código de salida cuando está disponible.

## Consecuencias

- El proceso de shell y las modificaciones de prompt son locales a la sesión y no editan perfiles del usuario.
- Ediciones avanzadas de línea pueden hacer que el texto capturado se marque como no disponible.
- Bash/Git Bash/WSL pueden tener scripts de inicio que sobrescriban `PROMPT_COMMAND`; CMD no proporciona código de salida mediante el prompt.
- Los límites se identifican por marcas OSC, no mediante heurísticas sobre el contenido que imprime cada comando.
- Cada shell y perfil personalizado necesita validación manual.
