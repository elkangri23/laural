# Auditoría de operatividad del agente

- Fecha: 26-11-2026
- Alcance: petición → contexto → plan → ejecución → resultado.
- Estado: correcciones principales implementadas; queda pendiente cerrar el ciclo de observación y replanificación.

## Cómo funciona

1. La interfaz envía la petición, el shell activo, la salida reciente de esa terminal, el proyecto seleccionado, archivos adjuntos y, si se eligió, el diff Git.
2. El backend reúne hasta diez archivos de texto del proyecto y valida el JSON que devuelve el proveedor.
3. El agente presenta como máximo ocho acciones. Los comandos se envían al shell activo; los cambios estructurados de archivo quedan asociados a la raíz del proyecto y requieren aplicación explícita.
4. En ejecución automática, la interfaz recorre los comandos que ya venían en el plan. Si uno informa un código distinto de cero o no informa estado, la secuencia se detiene.

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

- **Sin ciclo de observación:** el modelo prepara las acciones de una vez. La interfaz puede ejecutarlas en orden y detenerse ante un error, pero no devuelve el resultado al modelo para diagnosticarlo, corregir el plan o comprobar el resultado final. Las tareas cuyo siguiente paso depende de lo que descubra el primer comando necesitan otra petición del usuario.
- **Contexto parcial:** el escaneo del proyecto proporciona como máximo diez archivos y tiene límites de tamaño y profundidad. La petición debe adjuntar los archivos importantes si no aparecen en el contexto; el modelo ya no debe tratarlos como leídos.
- **Cambios de archivo:** incluso en modos automáticos, las acciones `write_file` siguen requiriendo revisión y aplicación explícitas. Esto evita aplicar contenido generado sin confirmar.
- **Validación real:** las pruebas locales cubren el contrato, el estado de la interfaz y la forma de la marca para todos los shells; no sustituyen una comprobación manual del agente con un proveedor real en cada shell.

## Pruebas

- `providers.rs` se clasifica como **Crítico**: las regresiones verifican pregunta válida, rechazo de pregunta mezclada con acciones y rechazo de planes vacíos.
- `lib.rs` se clasifica como **Crítico**: las regresiones verifican el código de salida y el token para los cuatro shells admitidos, además del rechazo de tokens inválidos.
- `TerminalPane.tsx` se clasifica como **Crítico**: las regresiones aceptan una marca OSC 777 numérica válida y rechazan códigos mal formados.
- `App.tsx` se clasifica como **Estándar**: las regresiones verifican que el turno de aclaración conserve el objetivo original y que la acción no termine antes de recibir el token correcto.

Validación local de esta revisión: UI 290/290; cobertura UI 92,04 % de líneas, con `App.tsx` en 81,77 % y `TerminalPane.tsx` en 100 % de líneas y ramas. La política 100/80/0 pasa: 11 archivos Críticos al 100/100, 14 Estándar con al menos 80 % de líneas y 8 Triviales excluidos. Rust: 263 pruebas pasadas y 2 manuales ignoradas. `cargo fmt --check`, `npm run build`, presupuesto de bundles y `git diff --check` pasan. La cobertura Rust no se pudo medir localmente con MSVC; debe confirmarse en CI Linux.

La cobertura integral por archivo se mide con la política 100/80/0 del proyecto; Windows/MSVC ejecuta Cargo pero no genera los perfiles `llvm-cov`, por lo que la cobertura Rust debe confirmarse en CI Linux.

## Siguiente trabajo

Diseñar un ciclo acotado de ejecutar → observar salida y código → decidir si continuar, corregir o terminar → validar el resultado. Debe conservar la aprobación actual, limitar iteraciones y evitar repetir comandos con efectos secundarios. No se implementa dentro de esta auditoría porque cambia el modelo de ejecución y seguridad del agente.
