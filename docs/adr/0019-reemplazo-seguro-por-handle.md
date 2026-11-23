# ADR-0019: Reemplazo seguro de archivos por handle

- Estado: Aceptada
- Fecha: 2026-11-20
- Decisores: Laural contributors
- Sustituye parcialmente: [ADR-0014](0014-escritura-segura-agente.md)

## Contexto

El reemplazo anterior verificaba la ruta y luego usaba `ReplaceFileW`. Otro proceso con acceso al proyecto podía cambiar la entrada de destino entre esas operaciones. Una llamada relativa mediante `RootDirectory` a `SetFileInformationByHandle` devolvió `ERROR_INVALID_PARAMETER` en Windows de desarrollo, incluso con las estructuras Win32 documentadas.

## Decisión

En Windows, mantener abiertos sin compartir borrado todos los directorios de la cadena canónica del proyecto y los directorios de backup durante la escritura. Abrir el archivo original sin seguir reparse points y sin compartir ni escritura ni borrado. Así, un editor que mantenga un handle con acceso de escritura impide que Laural empiece el reemplazo; una vez abierto el handle de Laural, tampoco se admiten nuevos escritores incompatibles. Renombrar el original por handle a una ruta absoluta canónica de backup con `ReplaceIfExists=false`; renombrar el temporal por handle al destino solo si sigue libre. Si el segundo paso falla, intentar devolver el original al destino; si ya hay otro archivo, conservar el backup y no sobrescribirlo.

La API usada es `SetFileInformationByHandle` con `FILE_RENAME_INFO`, acceso `DELETE` al origen y nombres absolutos canónicos. Se conserva la comprobación de tipo ordinario antes de abrir el handle.

## Alternativas consideradas

- Mantener `ReplaceFileW`: el destino se resuelve por ruta después de la comprobación y conserva la carrera.
- Usar `RootDirectory` para rutas relativas: está documentado, pero devolvió `ERROR_INVALID_PARAMETER` con el entorno de Windows probado; no se acepta sin una ruta funcional reproducible.
- Reemplazar primero el destino y crear el backup después: una interrupción podría perder el original.

## Consecuencias

- Los nombres de destino y backup no pueden sobrescribir una entrada que aparezca concurrentemente.
- Si otro proceso mantiene abierto el original para escritura, la operación falla de forma segura; el archivo del editor no se sustituye ni se copia como backup inconsistente.
- El original queda respaldado antes de colocar el temporal; si hay una colisión, el backup se conserva y el archivo concurrente permanece intacto.
- Hay dos renombrados y, por tanto, un intervalo breve en que la ruta de destino puede no existir. Si el proceso termina en ese intervalo, el original sigue disponible en `.laural-backups` para restaurarlo.
- La decisión se apoya en el comportamiento Win32 documentado de [FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info) y [SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle).
