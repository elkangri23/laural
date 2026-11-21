# Modelo de amenazas

## Alcance

Versión inicial de Laural para escritorio Windows: frontend Tauri, procesos PTY, proveedor de modelos, almacenamiento local, proyectos seleccionados y acciones del agente.

## Activos

- API keys y URLs de proveedores.
- Código, archivos de configuración y credenciales que aparecen en salida de terminal.
- Integridad de los archivos del proyecto.
- Sesiones y procesos shell del usuario.
- Contexto enviado a un proveedor local o remoto.
- Metadatos locales de las acciones recientes del agente.

## Actores y amenazas

| Actor / evento | Amenaza | Mitigación actual | Riesgo residual |
| --- | --- | --- | --- |
| Modelo equivocado o prompt injection en proyecto | Proponer acciones que ignoran la solicitud | Contexto se etiqueta como dato no confiable; UI presenta un plan | El modelo puede generar texto dañino o confuso. |
| Comando peligroso propuesto | Borrar, exfiltrar, cambiar permisos o instalar software | Confirmación/reglas/automático; lista heurística detecta operaciones de archivo, permisos, atributos y enlaces frecuentes | Los patrones no entienden semántica y no detectan aliases, funciones o perfiles personalizados; se pueden evadir. |
| Ruta manipulada o directorio reemplazado concurrentemente | Escribir o eliminar fuera del proyecto | Rutas relativas, cadena canónica de directorios fijada, rechazo de reparse points, renombrado por handle sin sobrescritura y backup | El proceso podría interrumpirse entre los dos renombrados; el original queda recuperable desde el backup. |
| Proveedor remoto | Retención o uso del contexto enviado | El usuario configura host; HTTPS requerido; contexto acotado | Política del proveedor controla retención y uso. |
| Proveedor redirige la petición autenticada | Reenviar clave o contexto a un host distinto | El cliente HTTP no sigue redirecciones; regresión local comprueba el rechazo | El host configurado recibe la solicitud original y puede procesar los datos según su política. |
| Contenido web o XSS en WebView | Ejecutar JavaScript con acceso a comandos Tauri | CSP local con `script-src 'self'`, sin scripts remotos ni `unsafe-eval`; el plugin opener solo se invoca desde Rust para la URL HTTPS fija del login y no se habilita a JavaScript | Código local comprometido o una vulnerabilidad del WebView aún puede alcanzar permisos de la ventana. |
| Endpoint o proyecto hostil | Agotar memoria con respuestas HTTP o árboles de archivos grandes | Límites de tamaño de respuesta y presupuesto de entradas al recorrer proyectos | El usuario aún puede consumir recursos al abrir voluntariamente un proyecto grande o iniciar muchas terminales. |
| Fuga de API key | Incluir clave en logs, archivos o repo | Windows Credential Manager nativo; clave verificada tras guardar; no se guarda en JSON. Transferencia futura exige archivo cifrado con contraseña y nunca permite exportación de claves en claro. | Malware con acceso a la cuenta o proceso comprometido puede recuperar la clave mientras Laural la usa; el almacén local no es impenetrable. |
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
La restauración del agente requiere confirmación explícita y solo acepta versiones regulares bajo el directorio de copias. En Windows mantiene fijados los directorios intermedios y abre la copia con `FILE_FLAG_OPEN_REPARSE_POINT`, sin compartir escritura/borrado, para impedir que se redirija o sustituya mientras se lee. Cada restauración genera una nueva copia del archivo actual. Antes del reemplazo atómico, la escritura vuelve a comprobar que el destino siga siendo un archivo ordinario. La llamada Win32 aún opera por nombre de ruta, por lo que permanece una ventana de carrera entre esa última comprobación y la operación del sistema.
La limpieza de copias requiere confirmación, fija cada directorio intermedio y solo elimina archivos regulares del archivo elegido bajo el almacén de copias. El archivo de trabajo actual se conserva; los enlaces y rutas fuera del almacén se ignoran.
La autorización del agente considera metacaracteres de PowerShell, CMD, Bash y WSL para los modos automático y reglas. La confirmación humana permite expresamente comandos complejos. El shell, sus aliases y perfiles personalizados siguen fuera de una sandbox.
El filtro inicial de comandos del agente también reconoce alias y operaciones habituales de borrado, copia, movimiento, truncado y escritura de archivos en PowerShell, CMD y shells tipo Bash. La lista es heurística: puede pedir confirmación para comandos inocuos y no cubre alias, funciones o perfiles personalizados ni sustituye un sandbox.

## Amenazas de portabilidad y sincronización

La transferencia local está implementada de forma inicial; existe el backend privado de cuentas y snapshots y el cliente Tauri ya tiene el login PKCE inicial. El cliente de sync y la página pública de estado aún no existen. Los controles actuales y los riesgos abiertos deben leerse por separado.

| Área | Control actual | Riesgo/residuo |
| --- | --- | --- |
| Exportación de claves | Consentimiento explícito, contraseña mínima, Argon2id con parámetros fijos y AES-256-GCM; el formato autentica el contenido. | Una contraseña débil o conocida permite recuperar las claves. El archivo cifrado sigue siendo un secreto. |
| Importación | Límite de 4 MiB, formato y versión estrictos, validación de perfiles/URLs, vista previa y aplicación desde backend nativo. | Se requiere ensayo manual en Windows y pruebas de fallos reales de Credential Manager. |
| Cambios de credenciales | Copia previa local cifrada cuando una importación cambia claves; rollback de operaciones de Credential Manager si falla una operación posterior. | Una falla del propio almacén durante rollback puede requerir recuperación manual desde la copia. Las preferencias del WebView se guardan después del backend y no forman una transacción común con Credential Manager. |
| Almacenamiento de copias | Directorio `transfer-backups` en la carpeta local de configuración. | No protege ante pérdida del equipo/usuario; las copias no tienen política automática de retención hoy. |

