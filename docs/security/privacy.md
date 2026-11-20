# Privacidad y manejo de datos

## Datos que permanecen localmente

| Dato | Ubicación | Observación |
| --- | --- | --- |
| Nombres, URL y modelos de proveedores | `providers.json` en el directorio de configuración de Laural | La URL puede revelar un host privado. |
| Claves de API | Windows Credential Manager | No incluir en issues, logs ni exportación. |
| Modo y comandos exactos del agente | `agent.json` | Son preferencias locales. |
| Historial de chat | No se persiste en la versión actual | La memoria en UI dura solo lo que mantenga la sesión. |
| Preferencia de apariencia | `localStorage` del WebView | Solo almacena modo y tema seleccionados. |
| Respaldo de archivo sobrescrito por agente | `.laural-backups` en el proyecto | Permanece con el proyecto hasta que el usuario lo elimine. |

## Qué puede salir del equipo

Al enviar chat o solicitar plan, Laural incluye la pregunta y el contexto que el frontend pasa al backend: salida reciente de terminal, archivos elegidos explícitamente y un conjunto acotado de archivos del proyecto. La solicitud va al endpoint activo, que puede ser local o remoto. El comportamiento de almacenamiento/retención del proveedor está fuera del control de Laural.

La lista y límites de contexto son protección contra exceso accidental, no una garantía de que se excluya todo dato sensible. Revisa prompts, salida de terminal y archivos antes de enviarlos. Evita pasar claves, tokens, datos personales o secretos de clientes.

## Telemetría y sincronización

No existe telemetría ni cuenta de Laural en el MVP. La sincronización queda diferida; perfiles y credenciales no se envían a servicio alguno de Laural.

## Solicitudes de soporte

Antes de compartir un log o captura, inspecciónala y elimina rutas privadas, prompts, salida del terminal, URLs internas y tokens. La clave API nunca debe ser parte de un reporte.
La escritura del agente prepara un temporal y sincroniza sus datos antes de aplicar el cambio. En Windows, cada sustitución deja la versión previa en `.laural-backups/edicion-<id>/`. No existe restauración o limpieza automática. Un programa externo puede modificar el mismo archivo entre la aprobación y el guardado, y los backups crecen hasta su eliminación manual.
