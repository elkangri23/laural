# Normas de mantenimiento de Laural

Aplican a todo el repositorio. Escribe el asunto y el cuerpo de los commits en español. Describe la acción y su motivo.

Con cada cambio actualiza la documentación afectada en el mismo commit. Para cambios visibles incluye una entrada en CHANGELOG.md. Mantén el backlog y la hoja de ruta al día al iniciar o cerrar entregas. Registra un ADR para decisiones de arquitectura y conserva el historial de las decisiones anteriores.

Aplica DRY, KISS y YAGNI. Reutiliza los validadores, formularios y tipos del dominio. Separa responsabilidades cuando cambien por motivos distintos. Implementa el comportamiento necesario con la solución más sencilla que lo cubra. Evita plantillas sin uso y capas que solo deleguen.

Revisa los riesgos OWASP aplicables a cada cambio de red, permisos, almacenamiento o dependencias. Documenta amenazas y límites en docs/security. Comprueba las entradas en Rust, limita los permisos Tauri y evita incluir claves, contenido del terminal o archivos de usuario en registros y ejemplos.
Al programar y al probar, ejecuta las pruebas con cobertura de la interfaz y del backend y comunica los porcentajes, el alcance y los fallos. Añade regresiones para el comportamiento modificado.
