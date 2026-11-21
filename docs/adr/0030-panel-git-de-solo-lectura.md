# ADR-0030 — Panel Git local de solo lectura

- **Estado:** Aceptada.
- **Fecha:** 2026-11-21.
- **Contexto:** Laural necesita mostrar rama, archivos cambiados y diff del proyecto abierto sin convertir esta vista en una vía para ejecutar comandos o enviar contenido del repositorio al modelo sin consentimiento.

## Decisión

- El backend nativo invoca el ejecutable `git` directamente con argumentos fijos y directorio de trabajo validado; nunca construye una orden para una shell.
- Se limita cada proceso a cinco segundos y cada respuesta a 128 KiB para estado y 160 KiB por diff. El diff combinado se limita a 160 KiB y muestra un aviso si se truncó.
- El estado usa formato porcelain v1. El diff muestra cambios preparados y sin preparar, desactiva diff externo y textconv, y no incluye archivos no rastreados.
- El panel no modifica, prepara, descarta ni ejecuta cambios. No manda el diff al proveedor; la incorporación explícita al contexto queda para una fase posterior con vista previa.
- Se limpia el entorno heredado del proceso Git y se deshabilitan configuración global/sistema, prompts, paginadores, escrituras opcionales y `core.fsmonitor`.

## Consecuencias

- Git for Windows debe estar disponible en `PATH`; si no lo está, Laural muestra un error localizado.
- En la primera entrega, el panel se abre manualmente y se actualiza a petición del usuario. No observa cambios en segundo plano.
- Las rutas se presentan como datos de texto y no se interpretan como comandos.
- La vista no incluye cambios de archivos no rastreados ni una opción de staging.

## Alternativas descartadas

- Ejecutar `git` mediante PowerShell/CMD: añade una capa de interpretación y exposición a inyección de comandos sin aportar valor.
- Enviar el diff al asistente de forma automática: revela contenido del proyecto a un proveedor y contradice el consentimiento explícito de contexto.
- Usar diffs externos o textconv configurados por repositorio: permitiría ejecutar programas locales durante la consulta.
