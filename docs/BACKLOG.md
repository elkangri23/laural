# Backlog de producto

La [hoja de ruta](ROADMAP.md) agrupa los hitos. Esta lista ordena el trabajo abierto por riesgo y explica cómo cerrarlo.

| Prioridad | Entrega | Criterio de cierre |
| --- | --- | --- |
| Alta · M3 | Autorización del agente | Verificar comandos y rutas por shell, documentar límites y resolver los casos que permitan eludir aprobación. |
| Alta · M1 | Terminal y bloques | PTY real superada en PowerShell, CMD, Git Bash y WSL Ubuntu: entrada, resize, recepción de 1.500 líneas y código 37. Pendiente validar bloques, entrada editada, interrupción, cierre y reinicio desde la ventana instalada con perfiles personalizados. |
| Alta · M4 | Distribución | MSI en `es-ES` y NSIS en español configurados. Registrar instalación limpia, actualización y desinstalación en Windows 10/11 x64, incluidos datos residuales. |
| Alta · M2 | Proveedores y privacidad | Credential Manager de Windows ya es el backend nativo y tiene prueba de persistencia. Validar modelos, streaming, cancelación, errores y contenido enviado con Ollama, LM Studio, FreeLLMAPI y cada proveedor admitido. |
| Media · M0 | Configuración | Verificar navegación con teclado, guardado de preferencias tras reinicio y cambio de perfil sin exposición de claves. |
| Media · M4 | Firma | Publicar paquetes firmados cuando haya certificado y comprobar el editor en Windows. |
| Diferida | Sincronización opcional | Acordar alcance, cifrado y recuperación antes de implementar. |
| Alta · M4 | Seguridad de distribución | CSP y permisos mínimos aplicados; límites de memoria/recorrido añadidos. Antes de estable: instalar limpio, firmar/verificar actualizaciones y revisar el modelo de confianza del agente por shell. |

Auditoría inicial: [informe de seguridad](security/audit-report.md). Los filtros de comandos siguen siendo heurísticos y Laural no aísla los procesos del shell.

Avance de M2 y M3: perfiles vinculados al destino y reglas de coincidencia exacta implementados. Pendientes la validación entre proveedores y los ensayos por shell.
Comprobación de M1: la prueba de PTY real pasó en los cuatro shells locales. Sigue abierta la validación visual de bloques dentro de la aplicación y la prueba con perfiles de usuario.
Cobertura: ampliar los casos de regresión a cambios de permisos, interacción del chat y ciclo de vida de sesiones al modificar esos flujos.
| Alta · M3 | Ediciones de archivos | Escritura, restauración y limpieza manual con copia de seguridad implementadas y cubiertas. Pendiente retención automática y coordinación con editores externos. |
| Alta · M3 | Retención de copias | Restauración confirmada implementada y probada. Limpieza confirmada por archivo implementada. Pendiente política de retención automática configurable. |
Revisión de sintaxis del agente: comprobación inicial por shell para PowerShell, CMD, WSL y Git Bash y detección de alias destructivos habituales, cubiertas con pruebas. Siguen pendientes funciones y perfiles personalizados.
M3: validación inicial por shell aplicada antes de reglas y automatización. Pendiente probar aliases, perfiles de inicio y variaciones de sintaxis en cada shell.
Revisión de alias destructivos: el filtro bloquea alias comunes de borrado y escritura. Pendiente ampliar revisión con perfiles personalizados de PowerShell y Bash.
