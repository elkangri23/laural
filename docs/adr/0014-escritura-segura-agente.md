# ADR-0014 — Escritura segura de archivos del agente

Estado aceptado.

## Contexto

La versión anterior escribía directamente sobre el destino después de crear un respaldo. Un fallo durante la escritura podía dejar el archivo original truncado. La comprobación de ruta y la copia también podían competir con cambios simultáneos.

## Decisión

Cada cambio aprobado se escribe primero en un archivo temporal del mismo directorio y se sincroniza a disco. En Windows, el reemplazo de un archivo existente usa `ReplaceFileW` con una copia de seguridad en `.laural-backups/edicion-<id>/`. La plataforma hace el reemplazo en una operación. La creación de archivos nuevos usa creación exclusiva. Las ediciones dentro de la instancia se serializan. Se rechazan nombres de dispositivos reservados de Windows y puntos de reanálisis en directorios y destinos. Los handles de directorios abiertos sin permiso de borrado se conservan hasta finalizar la operación.

## Consecuencias

- La escritura anterior permanece completa si falla el reemplazo de Windows.
- Cada reemplazo conserva una copia de la versión previa.
- Las rutas de backup permanecen dentro del proyecto y las excluye el lector de contexto.
- La serialización solo coordina una instancia de Laural. Un programa externo puede competir con la operación. El guardado bloquea archivos en uso si Windows no permite reemplazarlos.
- La restauración de backups y la limpieza automática quedan pendientes.
Actualización: la persona puede listar y restaurar las veinte copias más recientes. La restauración pide confirmación y genera a su vez una copia de la versión que reemplaza.
La lista solo incluye versiones recientes con archivos regulares dentro de su carpeta. Restaurar requiere confirmación y pasa por el mismo guardado atómico, de modo que también conserva el contenido desplazado.
La interfaz permite eliminar las copias de un archivo concreto después de confirmar. La operación no afecta el archivo actual ni las copias de otras rutas.
