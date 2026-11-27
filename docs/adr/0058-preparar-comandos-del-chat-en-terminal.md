# ADR-0058: Preparar comandos sugeridos en el chat sin ejecutarlos

- Estado: Aceptada
- Fecha: 2026-11-27
- Decisores: Laural contributors

## Contexto

Las respuestas del chat pueden incluir comandos para copiar manualmente. Copiarlos y cambiar a la terminal añade pasos; enviarlos automáticamente sería una acción con efectos sobre el sistema y confundiría una sugerencia con una orden autorizada.

## Decisión

- En modo Chat, los bloques Markdown de una sola línea muestran **Pegar en terminal** solo si la etiqueta del bloque coincide con el shell activo: `powershell`, `cmd` o `bash` para WSL y Git Bash.
- La acción utiliza el método de pegado de xterm.js para enviar el comando por la misma ruta de entrada del usuario, con el tratamiento de pegado que el shell tenga activo. No añade CR/LF. Si ya hay texto en la línea, el comando se inserta en el cursor sin reemplazarlo; el usuario revisa la línea resultante y decide si pulsa Enter.
- No se muestra en modo Agente ni mientras se transmite la respuesta. Se rechazan líneas vacías, multilínea, con caracteres de control o mayores de 4.000 caracteres.
- La terminal rechaza la inserción si ejecuta un comando, no está lista o ha terminado. Una línea editada con atajos puede dejar su contenido desconocido para el seguimiento interno; esto no bloquea el pegado. La acción conserva la entrada y comunica que debe revisarse.
- El prompt del chat comunica al proveedor el shell activo y pide un bloque etiquetado por comando. El servidor no ejecuta la sugerencia; la petición usa el proveedor y las credenciales configuradas existentes.

## Alternativas consideradas

- Ejecutar la sugerencia al pulsar el botón: descartada porque una respuesta del modelo no es consentimiento de ejecución.
- Mostrar el botón para cualquier bloque de código: descartada porque puede insertar texto de programación, salida o sintaxis de otro shell en la terminal.
- Usar solo el portapapeles del sistema: descartada porque obliga al usuario a seleccionar la terminal y pegar; el flujo puede colocar el texto directamente en la línea sin ejecutarlo.

## Consecuencias

- El usuario ve y confirma la línea en el prompt del shell antes de ejecutarla; Laural no puede verificar semánticamente que el comando sea inocuo.
- Las sugerencias etiquetadas con otro idioma de shell no tienen acción; la respuesta de texto sigue disponible para copiar manualmente.
- Se requieren pruebas de compatibilidad en los cuatro shells desde la aplicación instalada, además de las regresiones automatizadas sobre inserción, línea vacía/editada, terminal ocupada y ausencia de Enter.
