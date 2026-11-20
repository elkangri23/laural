# Configurar Laural

Abre **Configuración** en la barra lateral. Los ajustes pertenecen al equipo actual.

| Sección | Opciones y efecto |
| --- | --- |
| Apariencia | Selecciona una de las doce paletas y el modo claro u oscuro. El cambio se aplica de inmediato. |
| Proveedores y modelos | Selecciona un perfil o crea uno. Elige proveedor, nombre, URL base, modelo y clave si el servidor la exige. Consulta los modelos disponibles y guarda el perfil. El chat usa el proveedor activo. |
| Permisos del agente | Confirmar cada comando pide revisión. Ejecutar reglas permitidas usa comandos completos con coincidencia exacta, uno por línea. Automático admite únicamente `git status`, `git status --short` y `git rev-parse --show-toplevel`. Los cambios de archivos requieren aprobación. |
| Retención de copias | Sin límite conserva todas las versiones (valor predeterminado). Puedes conservar entre 5 y 100 copias recientes por archivo. Al guardar o restaurar ese archivo, las versiones más antiguas se eliminan automáticamente. |
| Historial | Borrar historial del chat elimina la conversación local. La opción se deshabilita durante una operación activa. |

Al probar la conexión, Laural reintenta una vez la consulta de modelos si falla la conexión o el servidor devuelve HTTP 502–504 sin indicar un plazo de espera. El chat requiere un nuevo envío manual si se interrumpe.

Para conectar un servidor local, usa la URL base que muestra el servidor, incluido el prefijo de su API compatible con OpenAI. Si no aparecen modelos, comprueba que el servidor esté iniciado, la dirección y el puerto sean correctos y el perfil tenga la clave correspondiente. Usa HTTPS para un proveedor remoto.

La elección del shell, las divisiones y los archivos adjuntos se hacen en la sesión de trabajo. Usa **Revisar contexto** antes de enviar contenido a un proveedor. Consulta la [política de datos](security/privacy.md).

Cada perfil guardado conserva su URL base. Para cambiar de servidor, crea otro perfil e introduce la clave correspondiente.
Las reglas no permiten operadores ni expansión de variables del shell. Escribe cada orden simple como una entrada independiente; las composiciones requieren aprobación manual.
