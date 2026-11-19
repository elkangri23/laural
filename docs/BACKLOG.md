# Backlog de producto

La [hoja de ruta](ROADMAP.md) agrupa los hitos. Esta lista ordena el trabajo abierto por riesgo y explica cómo cerrarlo.

| Prioridad | Entrega | Criterio de cierre |
| --- | --- | --- |
| Alta · M3 | Autorización del agente | Verificar comandos y rutas por shell, documentar límites y resolver los casos que permitan eludir aprobación. |
| Alta · M1 | Terminal y bloques | Comprobar inicio, edición, salida, interrupción y cierre en PowerShell, CMD, WSL y Git Bash con y sin perfiles personalizados. |
| Alta · M4 | Distribución | Registrar instalación limpia, actualización y desinstalación en Windows 10/11 x64, incluidos datos residuales. |
| Alta · M2 | Proveedores y privacidad | Validar modelos, streaming, cancelación, errores y contenido enviado con cada proveedor admitido. |
| Media · M0 | Configuración | Verificar navegación con teclado, guardado de preferencias tras reinicio y cambio de perfil sin exposición de claves. |
| Media · M4 | Firma | Publicar paquetes firmados cuando haya certificado y comprobar el editor en Windows. |
| Diferida | Sincronización opcional | Acordar alcance, cifrado y recuperación antes de implementar. |

Avance de M2 y M3: perfiles vinculados al destino y reglas de coincidencia exacta implementados. Pendientes la validación entre proveedores y los ensayos por shell.
Comprobación parcial de M1: los fragmentos de integración emiten las marcas esperadas en Windows PowerShell, CMD, Git Bash y Bash de Ubuntu en WSL. Sigue abierta la prueba de los cuatro shells dentro de la aplicación con perfiles de usuario.
