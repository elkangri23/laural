# ADR-0018: Registro local de actividad del agente

- Estado: Aceptada
- Fecha: 2026-11-20
- Decisores: Laural contributors

## Contexto

El usuario necesita revisar qué operaciones del agente se enviaron, aplicaron, rechazaron o fallaron. Registrar comandos, rutas, contenido, contexto o errores completos puede guardar secretos y datos privados; enviar esos eventos a Laural contradice el diseño local-first.

## Decisión

Guardar en el directorio local de configuración un historial acotado a 200 eventos y 64 KiB. Cada entrada contiene solamente la hora, un tipo de acción y un resultado categorizado. La ventana Configuración muestra hasta 30 eventos recientes y permite borrarlos con confirmación. La escritura es atómica y los fallos del registro no interrumpen la acción del agente.

No registrar comandos, rutas, nombres de archivos, prompts, salida de terminal, contenido, URLs, claves ni detalles de error. El registro no se sincroniza ni se transmite.

## Alternativas consideradas

- Registrar comandos y rutas: facilita diagnósticos, pero puede persistir secretos, nombres de proyectos y datos del usuario.
- Enviar eventos a un servicio: añade dependencia, cuenta/infraestructura y telemetría que no son necesarias para la función.
- No registrar actividad: mantiene privacidad, pero dificulta revisar resultados de acciones del agente.

## Consecuencias

- El usuario puede ver si una acción se envió, completó, fue rechazada o falló, sin poder recuperar sus detalles desde el historial.
- El historial puede perderse si el directorio local está dañado; las acciones siguen funcionando aunque no se pueda escribir el registro.
- El registro es de actividad, no una garantía de auditoría inviolable: un usuario o proceso con acceso a la cuenta puede modificarlo o borrarlo.
