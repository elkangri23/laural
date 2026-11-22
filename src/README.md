# Laural · src

App.tsx coordina las sesiones y el asistente. `streamingText.ts` mantiene las respuestas del chat por fragmentos y compone una instantánea solo cuando la interfaz la necesita. `terminalOutput.ts` agrupa el contexto y deduplica los IPC de redimensionado. `themes.ts` define las paletas. Los componentes de terminal y configuración están en `components`. La persistencia de perfiles y credenciales se gestiona en el backend.
