# ADR-0031 — Recetas locales del agente

- **Estado:** Aceptada.
- **Fecha:** 2026-11-21.
- **Contexto:** Las tareas repetidas necesitan instrucciones reutilizables. Laural ya genera un plan de acciones y aplica permisos por comando/archivo; una receta no debe convertirse en una forma de saltarse esa revisión.

## Decisión

- El modo Agente ofrece recetas iniciales editables y la creación de recetas propias.
- Cada receta contiene nombre, objetivo y entre uno y doce pasos de texto. El contenido se limita en longitud y se conserva solo en `localStorage` de este equipo.
- Al elegir **Usar receta**, Laural previsualiza el objetivo y pasos y los inserta en el compositor del agente. La persona debe enviar esa solicitud para generar un plan.
- Las recetas no son código, no se interpretan como shell, no ejecutan herramientas, y no se exportan ni se incluyen en la sincronización.
- El plan generado sigue pasando por las políticas ya configuradas. Cambios de archivo y operaciones con efectos requieren aprobación individual según la política del agente.

## Consecuencias

- Las recetas pueden perderse al borrar datos locales del WebView o cambiar de perfil/navegador del sistema.
- El propietario de una receta puede escribir instrucciones engañosas; se presenta como texto sin privilegios y el modelo no recibe autorización adicional.
- Compartir o importar recetas queda fuera de esta entrega.

## Alternativas descartadas

- Guardar y ejecutar comandos como recetas: sería un canal de ejecución distinto de las políticas existentes.
- Sincronizarlas automáticamente: el contrato aprobado de sincronización excluye contenido de proyectos, historial y datos de trabajo; no se amplía con esta función.
