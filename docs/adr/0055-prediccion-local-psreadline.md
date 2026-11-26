# ADR-0055: sugerencias locales de historial mediante PSReadLine

- Estado: Aceptada; implementación local, validación manual pendiente
- Fecha: 2026-11-24
- Decisores: Laural contributors

## Contexto

La terminal no ofrecía sugerencias mientras se escribe. Un predictor propio duplicaría funciones del shell y requeriría leer/capturar historial, con riesgo de exponer comandos sensibles.

## Decisión

Añadir en Configuración → Agente y terminal una preferencia local, apagada por defecto, para solicitar a PSReadLine la predicción `History` con presentación `InlineView` en nuevas sesiones PowerShell. La configuración se añade únicamente al comando de inicio fijo que ya crea el prompt de Laural. Se comprueba que el cmdlet expone ambos parámetros; errores o incompatibilidad se silencian y PowerShell continúa con su prompt normal.

La preferencia se guarda solo en `localStorage` de este equipo. No forma parte de exportación/importación, sincronización, contexto de IA, actividad ni telemetría. La sugerencia no ejecuta comandos; flecha derecha acepta el texto sugerido, Tab conserva su función de autocompletado y Enter ejecuta solo la línea confirmada. Cambiar el ajuste no altera terminales abiertas. CMD, WSL y Git Bash no reciben el bloque de configuración.

## Alternativas consideradas

- Predictor propio en Laural: descartado; duplicaría el historial y la edición del shell, y ampliaría la superficie de captura de texto sensible.
- Activarlo por defecto: descartado; el historial de PowerShell puede contener comandos sensibles y la decisión debe ser explícita.
- Cambiar perfiles globales o Registro: descartado; alteraría shells fuera de Laural y sería difícil de revertir.
- Aplicarlo a todas las shells: descartado; cada una tiene su mecanismo y sus atajos nativos.

## Consecuencias

- Se reutiliza el predictor nativo, sin servicio externo ni peticiones de red.
- PSReadLine ausente o incompatible no impide abrir la terminal; se pierde solo la sugerencia.
- El control visual del prompt y la compatibilidad por versión siguen pendientes de validación manual en Windows.

## Evidencia / enlaces

- [Diseño de ajustes, idiomas y sugerencias](../designs/ajustes-idiomas-prediccion-terminal.md)
- [Caso de uso UC-30](../use-cases/configuracion-idiomas-y-terminal.md#uc-30--activar-sugerencias-locales-de-powershell)
- [Privacidad y datos](../security/privacy.md)
- [Documentación de predicciones de PSReadLine](https://learn.microsoft.com/en-us/powershell/scripting/learn/shell/using-predictors?view=powershell-7.2)
