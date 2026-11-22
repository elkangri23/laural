# ADR-0004: API compatible con OpenAI como interfaz inicial

- Estado: Aceptada
- Fecha: 2026-11-19
- Decisores: Laural contributors

## Contexto

Los proveedores prioritarios son Ollama, LM Studio y APIs compatibles, incluido FreeLLMAPI. Implementar protocolos distintos desde el inicio multiplica configuración y manejo de errores.

## Decisión

Usar endpoints de estilo OpenAI: obtener modelos en `/models` y solicitar chat en `/chat/completions`, con URL base y modelo configurables por perfil.

## Alternativas consideradas

- Adaptador distinto para cada proveedor: permite exponer capacidades específicas, pero crea una matriz de protocolos mayor para el MVP.
- Incluir solo un proveedor: simplifica inicio, pero impide alternar entre modelos locales y remotos según lo pedido.

## Consecuencias

- Una API que solo se llame compatible puede implementar un subconjunto diferente y no funcionar sin ajustes.
- El MVP no garantiza streaming, herramientas nativas, imágenes, embeddings o esquemas de respuesta no estándar.
- Las pruebas de contrato deben cubrir modelos, autenticación, errores y respuesta de chat de cada proveedor objetivo.
- HTTP queda limitado a loopback; para hosts remotos se exige HTTPS.
- Las solicitudes de modelos y chat no siguen redirecciones HTTP. Cada perfil queda ligado a su destino configurado y una respuesta 3xx no debe reenviar claves ni contexto a otro host.
- Chat normal y streaming construyen la solicitud con el mismo adaptador para evitar divergencias de URL, modelo, mensajes y autenticación; solo difiere el indicador `stream`. Las pruebas inspeccionan el contrato serializado y rechazan HTTP fuera de loopback.
