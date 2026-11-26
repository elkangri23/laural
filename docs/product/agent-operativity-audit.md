# Auditoría de operatividad del agente

- Fecha: 26-11-2026
- Alcance: petición → contexto → plan → ejecución → resultado.
- Estado: ciclo acotado de observación y replanificación implementado; pendiente validarlo desde la app con proveedores reales y en los cuatro shells instalados.

## Cómo funciona

1. La interfaz envía la petición, el shell activo, la salida reciente de esa terminal, el proyecto seleccionado, archivos adjuntos y, si se eligió, el diff Git.
2. El backend reúne hasta diez archivos de texto del proyecto y valida el JSON que devuelve el proveedor.
3. El agente presenta como máximo ocho acciones. Los comandos se envían al shell activo; los cambios estructurados de archivo quedan asociados a la raíz del proyecto y requieren aplicación explícita.
4. Tras un comando exitoso o un archivo aplicado con aprobación, la interfaz vuelve a planificar con la acción, el resultado y hasta 1.000 caracteres de salida reciente. Este historial se envía al proveedor configurado como dato no confiable y solo permanece en memoria durante el ciclo; no se guarda en disco.
5. El ciclo se detiene ante error, código distinto de cero, finalización desconocida, aclaración o cancelación. Como máximo ejecuta ocho acciones exitosas por petición; los cambios de archivo siempre esperan aprobación y backup.

## Hallazgos y resolución

### Alta — la finalización del agente dependía de marcadores frágiles del shell

La integración anterior no disponía de un contrato de finalización verificable para todos los shells. CMD emitía `OSC 133;D` sin código; confiar en marcadores de prompt estándar también permitía confundir la salida de un comando con el fin de la acción del agente.

**Resuelto:** las órdenes del agente en PowerShell, CMD, WSL y Git Bash terminan con una marca OSC 777 que contiene el código de salida y un UUID aleatorio por ejecución. La interfaz valida el formato, el identificador y el código numérico; ignora las marcas estándar de prompt mientras espera esa respuesta y usa el timeout como resultado desconocido.

La marca aleatoria evita que una salida anterior o emitida por el propio comando se confunda con la finalización real. CMD puede reflejar literalmente `%ERRORLEVEL%` al repetir la orden, pero esa marca no contiene el UUID esperado y se ignora.

### Alta — el plan no podía pedir una aclaración

El contrato exigía entre una y ocho acciones. Ante una petición ambigua, el modelo debía adivinar o producir un plan inválido.

**Resuelto:** el contrato admite `clarifyingQuestion` con una lista de acciones vacía, y rechaza planes que mezclen una pregunta con acciones ejecutables. La interfaz muestra la pregunta y conserva la petición original; al responder, vuelve a enviar petición, pregunta y respuesta juntas. Cambiar al modo Chat o borrar el historial descarta la aclaración pendiente.

### Media — el plan no priorizaba explícitamente la petición exacta

Las instrucciones ya aislaban el contexto no confiable y limitaban el shell, pero no prohibían claramente las mejoras ajenas al objetivo ni las suposiciones sobre archivos que no se habían leído.

**Resuelto:** las instrucciones ahora requieren identificar el resultado pedido, limitarse a acciones necesarias, no inventar contenido de archivos y preguntar antes de adivinar información imprescindible.

## Límites que siguen abiertos

- **La finalización depende del modelo:** Laural muestra el resumen de finalización junto con el resultado recibido, pero no demuestra que el objetivo externo esté realmente conseguido. El modelo puede equivocarse al interpretar una salida.
- **Sin reintento automático:** un error detiene el ciclo. El usuario puede revisar el resultado y pedir una corrección explícita; el modelo no vuelve a ejecutar por sí solo una acción fallida.
- **Límite por petición:** después de ocho acciones el ciclo se pausa y hace falta una nueva petición del usuario.
- **Contexto parcial:** el escaneo del proyecto proporciona como máximo diez archivos y tiene límites de tamaño y profundidad. La petición debe adjuntar los archivos importantes si no aparecen en el contexto; el modelo ya no debe tratarlos como leídos.
- **Cambios de archivo:** incluso en modos automáticos, las acciones `write_file` siguen requiriendo revisión y aplicación explícitas. Esto evita aplicar contenido generado sin confirmar.
- **Validación real:** las pruebas locales cubren el contrato, el estado de la interfaz, los cuatro shells y el ciclo observable; no sustituyen una comprobación manual con un proveedor real en cada shell.

## Pruebas

- `providers.rs` se clasifica como **Crítico**: las regresiones verifican pregunta/finalización válidas, estados incoherentes, límites del historial y rechazo de acciones repetidas.
- `lib.rs` se clasifica como **Crítico**: las regresiones verifican el código de salida y el token para los cuatro shells admitidos, además del rechazo de tokens inválidos.
- `TerminalPane.tsx` se clasifica como **Crítico**: las regresiones aceptan una marca OSC 777 numérica válida y rechazan códigos mal formados.
- `App.tsx` se clasifica como **Estándar**: las regresiones verifican que el turno de aclaración conserve el objetivo original, que no se replanifique antes del token correcto, que la salida y el código exitoso entren en la siguiente decisión, que un código distinto de cero no provoque otra planificación ni ejecución y muestre el motivo de parada, y que cancelar durante un comando impida continuar.

Validación local de esta revisión: UI 294/294; cobertura UI 92,24 % de líneas, con `App.tsx` en 83,08 % y `TerminalPane.tsx` en 100 % de líneas y ramas. La política 100/80/0 pasa: 11 archivos Críticos al 100/100, 14 Estándar con al menos 80 % de líneas y 8 Triviales excluidos. Rust: 267 pruebas pasadas y 2 manuales ignoradas (sin cambios Rust desde esa ejecución). `npm run test:coverage-policy` pasa. La compilación, el presupuesto de bundles y `git diff --check` pasaron en el commit anterior; esta revisión solo añade una prueba UI y actualiza documentación. No hay proveedor local escuchando en Ollama, LM Studio ni el puerto FreeLLMAPI configurado, así que no se pudo probar la conversación real. La cobertura Rust no se pudo medir localmente con MSVC; debe confirmarse en CI Linux.

La cobertura integral por archivo se mide con la política 100/80/0 del proyecto; Windows/MSVC ejecuta Cargo pero no genera los perfiles `llvm-cov`, por lo que la cobertura Rust debe confirmarse en CI Linux.

## Siguiente trabajo

Validar en Windows una tarea inocua de varios pasos con un proveedor local y otro OpenAI-compatible, en PowerShell, CMD, WSL y Git Bash. Confirmar pausa por ocho acciones, cancelación durante replanificación y que los cambios de archivo siguen pidiendo aprobación.
