# Backlog de producto

La [hoja de ruta](ROADMAP.md) agrupa los hitos. Esta lista ordena el trabajo abierto por riesgo y explica cómo cerrarlo.

| Prioridad | Entrega | Criterio de cierre |
| --- | --- | --- |
| Alta · M3 | Autorización del agente | El plan y las operaciones de archivo comparten la validación de rutas; se rechazan nombres reservados de Windows y la carpeta interna antes de mostrar el plan. Siguen pendientes casos de comandos por shell, perfiles personalizados y límites heurísticos. |
| Media · M3 | Registro de actividad local | Implementado: historial acotado y borrable que conserva solo tipo de acción, resultado y hora; no almacena comandos, rutas, contenido ni secretos y no transmite eventos. |
| Alta · M3 | Carreras en archivos del proyecto | Implementado en Windows: se fija toda la cadena canónica de directorios y se usan handles de archivo con renombrado sin sobrescritura. Si aparece un destino concurrente, no se reemplaza; el contenido original permanece en el backup. La interrupción entre los dos renombrados puede dejar el destino ausente temporalmente, pero se puede restaurar desde el backup. |
| Alta · M1 | Terminal y bloques | PTY real superada en PowerShell, CMD, Git Bash y WSL Ubuntu: entrada, resize, recepción de 1.500 líneas y código 37. Las regresiones de interfaz cubren captura de comandos, OSC de bloques/códigos de salida y líneas editadas. El ejecutable local abrió, pero Windows no permitió activar su ventana tras dos intentos; pendiente validar visualmente bloques, interrupción, cierre y reinicio desde la ventana instalada con perfiles personalizados. |
| Alta · M4 | Distribución | MSI en `es-ES` y NSIS en español configurados. Registrar instalación limpia, actualización y desinstalación en Windows 10/11 x64, incluidos datos residuales. |
| Alta · M2 | Proveedores y privacidad | Credential Manager de Windows ya es el backend nativo y tiene prueba de persistencia. La suite verifica que no se siguen redirecciones que puedan mover la solicitud autenticada a otro destino. La sonda local sin credenciales del 20-11-2026 no encontró Ollama en `11434` ni LM Studio en `1234`; FreeLLMAPI en `31415` devolvió `401`. Pendiente habilitar servicios de prueba y validar modelos, streaming, cancelación, errores y contenido enviado sin registrar ni compartir claves. |
| Media · M0 | Configuración | Verificar navegación con teclado, guardado de preferencias tras reinicio y cambio de perfil sin exposición de claves. |
| Media · M4 | Firma | Publicar paquetes firmados cuando haya certificado y comprobar el editor en Windows. |
| Diferida | Sincronización opcional | Acordar alcance, cifrado y recuperación antes de implementar. |
| Alta · M4 | Seguridad de distribución | CSP y permisos mínimos aplicados; límites de memoria/recorrido añadidos. Antes de estable: instalar limpio, firmar/verificar actualizaciones y revisar el modelo de confianza del agente por shell. |
| Alta · M4 | Actualizador | Release alpha.14, instalador, firma y manifiesto publicados correctamente. Validar en Windows la actualización real de alpha.14 a una release posterior, fallos de red/firma, preferencia automática y reinicio con terminales abiertas. |

Auditoría inicial: [informe de seguridad](security/audit-report.md). Los filtros de comandos siguen siendo heurísticos y Laural no aísla los procesos del shell. La detección cubre ahora comandos frecuentes de copia, movimiento, truncado y escritura; siguen pendientes aliases y perfiles personalizados.

Avance de M2 y M3: perfiles vinculados al destino y reglas de coincidencia exacta implementados. Pendientes la validación entre proveedores y los ensayos por shell.
Comprobación de M1: la prueba de PTY real pasó en los cuatro shells locales. Sigue abierta la validación visual de bloques dentro de la aplicación y la prueba con perfiles de usuario.
Cobertura: ampliar los casos de regresión a cambios de permisos, interacción del chat y ciclo de vida de sesiones al modificar esos flujos.
| Alta · M3 | Ediciones de archivos | Escritura, restauración y limpieza manual con copia de seguridad implementadas y cubiertas. Pendiente retención automática y coordinación con editores externos. |
| Alta · M3 | Retención de copias | Retención optativa de 5/10/20/50/100 copias por archivo implementada con valor predeterminado sin límite, limpieza segura no recursiva y regresiones. El selector visual se comprobó; queda probar la persistencia tras reinicio y el flujo con una edición aprobada. |
Revisión de sintaxis del agente: comprobación inicial por shell para PowerShell, CMD, WSL y Git Bash y detección de alias destructivos habituales, cubiertas con pruebas. Siguen pendientes funciones y perfiles personalizados.
M3: validación inicial por shell aplicada antes de reglas y automatización. Pendiente probar aliases, perfiles de inicio y variaciones de sintaxis en cada shell.
Revisión de alias y operaciones de archivo: el filtro requiere aprobación manual para comandos comunes de borrado, copia, movimiento, truncado y escritura. Pendiente revisar perfiles personalizados, aliases definidos por el usuario y las diferencias de sintaxis por shell.
