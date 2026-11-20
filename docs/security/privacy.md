# Privacidad y manejo de datos

## Datos que permanecen localmente

| Dato | Ubicación | Observación |
| --- | --- | --- |
| Nombres, URL y modelos de proveedores | `providers.json` en el directorio de configuración de Laural | La URL puede revelar un host privado. |
| Claves de API | Windows Credential Manager mediante el backend nativo de `keyring` | Se comprueba la lectura tras guardar. No incluir en issues, logs ni exportación. |
| Modo y comandos exactos del agente | `agent.json` | Son preferencias locales. |
| Historial de chat | No se persiste en la versión actual | La memoria en UI dura solo lo que mantenga la sesión. |
| Preferencia de apariencia | `localStorage` del WebView | Solo almacena modo y tema seleccionados. |
| Preferencia de actualización | `localStorage` del WebView | Solo registra instalación manual o automática. La consulta contacta GitHub al iniciar y cada seis horas. |
| Respaldo de archivo sobrescrito por agente | `.laural-backups` en el proyecto | Se conservan todas por defecto; el usuario puede habilitar retención y eliminación automática de versiones antiguas por archivo. |
| Actividad del agente | `agent-activity.json` en el directorio de configuración de Laural | Hasta 200 eventos o 64 KiB; solo registra tipo de acción, resultado y hora. Se puede borrar desde Configuración. |

## Qué puede salir del equipo

Al enviar chat o solicitar plan, Laural incluye la pregunta y el contexto que el frontend pasa al backend: salida reciente de terminal, archivos elegidos explícitamente y un conjunto acotado de archivos del proyecto. La solicitud va al endpoint activo, que puede ser local o remoto. El comportamiento de almacenamiento/retención del proveedor está fuera del control de Laural.

La lista y límites de contexto son protección contra exceso accidental, no una garantía de que se excluya todo dato sensible. Revisa prompts, salida de terminal y archivos antes de enviarlos. Evita pasar claves, tokens, datos personales o secretos de clientes.

## Telemetría y sincronización

No existe telemetría ni cuenta de Laural en el MVP. La sincronización queda diferida; perfiles y credenciales no se envían a servicio alguno de Laural.

La propuesta futura separa transferencia manual de configuración de sincronización autenticada. El archivo exportado podrá incluir claves solo si el usuario lo elige; si se exporta sin contraseña, contendrá secretos en texto no cifrado. La propuesta de sincronización de cuenta excluye claves API, credenciales de login, tokens, passkeys, historial y contexto de proyectos. Consulta el [plan de sincronización](../plans/sincronizacion-preferencias.md); ninguna de estas funciones está implementada en el MVP.

El historial de actividad del agente permanece en el equipo y no contiene comandos, rutas, prompts, salida de terminal, contenido de archivos, URLs, claves ni detalles de error. No es un registro inviolable: cualquier proceso con acceso a la cuenta puede alterarlo o borrarlo.

El updater consulta `raw.githubusercontent.com` y descarga el instalador desde GitHub Releases. Esas solicitudes pueden revelar a GitHub la dirección IP y metadatos HTTP habituales. La firma se verifica localmente antes de instalar; no se envían configuración, claves de proveedores ni contenido del terminal al servicio de actualizaciones.

El WebView aplica una política CSP local: bloquea scripts externos, `eval`, objetos y frames; conserva estilos inline requeridos por la interfaz, e IPC de Tauri. Las conexiones del frontend a endpoints de modelos se realizan desde Rust, no desde el navegador.
El cliente de proveedores no sigue redirecciones HTTP: las claves y el contexto solo se envían al destino configurado por el usuario.

## Solicitudes de soporte

Antes de compartir un log o captura, inspecciónala y elimina rutas privadas, prompts, salida del terminal, URLs internas y tokens. La clave API nunca debe ser parte de un reporte.
La escritura del agente prepara un temporal y sincroniza sus datos antes de aplicar el cambio. En Windows, cada sustitución deja la versión previa en `.laural-backups/edicion-<id>/`. Un programa externo puede modificar el mismo archivo entre la aprobación y el guardado. La retención automática es optativa; cuando se habilita, el límite se aplica tras sobrescribir o restaurar un archivo y elimina versiones antiguas que lo excedan. Revisa [restaurar copias](../restaurar-copias.md) antes de activarla.
