# ADR-0052: Política de cobertura de pruebas 100/80/0

- Estado: Aceptada
- Fecha: 2026-11-24

## Contexto

La cobertura anterior imponía 85 % de líneas en un subconjunto de módulos Rust y 65 % de ramas en tres módulos. No distinguía de forma uniforme entre seguridad/autenticación, comportamiento estándar y archivos declarativos o generados. La política no reflejaba el rigor requerido por autenticación, credenciales, sincronización y ejecución de comandos.

## Decisión

Adoptar el modelo 100/80/0 por archivo:

- **Crítico (100 %):** 100 % de líneas y ramas medibles, incluidos bordes, errores y rutas de seguridad. Incluye autenticación, autorización, MFA, credenciales/criptografía, integridad y privacidad de sync, acceso/escritura de archivos, ejecución de comandos y actualización firmada.
- **Estándar (80 %):** al menos 80 % de líneas; cubrir flujos principales y errores frecuentes, y probar decisiones relevantes.
- **Trivial (0 %):** no crear tests para configuración declarativa, DTO puros, vistas estáticas ni código generado; excluirlos del denominador.

Antes de añadir o revisar tests se clasifica el archivo y se comunica el nivel. La clasificación depende de la responsabilidad y el riesgo. Si un archivo combina responsabilidades con niveles distintos, se prefiere separarlas.

## Consecuencias

- Los porcentajes globales no sustituyen las metas por categoría: se informarán líneas y ramas junto con archivos excluidos.
- El código crítico existente todavía presenta brechas importantes. La adopción de la política es efectiva para nuevos tests; el cierre y la automatización del baseline existente se gestionan incrementalmente para que cada gate nuevo tenga un informe verificable.
- El gate actual de CI sigue en 85 % de líneas/65 % de ramas hasta completar esa migración; por tanto, todavía no se declara cumplimiento 100/80/0.

## Referencias

- [Política y línea base de cobertura](../development/coverage-policy.md)
- [Workflow de cobertura](../../.github/workflows/cobertura.yml)
