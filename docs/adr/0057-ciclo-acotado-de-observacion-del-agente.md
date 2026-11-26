# ADR-0057: Ciclo acotado de observación y replanificación del agente

- Estado: Aceptada
- Fecha: 2026-11-26
- Decisores: Laural contributors

## Contexto

El agente preparaba un plan estático y ejecutaba los comandos aprobados sin volver a consultar el modelo con sus resultados. No podía adaptar el siguiente paso a lo descubierto ni informar que el objetivo estaba completo basándose en la salida observada.

## Decisión

- Después de cada comando exitoso y cada cambio de archivo aplicado por el usuario, Laural envía al proveedor configurado una observación acotada de la acción, resultado y salida reciente.
- El modelo puede devolver acciones siguientes, pedir una aclaración o declarar `isComplete` con una lista de acciones vacía.
- La interfaz ejecuta como máximo ocho acciones exitosas por petición. Cada paso nuevo se vuelve a planificar. Si el límite se alcanza, el usuario decide si inicia otra petición.
- Un error, un código de salida distinto de cero, un resultado desconocido o una cancelación detiene el ciclo. La interfaz no reintenta automáticamente comandos fallidos.
- Los modos automáticos vuelven a pasar cada comando por la autorización existente. Los cambios estructurados de archivo siguen requiriendo aprobación y backup; después de aplicarlos, el agente vuelve a planificar.
- Rust limita la cantidad y tamaño del historial, valida el estado final y rechaza la repetición de comandos o rutas de archivo ya completados. La salida de terminal se trata como dato no confiable.
- El historial de ejecución vive en memoria durante la petición y se envía solo al proveedor seleccionado; no se guarda en el historial de chat, en el registro de actividad ni en la sincronización de preferencias.

## Alternativas consideradas

- Ejecutar de una vez todos los comandos del plan inicial: descartada porque no permite reaccionar al resultado y puede ejecutar pasos que dejaron de ser pertinentes.
- Replanificar tras cualquier código de salida: descartada porque el modelo podría continuar después de un error o repetir efectos secundarios.
- Permitir ciclos sin límite: descartada por coste, duración y riesgo de automatización no acotada.

## Consecuencias

- Una tarea puede requerir varias solicitudes al proveedor; cada solicitud añade latencia y transmite el resultado reciente al proveedor configurado.
- Ocho acciones limitan el alcance de una petición, pero no convierten el agente ni sus reglas heurísticas en un sandbox.
- El modelo decide cuándo declara el objetivo completo; Laural presenta esa decisión junto con el resumen y la evidencia recibida, sin certificar que el resultado sea correcto.
- Los cambios de archivo nunca se aplican automáticamente, incluso al usar modos automáticos para comandos.
- La integración real debe probarse con un proveedor y con PowerShell, CMD, WSL y Git Bash; las pruebas unitarias cubren el contrato local.
