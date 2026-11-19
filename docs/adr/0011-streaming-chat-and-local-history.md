# ADR-0011: Respuesta incremental e historial local de chat

- Estado: aceptado
- Fecha: 2026-11-19

## Contexto

Las consultas bloqueantes hacen que una respuesta del modelo parezca congelada y no pueden detenerse a petición. Las conversaciones tampoco deben requerir una cuenta ni un servidor de Laural.

## Decisión

Usar Server-Sent Events de endpoints compatibles con OpenAI para entregar fragmentos al cliente Tauri y asociarlos a un identificador de consulta. Mantener los últimos 100 mensajes de chat en el almacenamiento local del WebView y ofrecer una acción explícita para borrarlos.

## Consecuencias

- El usuario ve la respuesta mientras llega y puede cancelar la consulta activa.
- Historial y preferencias se quedan en el perfil local de la aplicación; no se sincronizan.
- El historial puede desaparecer al limpiar los datos del WebView. No se incluye salida de terminal ni claves de proveedor en el historial.
- Proveedores que no implementen streaming SSE compatible pueden no funcionar con este flujo; hace falta validarlos manualmente.
