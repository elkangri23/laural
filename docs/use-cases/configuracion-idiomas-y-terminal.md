# UC-30 — Activar sugerencias locales de PowerShell

**Objetivo:** mostrar una sugerencia inline basada en el historial local mientras se escribe en una nueva terminal PowerShell de Laural.

**Actor:** usuario de Laural.

**Precondiciones:** Windows; preferencia disponible en **Configuración → Agente y terminal**. PSReadLine debe admitir las opciones nativas de predicción; no es requisito para que la terminal funcione.

Las etiquetas de permisos, reglas y avisos de seguridad de esta categoría siguen el idioma español/inglés elegido en Personalización.

**Flujo principal:**

1. El usuario activa **Sugerencias locales de PowerShell**.
2. Laural guarda la preferencia localmente y aplica la opción a sesiones PowerShell que se creen después.
3. Si PSReadLine lo admite, muestra una sugerencia de historial inline.
4. El usuario pulsa flecha derecha para aceptar la sugerencia o la edita mediante los atajos nativos de PowerShell. Tab sigue completando y Enter ejecuta solo la línea confirmada.

**Alternativas y errores:** si PSReadLine no está instalado, no expone los parámetros requeridos o rechaza la configuración, Laural abre la sesión con el prompt normal y sin mensaje de error. Desactivar la opción afecta solo a sesiones nuevas; las abiertas conservan su configuración actual.

**Privacidad y seguridad:** el historial puede contener datos sensibles. Laural no lo lee ni lo captura como sugerencia; PSReadLine lo utiliza localmente. La opción y el historial no se exportan, sincronizan, envían a modelos, registran ni transmiten. La sugerencia nunca se ejecuta automáticamente. CMD, WSL y Git Bash no reciben la configuración de PSReadLine.

**Estado:** implementación local; pruebas automatizadas de propagación y fallback pasan. PowerShell 7.6.9 aplicó History/InlineView en una prueba aislada con ConPTY; sigue pendiente validar el inicio real desde Laural, los casos ausente/incompatible y confirmar a mano que Tab/Enter conservan el comportamiento nativo.

## UC-31 — Conservar el idioma al transferir o sincronizar preferencias

**Objetivo:** usar la misma elección de idioma en otro equipo mediante archivo de configuración o cuenta sincronizada.

**Actor:** titular de la configuración.

**Flujo de transferencia:** al importar v2 válido con `language: es|en`, la app aplica ese idioma. Si importa v1 o un archivo antiguo sin idioma, conserva la elección local válida; si no existe, detecta el idioma del sistema una vez y usa español como fallback. Un idioma inválido hace que se rechace el archivo completo, sin aplicar parcialmente otras preferencias.

**Flujo de sincronización:** un snapshot v2 puede conservar la elección entre equipos. La API continúa leyendo/escribiendo v1 durante la transición y admite v2 después del despliegue del servicio. Un cliente antiguo que no entienda v2 detiene la aplicación del snapshot y no lo sobrescribe ni borra los datos locales.

**Límites:** solo se transporta el idioma entre los datos nuevos; se mantienen las listas allowlist de preferencias/proveedores. No se incluyen API keys, credenciales, factores MFA/passkeys, historial, terminal, rutas, permisos del agente o preferencia local de PSReadLine. Los mensajes libres del backend se mantienen en español.

**Estado:** implementados localmente: exportación v2, lectura compatible v1/v2, fallback al idioma local para transferencias y snapshots v1, y aplicación de idioma procedente de v2. El cliente sincroniza automáticamente este campo solo dentro del snapshot permitido. Falta validar que el VPS ejecute la versión del servicio que acepta v2 antes de publicar el cliente.
