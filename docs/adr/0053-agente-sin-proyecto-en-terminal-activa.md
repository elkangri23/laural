# ADR-0053: Agente sin proyecto sobre la terminal activa

- Estado: Aceptada
- Fecha: 2026-11-24
- Decisores: Laural contributors

## Contexto

El planificador del agente rechazaba cualquier solicitud si no había una carpeta de proyecto abierta, aunque la terminal activa ya estuviera situada en un directorio de trabajo. Esto impedía consultas sencillas como listar la carpeta Descargas desde el shell actual.

## Decisión

Permitir que el agente planifique acciones sin proyecto seleccionado. En ese caso, el plan solo puede contener comandos destinados a la terminal activa; el shell resuelve su directorio de trabajo real, incluido un cambio de carpeta realizado después de abrir la terminal. El prompt del modelo le indica que trabaje sobre ese directorio y que no use rutas arbitrarias.

El backend rechaza cualquier acción estructurada `write_file` si no hay proyecto, porque la escritura directa depende de una raíz validada y del sistema de copias de seguridad. El usuario conserva la revisión, las reglas y la política actual de ejecución de comandos. No se añade sandbox ni aislamiento del shell.

## Alternativas consideradas

- Mantener obligatorio abrir un proyecto: rechazada porque bloquea tareas locales pequeñas en la terminal activa.
- Inferir `cwd` analizando prompt o salida del shell: rechazada por ser frágil y variar entre PowerShell, CMD, WSL y Git Bash.
- Elegir otra carpeta mediante un selector: pospuesta; obligaría a cambiar de contexto aunque el shell ya tenga el directorio correcto.

## Consecuencias

- Se elimina la barrera artificial para planes basados en la terminal activa.
- Sin proyecto, los cambios estructurados con backup no están disponibles; el agente puede proponer comandos de shell sujetos a las mismas comprobaciones y aprobaciones existentes.
- La ejecución del shell conserva los permisos de Windows del usuario. El análisis de riesgo es heurístico, no un sandbox; un comando explícito puede acceder a rutas fuera del directorio actual. La vista previa y aprobación del comando siguen siendo necesarias.

## Evidencia / enlaces

- [Caso de uso UC-05](../use-cases/README.md#uc-05--pedir-plan-al-agente)
- [Modelo de amenazas](../security/threat-model.md)