La API privada inicial de snapshots y los flujos de cuenta existen localmente; el despliegue todavía no existe. La sección siguiente describe los riesgos y controles aprobados antes de habilitar sync.

| Área | Control implementado en API local | Riesgo/residuo |
|---|---|---|
| Acceso a snapshots | Bearer opaco de 32 bytes; hash SHA-256 en PostgreSQL, token local en Credential Manager y comprobación por cuenta en cada lectura/escritura. | CI prueba las rutas de snapshots con PostgreSQL temporal y autenticación inyectada; falta integrar auth real, desplegar revocación y validar VPS. No exponer públicamente. |
| Datos aceptados | Schema v1 cerrado, AJV, máximo 256 KiB, IDs y endpoint validados; errores genéricos, sin logs de solicitud; JSONB contiene solo el allowlist. | El administrador del VPS puede leer estos metadatos; no hay E2EE. |
| Escrituras concurrentes | `ETag`/`If-Match`, idempotency key por cuenta y escritura transaccional. | CI verifica revisión, conflicto e idempotencia con PostgreSQL temporal. Las claves caducan a los 30 días; falta validar carga y crecimiento de tablas detrás de Caddy en el VPS. |
| Registro y PIN de correo | Argon2id para passwords; PIN de seis dígitos con HMAC keyed, expiración a cinco minutos, cinco intentos, consumo único y topes por cuenta; respuestas genéricas. Registro deshabilitado por defecto. | Límites persistentes por IP/ruta implementados y probados con PostgreSQL en CI. Falta validar IP reenviada por Caddy y comportamiento ante abuso coordinado. No exponer las rutas en Internet. La verificación no autentica ni crea sesión. |
| Login nativo | Página HTTPS externa; cookie `Secure`/`HttpOnly`/`SameSite=Strict`, token CSRF; listener efímero solo en `127.0.0.1`, state validado en tiempo constante, PKCE S256, canje HTTPS sin redirects y token en Credential Manager. | Cerrar sesión revoca el token actual en el servidor y borra la copia local. Sin red, la sesión remota puede seguir vigente hasta caducar. Gestión de otros dispositivos, operación VPS y límites detrás del proxy siguen pendientes. Mantener el backend apagado y no publicar. |

| Amenaza | Control requerido en el diseño | Riesgo y condición de salida |
| --- | --- | --- |
| Archivo de exportación robado | Si incluye claves, cifrar el archivo con contraseña mediante un formato versionado y KDF resistente; rechazar exportación de claves sin cifrado. Importar validando todo antes de modificar el perfil. | Un atacante que obtenga el archivo y descifre su contraseña puede recuperar las claves. No describir el cifrado como impenetrable. |
| Snapshot de nube perdido por fallo o compromiso total del VPS | La sync es opcional y local-first; comunicar el riesgo y conservar configuración funcional en el dispositivo. | El propietario decidió no enviar copias fuera del VPS. La pérdida total del host puede borrar cuentas y snapshots; no se garantiza recuperación. Una futura copia en el mismo VPS no mitiga este evento. |
| Acceso entre cuentas | Cada lectura, escritura, restauración y borrado debe validar la identidad del servidor y filtrar por propietario en la capa de persistencia; probar intentos IDOR entre cuentas. | Un error de autorización puede exponer o reemplazar preferencias de otra cuenta. |
| Sustitución accidental por sync o repetición de solicitudes | Revisiones condicionales, claves de idempotencia, elección explícita ante conflicto, copia recuperable antes de reemplazar y validación de esquema/tamaño. | No aceptar last-write-wins silencioso. La recuperación no debe caducar automáticamente sin política acordada. |
| Secuestro de cuenta o abuso de recuperación | Login PKCE, callback loopback de un uso, lista y revocación individual/conjunta de sesiones, rate limits, PIN de seis dígitos de un uso válido cinco minutos y limitado a verificación/recuperación. Emitir códigos al activar MFA. Retirar factores solo tras revisión manual del administrador y una prueba independiente preexistente, según el [runbook](../runbooks/recuperacion-cuenta.md). | El acceso al correo por sí solo no inicia sesión ni elimina factores. Si no queda prueba independiente, denegar la retirada y permitir crear cuenta nueva. Avisar al usuario y registrar categoría/decisión sin conservar evidencias sensibles. MFA/códigos y recuperación siguen sin implementarse. |
| Caída o suplantación de estado público | Servir contenido estático desde el VPS, separado del API, sin datos de usuarios ni diagnósticos de infraestructura sensibles; publicar cambios solo por operación administrativa protegida. | La página no informa de una caída total del VPS o de su red. |

El diseño, los criterios y las decisiones están en el [diseño formal](../designs/sincronizacion-preferencias-y-portabilidad.md), el [plan de implementación](../plans/sincronizacion-preferencias.md), [ADR-0020](../adr/0020-perfiles-y-sincronizacion-opcional.md), [ADR-0023](../adr/0023-servicio-de-sincronizacion.md) y [ADR-0024](../adr/0024-sin-copias-fuera-del-vps.md). El runbook de recuperación está documentado, pero no debe operarse hasta implementar MFA, códigos y la acción privilegiada del VPS y ensayar el flujo.
