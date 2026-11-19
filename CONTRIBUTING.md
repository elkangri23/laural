# Contribuir a Laural

Gracias por considerar una contribución. El proyecto está en etapa inicial; antes de un cambio grande, abre una discusión o issue para acordar alcance y actualizar requisitos/ADR.

## Preparar el entorno

Sigue [Configuración de desarrollo](docs/development/setup.md). La aplicación apunta primero a Windows x64.

## Flujo de contribución

1. Busca issues abiertos y duplicados.
2. Para cambios grandes, plantea problema, alcance, alternativas, riesgos y criterios de aceptación.
3. Mantén los cambios acotados y separa refactor de cambio de comportamiento.
4. Actualiza README, requisitos, casos de uso, ADR o seguridad cuando el comportamiento cambie.
5. Incluye cómo comprobaste el cambio y en qué versión de Windows/shell.
6. Abre un pull request con resumen, motivación, cambios, validación manual, impacto de privacidad y capturas si cambia la interfaz.

## Reglas para código

- No incluir secretos, logs de usuario, archivos de proyecto ni claves de proveedores.
- No añadir red, telemetría, cuenta o permisos Tauri amplios sin ADR y justificación.
- Los cambios de agente deben validar entradas en Rust, mantener rutas dentro del proyecto y describir riesgo residual.
- Mantener accesible la UI y utilizar textos claros en español.
- Respetar la licencia MIT de Laural y la licencia de cada dependencia.

## Validación local

Como mínimo, compila el frontend y backend para cambios que los toquen:

```powershell
npm run build
npm run tauri build
```

Para cambios de terminal o agente, añade en el PR una validación manual pertinente en Windows. La cobertura automatizada está pendiente de definir.

## Pull requests

- Un PR por cambio coherente.
- Explica consecuencias y alternativas descartadas.
- No digas que está probado si solo se compiló.
- Atiende comentarios antes de dar el cambio por finalizado.

Toda contribución se distribuye bajo MIT, salvo que el PR indique claramente una excepción aceptada por los mantenedores.
