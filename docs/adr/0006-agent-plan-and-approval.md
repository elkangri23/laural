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

Actualización M3: PowerShell, WSL y Git Bash ejecutan perfiles interactivos que pueden redefinir comandos, así que sus modos automático y por reglas ahora requieren confirmación manual. CMD inicia con `/d` para desactivar `AutoRun`; `doskey` requiere revisión porque crea macros de sesión.

Regresión M3: una orden `doskey` que define una macro de comando debe seguir pidiendo aprobación aunque coincida exactamente con una regla permitida. La clasificación de riesgo se evalúa antes de las reglas.

Actualización M3: `taskkill` y `Stop-Computer` requieren aprobación manual en modos automático y por reglas porque pueden terminar procesos o apagar el equipo. `tasklist`, `Get-Process` y `Get-Command Stop-Computer` conservan su clasificación de lectura; las reglas no reducen la revisión requerida.

Actualización M3: `git config` exige aprobación manual, tanto en llamada directa como con opciones globales como `-C` antes del subcomando. Incluye consultas de solo lectura por simplicidad; la clasificación evita que reglas persistentes agreguen aliases ejecutables o sustituyan comandos como `core.sshCommand`.

Actualización M3: ejecutar código en contenedores (`docker run`, `exec`, Compose), construir imágenes, copiar archivos y cambiar recursos de Docker requiere aprobación manual. Las consultas conocidas de Compose (`ps`, `config`, `logs`, entre otras) conservan acceso sin revisión, salvo `config --output`, que escribe un archivo; las opciones antes de la operación son conservadoras y requieren aprobación.

Actualización M3: los runtimes y ejecutores alternativos `npx`, `pnpm`, `yarn`, `bun`/`bunx`, `corepack`, `deno`, `pipx` y `uvx` requieren aprobación manual por tratarse de rutas de ejecución de código o herramientas. Se aplican antes de las reglas exactas.

Actualización M3: las mutaciones de credenciales de Windows con `cmdkey` y `vaultcmd` requieren aprobación manual; se mantienen disponibles consultas de listado y ayuda. Operaciones desconocidas requieren revisión.

Actualización M3: clientes SSH/SCP/SFTP y PuTTY, PsExec, WinRS, `ssh-add` y cmdlets de gestión de sesiones remotas PowerShell requieren aprobación manual. Cambiar a un host remoto modifica el destino y el alcance de la acción; la aprobación ocurre antes de las reglas exactas.

Actualización M3: `msiexec`, `wmic`, `bitsadmin` y `certutil` se tratan como lanzadores de sistema de alto impacto y requieren aprobación antes de reglas o ejecución automática.

Actualización M3: `lodctr` y `unlodctr` requieren aprobación para cualquier argumento, ya que pueden cambiar o eliminar datos de contadores en el Registro. Solo la invocación vacía y las opciones exactas de ayuda se consideran inocuas; los argumentos desconocidos también requieren aprobación.

Actualización M3: `typeperf` requiere aprobación ante cualquier argumento, pues puede muestrear indefinidamente, consultar equipos remotos y escribir resultados incluso cuando consulta catálogos. Solo sintaxis vacía y ayuda exacta se permiten sin revisión; la aprobación no constituye aislamiento.

Actualización M3: `relog` requiere aprobación para cualquier argumento porque transforma registros de rendimiento y puede escribir archivos o bases de datos; su archivo de configuración también puede suministrar opciones de ejecución. Solo la invocación vacía y la ayuda exacta quedan sin revisión.
