# ADR-0006: Plan del agente con autorización local de acciones

- Estado: Aceptada
- Fecha: 2026-11-19
- Decisores: Laural contributors

## Contexto

El usuario quiere que el agente lea y modifique archivos y utilice comandos. Delegar autorización solo al modelo sería inseguro: el modelo genera sugerencias, pero el backend local debe hacer cumplir las decisiones.

## Decisión

El modelo devuelve un plan acotado de acciones. El backend valida formato, longitud y rutas. Los comandos se someten a una política configurable (confirmación, reglas o automático); patrones de riesgo conocidos requieren autorización manual. Las escrituras de archivo requieren aprobación explícita y respaldan archivos existentes.

## Alternativas consideradas

- Ejecución directa de texto generado: rechazada porque no separa propuesta del modelo de permiso del usuario.
- Ejecución siempre manual sin modos configurables: ofrece control sencillo, pero no cumple el caso de uso de automatización optativa.
- Sandbox propio de contenedores: no se incluye porque Windows, WSL, Git Bash y dependencias de shell complican un aislamiento uniforme para el MVP.

## Consecuencias

- Las reglas de riesgo son heurísticas incompletas, no una frontera de seguridad.
- El modo automático puede ejecutar comandos no previstos con los privilegios de la cuenta actual.
- Se necesita historial claro de acciones, resultado, modo aplicado y autorizaciones.
- La cancelación durante generación y el envío de Ctrl+C están implementados inicialmente; quedan pruebas por shell y la terminación de procesos hijos.
- El usuario debe revisar las acciones y considerar el modo manual para proyectos sensibles.

Revisión posterior a alpha.5: las reglas guardadas pasan a compararse con la línea completa, respetando mayúsculas. El modo automático admite las tres consultas de Git enumeradas en la guía de configuración. Ampliar argumentos requiere registrar otra regla o confirmar el comando.
Actualización: antes de aplicar reglas o ejecución automática, Rust rechaza metacaracteres según el shell guardado en la sesión. La aprobación humana mantiene la ejecución de órdenes compuestas tras validar controles y tamaño.

Actualización M3: para herramientas de gestión conocidas, una opción global antes del subcomando exige revisión manual. Así se evita que opciones de selección de proyecto/contexto desplacen un subcomando de cambio fuera de la primera posición que inspecciona la regla. Se permiten llamadas exactas de ayuda/versión y la consulta `pacman -Ss`; el clasificador sigue siendo heurístico y no sustituye un sandbox.
