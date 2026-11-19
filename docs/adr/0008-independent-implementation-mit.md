# ADR-0008: Implementación independiente bajo MIT

- Estado: Aceptada
- Fecha: 2026-11-19
- Decisores: Laural contributors

## Contexto

Laural se inspira en un flujo de trabajo de terminal con IA, pero debe tener identidad propia y publicarse como software libre sin funciones de monetización.

## Decisión

Desarrollar con código, interfaz, nombre y recursos propios, sin reutilizar material extraído de Warp. Distribuir Laural bajo licencia MIT. Las dependencias de terceros mantienen sus licencias originales.

## Alternativas consideradas

- Copiar o modificar el binario de otro producto: se rechaza; no proporciona un proyecto mantenible y trae riesgos de licencia, atribución y actualización.
- Licencia copyleft fuerte: no seleccionada para el objetivo actual de facilitar reutilización; se puede reabrir solo con acuerdo de colaboradores.

## Consecuencias

- Revisar licencias de dependencias y activos antes de cada release.
- No usar marca, iconos, texto o elementos visuales de terceros sin autorización.
- El archivo `LICENSE` y metadatos deben mantenerse coherentes.
