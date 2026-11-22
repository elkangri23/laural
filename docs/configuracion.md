# Configurar Laural

Abre **Configuración** en la barra lateral. Los ajustes pertenecen al equipo actual.

La versión actual incluye **Importar y exportar configuración** sin cuenta y **Cuenta y sincronización**. Con una sesión válida, puedes comparar snapshots sin mostrar diferencias, subir la configuración local inicial o elegir cuál conservar. Tras acordar la línea base, Laural sincroniza automáticamente preferencias y perfiles, reintenta cambios offline y comprueba cada tres horas. Si la nube avanzó por otro equipo, pide una elección antes de escribir. Aplicar la nube crea primero una copia local `.laural` sin claves. En Cuenta puedes borrar definitivamente la cuenta y los datos de nube: requiere un login de menos de diez minutos y escribir `ELIMINAR`. Se borra el token y la línea base local de sync, pero perfiles, preferencias y claves API locales permanecen. Si la conexión se corta durante la solicitud, comprueba con el administrador antes de repetir. El servicio todavía no está desplegado; faltan ensayos contra VPS y reconexión real. Consulta el [plan y su estado](plans/sincronizacion-preferencias.md) y el [diseño](designs/sincronizacion-preferencias-y-portabilidad.md).

| Sección | Opciones y efecto |
| --- | --- |
| Apariencia | Selecciona una de las doce paletas y el modo claro u oscuro. El cambio se aplica de inmediato. |
| Proveedores y modelos | Selecciona un perfil o crea uno. Elige proveedor, nombre, URL base, modelo y clave si el servidor la exige. Puedes autorizar por perfil que la URL se incluya en una futura sincronización; está desmarcado por defecto y la sincronización aún no está disponible. Consulta los modelos y guarda el perfil. El chat usa el proveedor activo. |
| Permisos del agente | Confirmar cada comando pide revisión. Ejecutar reglas permitidas usa comandos completos con coincidencia exacta, uno por línea. Automático admite únicamente `git status`, `git status --short` y `git rev-parse --show-toplevel`. Los cambios de archivos requieren aprobación. |
| Retención de copias | Sin límite conserva todas las versiones (valor predeterminado). Puedes conservar entre 5 y 100 copias recientes por archivo. Al guardar o restaurar ese archivo, las versiones más antiguas se eliminan automáticamente. |
| Actividad del agente | Consulta hasta 30 resultados recientes y borra el historial tras confirmarlo. Se conservan como máximo 200 eventos o 64 KiB, solo con tipo, resultado y hora; no incluye comandos, rutas, prompts, salida ni claves. |
| Paleta de comandos | Pulsa `Ctrl+K` para buscar acciones, sesiones y los últimos 100 comandos de la sesión. El historial vive solo en memoria; elegir un comando lo copia para que lo revises y lo pegues. |
| Historial | Borrar historial del chat elimina la conversación local. La opción se deshabilita durante una operación activa. |
| Actualizaciones | Consulta la versión instalada, busca ahora, elige instalación manual o automática y descarga una versión para instalarla y reiniciar Laural. La app busca al iniciar y cada seis horas. |
| Importar y exportar | Crea un archivo `.laural` con preferencias de apariencia/actualización y perfiles de proveedor. Las claves se excluyen por defecto; para incluirlas se solicita una contraseña (mínimo 12 caracteres) y se cifran con Argon2id + AES-256-GCM. La importación permite vista previa y fusión o reemplazo; antes guarda una copia local en `transfer-backups`. |

Los archivos exportados sin claves contienen nombres, modelos y URLs de los proveedores; considera esas URLs información privada. Una exportación con claves está cifrada, pero quien conozca la contraseña podrá descifrarlas. La copia previa a una importación que cambia claves también se cifra con la contraseña del archivo importado. Sin cambios de claves, la copia local no contiene claves. Chats, terminales, proyectos, reglas del agente e historial no se exportan. La copia local está en el mismo equipo y no sustituye una copia externa.

En el primer inicio puedes escoger el modo de actualización. El modo automático puede cerrar terminales y sus procesos al instalar; guarda antes el trabajo activo. El paquete se valida con la firma criptográfica configurada en la aplicación.

Al probar la conexión, Laural reintenta una vez la consulta de modelos si falla la conexión o el servidor devuelve HTTP 502–504 sin indicar un plazo de espera. El chat requiere un nuevo envío manual si se interrumpe.

Para conectar un servidor local, usa la URL base que muestra el servidor, incluido el prefijo de su API compatible con OpenAI. Si no aparecen modelos, comprueba que el servidor esté iniciado, la dirección y el puerto sean correctos y el perfil tenga la clave correspondiente. Usa HTTPS para un proveedor remoto.

La elección del shell, las divisiones y los archivos adjuntos se hacen en la sesión de trabajo. Usa **Revisar contexto** antes de enviar contenido a un proveedor. Consulta la [política de datos](security/privacy.md).

Cada perfil guardado conserva su URL base. Para cambiar de servidor, crea otro perfil e introduce la clave correspondiente.
Las reglas no permiten operadores ni expansión de variables del shell. Escribe cada orden simple como una entrada independiente; las composiciones requieren aprobación manual.
