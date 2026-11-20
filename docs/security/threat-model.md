# Modelo de amenazas

## Alcance

Versión inicial de Laural para escritorio Windows: frontend Tauri, procesos PTY, proveedor de modelos, almacenamiento local, proyectos seleccionados y acciones del agente.

## Activos

- API keys y URLs de proveedores.
- Código, archivos de configuración y credenciales que aparecen en salida de terminal.
- Integridad de los archivos del proyecto.
- Sesiones y procesos shell del usuario.
- Contexto enviado a un proveedor local o remoto.

## Actores y amenazas

| Actor / evento | Amenaza | Mitigación actual | Riesgo residual |
| --- | --- | --- | --- |
| Modelo equivocado o prompt injection en proyecto | Proponer acciones que ignoran la solicitud | Contexto se etiqueta como dato no confiable; UI presenta un plan | El modelo puede generar texto dañino o confuso. |
| Comando peligroso propuesto | Borrar, exfiltrar, cambiar permisos o instalar software | Confirmación/reglas/automático; lista heurística bloquea patrones de alto impacto | Los patrones no entienden semántica; se pueden evadir. |
| Ruta manipulada | Escribir fuera del proyecto | Ruta relativa, canonicalización de directorio, tamaño limitado, backup | Enlaces simbólicos/carreras necesitan revisión continua. |
| Proveedor remoto | Retención o uso del contexto enviado | El usuario configura host; HTTPS requerido; contexto acotado | Política del proveedor controla retención y uso. |
| Proveedor redirige la petición autenticada | Reenviar clave o contexto a un host distinto | El cliente HTTP no sigue redirecciones; regresión local comprueba el rechazo | El host configurado recibe la solicitud original y puede procesar los datos según su política. |
| Contenido web o XSS en WebView | Ejecutar JavaScript con acceso a comandos Tauri | CSP local con `script-src 'self'`, sin scripts remotos ni `unsafe-eval`; se eliminó el plugin de apertura no usado | Código local comprometido o una vulnerabilidad del WebView aún puede alcanzar permisos de la ventana. |
| Endpoint o proyecto hostil | Agotar memoria con respuestas HTTP o árboles de archivos grandes | Límites de tamaño de respuesta y presupuesto de entradas al recorrer proyectos | El usuario aún puede consumir recursos al abrir voluntariamente un proyecto grande o iniciar muchas terminales. |
| Fuga de API key | Incluir clave en logs, archivos o repo | Windows Credential Manager nativo; clave verificada tras guardar; no se guarda en JSON | Plugins, malware del usuario o diagnóstico del SO quedan fuera del control de Laural. |
| Binario comprometido | Ejecutar código no revisado | El updater verifica la firma criptográfica del paquete; el código y las releases son públicos | Los instaladores no tienen Authenticode; la publicación, la clave y la instalación limpia requieren validación continua. |
| Manifiesto o instalador de actualización sustituido | Ejecutar un instalador malicioso | HTTPS, manifiesto publicado desde el repositorio y validación de firma criptográfica del paquete con clave pública embebida | El compromiso de la cuenta/repo o la pérdida de la clave privada permite publicar actualizaciones; GitHub Actions y la cadena de compilación siguen dentro de la confianza. |

## Límites de seguridad

- Laural **no** es sandbox de shell ni de modelo.
- Los comandos se ejecutan con la identidad y permisos del usuario de Windows.
- El modo automático puede aceptar comandos que el clasificador no detecte como peligrosos.
- El proveedor recibe prompts y contexto que el usuario envía, según su configuración.
- Permisos Tauri y CSP deben mantenerse revisados; no habilitar plugins/capacidades genéricas sin justificación.
- La firma del updater autentica paquetes frente a una clave de publicación; no aísla el workflow, no evita compromiso de la clave y no equivale a firma Authenticode.

## Tratamiento de alto impacto

La política debe preferir confirmación para eliminación amplia, cambios de sistema, administración, red y despliegue. Las nuevas reglas automáticas necesitan ejemplos adversariales y revisión por pares. Toda acción debe poder asociarse a plan, terminal y resultado. La cancelación inicial puede mandar Ctrl+C al PTY, pero no garantiza detener procesos hijos, procesos que ignoran Ctrl+C ni deshacer efectos ya realizados.

## Mejoras requeridas antes de release estable

1. Validar rutas ante symlinks y sustitución de directorio entre comprobación y escritura.
2. Validar parada/cancelación por shell y diseñar terminación fiable de procesos hijos.
3. Definir qué comandos pueden ejecutarse en automático; incorporar pruebas de política en el proceso del proyecto antes de cambiar esa lógica.
4. Verificar que errores y diagnósticos no imprimen claves ni cuerpos completos de solicitudes.
5. Instalar desde cero y revisar permisos, firma y actualizaciones de la aplicación.

El backend comprueba la URL completa del perfil antes de consultar su clave al probar la conexión o actualizar el perfil. Las reglas de comandos exigen coincidencia exacta. Incluso una consulta de Git depende del ejecutable, la configuración y el entorno del shell del usuario.

La auditoría inicial está registrada en [audit-report.md](audit-report.md). Los límites de respuesta HTTP, recorrido de proyectos, escrituras y concurrencia se aplican en backend. La CSP no convierte la aplicación en sandbox: la sesión de terminal hereda los permisos de Windows del usuario.
# Actualización de seguridad de M3

Los cambios aprobados del agente se preparan en el mismo directorio antes de reemplazar un archivo. Windows conserva la versión anterior en `.laural-backups`. La creación usa una operación exclusiva para no pisar un archivo creado entre la revisión y la aplicación.

No reemplazar un archivo externo que cambió simultáneamente sigue requiriendo la coordinación de otras aplicaciones. Si el archivo está bloqueado, Laural informa el error y conserva los datos previos. La carpeta `.laural-backups` ocupa espacio hasta que el usuario la limpie manualmente. La restauración desde la interfaz sigue pendiente.
La restauración del agente requiere confirmación explícita y solo acepta versiones regulares bajo el directorio de copias. Cada restauración genera una nueva copia del archivo actual.
La limpieza de copias requiere confirmación y solo elimina archivos regulares del archivo elegido bajo el almacén de copias. El archivo de trabajo actual se conserva.
La autorización del agente considera metacaracteres de PowerShell, CMD, Bash y WSL para los modos automático y reglas. La confirmación humana permite expresamente comandos complejos. El shell, sus aliases y perfiles personalizados siguen fuera de una sandbox.
El filtro inicial de comandos del agente también reconoce alias y operaciones habituales de borrado, copia, movimiento, truncado y escritura de archivos en PowerShell, CMD y shells tipo Bash. La lista es heurística: puede pedir confirmación para comandos inocuos y no cubre alias, funciones o perfiles personalizados ni sustituye un sandbox.
