# Privacidad y manejo de datos

## Datos que permanecen localmente

| Dato | Ubicación | Observación |
| --- | --- | --- |
| Nombres, URL y modelos de proveedores | `providers.json` en el directorio de configuración de Laural | La URL puede revelar un host privado. |
| Claves de API | Windows Credential Manager mediante el backend nativo de `keyring` | Se comprueba la lectura tras guardar. No se guardan en archivos de Laural. En una futura exportación solo se incluirán dentro de un archivo cifrado con contraseña obligatoria. |
| Modo y comandos exactos del agente | `agent.json` | Son preferencias locales. |
| Historial de chat | No se persiste en la versión actual | La memoria en UI dura solo lo que mantenga la sesión. |
| Preferencia de apariencia | `localStorage` del WebView | Solo almacena modo y tema seleccionados. |
| Preferencia de actualización | `localStorage` del WebView | Solo registra instalación manual o automática. La consulta contacta GitHub al iniciar y cada seis horas. |
| Respaldo de archivo sobrescrito por agente | `.laural-backups` en el proyecto | Se conservan todas por defecto; el usuario puede habilitar retención y eliminación automática de versiones antiguas por archivo. |
| Actividad del agente | `agent-activity.json` en el directorio de configuración de Laural | Hasta 200 eventos o 64 KiB; solo registra tipo de acción, resultado y hora. Se puede borrar desde Configuración. |

## Qué puede salir del equipo

Al enviar chat o solicitar plan, Laural incluye la pregunta y el contexto que el frontend pasa al backend: salida reciente de terminal, archivos elegidos explícitamente y un conjunto acotado de archivos del proyecto. La solicitud va al endpoint activo, que puede ser local o remoto. El comportamiento de almacenamiento/retención del proveedor está fuera del control de Laural.

La lista y límites de contexto son protección contra exceso accidental, no una garantía de que se excluya todo dato sensible. Revisa prompts, salida de terminal y archivos antes de enviarlos. Evita pasar claves, tokens, datos personales o secretos de clientes.

Credential Manager protege las claves guardadas en reposo a través de Windows; Laural las recupera en memoria para autenticar solicitudes. Esto reduce la exposición en archivos y copias, pero no es impenetrable: malware ejecutado como la misma persona, un proceso de Laural comprometido, permisos administrativos o captura de memoria pueden acceder a una clave utilizable.

## Telemetría y sincronización

No existe telemetría ni cuenta de Laural en la versión actual. Perfiles y credenciales no se envían a servicio alguno de Laural.

La exportación/importación local ya está implementada de forma inicial. El archivo sin claves incluye preferencias y metadatos de proveedor, incluidas las URLs personalizadas; las claves solo se incluyen por elección explícita y dentro de un archivo cifrado con contraseña mediante Argon2id + AES-256-GCM. La importación valida el formato y los destinos antes de modificar perfiles y crea una copia local previa. La sincronización de cuenta aún no está implementada y excluirá claves API, credenciales de login, tokens, passkeys, historial y contexto de proyectos. Consulta el [plan de sincronización](../plans/sincronizacion-preferencias.md) y el [diseño formal](../designs/sincronizacion-preferencias-y-portabilidad.md).

Los perfiles locales guardan el tipo de proveedor y, con consentimiento explícito por perfil, si su endpoint personalizado podrá incluirse en un futuro snapshot. La opción comienza desactivada. El contrato v1 omite `customEndpoint` cuando no se autorizó; el servicio de sync todavía no está conectado.

La copia previa de importación se almacena en el directorio de configuración local, en `transfer-backups`; no se sube ni se cifra con una contraseña independiente. Si una importación cambia credenciales, esa copia incluye claves y se cifra usando la contraseña del archivo importado. Protégela como al archivo original. Una copia en el mismo equipo no protege ante la pérdida del equipo o del perfil de Windows.

El servicio de sincronización aún no está desplegado y no tiene copias de desastre. La decisión del propietario es no enviar respaldos fuera del VPS. Si el host se pierde por completo, las cuentas y preferencias guardadas en la nube pueden perderse sin posibilidad de recuperación. Antes de habilitar sincronización, la interfaz debe comunicar este límite. Una copia de PostgreSQL dentro del mismo VPS no está decidida y tampoco protegería frente a la pérdida del host.

El proveedor de correo transaccional elegido para la futura cuenta es Resend. Cuando se implemente, recibirá las direcciones destinatarias y el contenido necesario para verificación, PIN, recuperación, restablecimiento de contraseña y avisos de seguridad. La API key solo estará en el backend del VPS; habrá que incluir Resend y sus prácticas de retención en el aviso de privacidad antes de activar cuentas.

El historial de actividad del agente permanece en el equipo y no contiene comandos, rutas, prompts, salida de terminal, contenido de archivos, URLs, claves ni detalles de error. No es un registro inviolable: cualquier proceso con acceso a la cuenta puede alterarlo o borrarlo.

El updater consulta `raw.githubusercontent.com` y descarga el instalador desde GitHub Releases. Esas solicitudes pueden revelar a GitHub la dirección IP y metadatos HTTP habituales. La firma se verifica localmente antes de instalar; no se envían configuración, claves de proveedores ni contenido del terminal al servicio de actualizaciones.

El WebView aplica una política CSP local: bloquea scripts externos, `eval`, objetos y frames; conserva estilos inline requeridos por la interfaz, e IPC de Tauri. Las conexiones del frontend a endpoints de modelos se realizan desde Rust, no desde el navegador.
El cliente de proveedores no sigue redirecciones HTTP: las claves y el contexto solo se envían al destino configurado por el usuario.

## Solicitudes de soporte

Antes de compartir un log o captura, inspecciónala y elimina rutas privadas, prompts, salida del terminal, URLs internas y tokens. La clave API nunca debe ser parte de un reporte.
La paleta conserva hasta 100 comandos recientes solo en memoria hasta que se cierra Laural. Un comando elegido se copia al portapapeles y debe pegarse y ejecutarse por separado; revisa el portapapeles si escribiste credenciales u otro dato sensible en un comando.
La escritura del agente prepara un temporal y sincroniza sus datos antes de aplicar el cambio. En Windows, cada sustitución deja la versión previa en `.laural-backups/edicion-<id>/`. Un programa externo puede modificar el mismo archivo entre la aprobación y el guardado. La retención automática es optativa; cuando se habilita, el límite se aplica tras sobrescribir o restaurar un archivo y elimina versiones antiguas que lo excedan. Revisa [restaurar copias](../restaurar-copias.md) antes de activarla.
