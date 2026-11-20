# Restaurar copias de archivos del agente

Después de aplicar un cambio de archivo, abre **Copias de seguridad**, elige una versión y pulsa **Restaurar copia**. Laural pide confirmación. Antes de restaurar conserva el archivo actual como una nueva versión. La lista enseña hasta veinte versiones recientes, ordenadas por fecha.

Las copias permanecen en `.laural-backups` dentro del proyecto. No se incluyen en el contexto automático. De forma predeterminada se conservan sin límite. En **Configuración → Retención de copias**, puedes optar por conservar las 5, 10, 20, 50 o 100 versiones más recientes de cada archivo. Al sobrescribir o restaurar ese archivo, las copias anteriores que excedan el límite se eliminan automáticamente. La limpieza manual sigue disponible.
En la tarjeta del archivo también puedes **Eliminar copias**. La acción requiere confirmación, elimina solo las versiones de ese archivo y deja intacto el archivo actual y las copias de otros archivos.
