# ADR-0021: Paleta de acciones y comandos recientes solo en sesión

## Estado

Aceptada e implementada inicialmente.

## Contexto

La app necesita acceso rápido a acciones y una forma de reutilizar comandos enviados previamente. Guardar comandos en disco podría conservar tokens, rutas privadas u otros datos que el usuario escribió en la terminal.

## Decisión

Ofrecer una paleta accesible con `Ctrl+K` (y `Cmd+K` en teclados Apple), búsqueda de acciones y comandos recientes, y navegación entre sesiones. El historial utiliza memoria de la sesión y está limitado a 100 elementos. Seleccionar un comando lo copia al portapapeles cuando está disponible; el usuario lo revisa y lo pega. La paleta nunca lo ejecuta directamente.

## Consecuencias

- Los comandos no se escriben en `localStorage`, configuración, registro de actividad ni sincronización.
- El historial se pierde al cerrar la aplicación; comandos de pestañas cerradas se conservan hasta ese momento.
- El portapapeles queda bajo control del sistema operativo y puede ser leído por otras aplicaciones con acceso al portapapeles.
- La paleta muestra que la ejecución no ocurre desde ella.
- Las líneas editadas que el shell no permite capturar no se almacenan.
