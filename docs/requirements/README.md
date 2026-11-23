# Requisitos

Los requisitos distinguen el alcance acordado del estado actual del prototipo. «Pendiente» significa que el requisito pertenece al alcance previsto, pero aún necesita implementación o validación.

## Funcionales

| ID | Requisito | Estado |
| --- | --- | --- |
| FR-01 | Abrir PowerShell, CMD, WSL y Git Bash en una terminal integrada. | Implementación inicial |
| FR-02 | Mantener varias pestañas y cambiar entre ellas. | Implementación inicial |
| FR-03 | Mostrar terminales simultáneas en paneles divididos. | Implementación inicial, dos paneles vertical u horizontal |
| FR-04 | Abrir una carpeta de proyecto y crear una terminal con esa carpeta como directorio de trabajo. | Implementado inicialmente |
| FR-05 | Guardar varios perfiles de proveedor y activar uno. | Implementado inicialmente |
| FR-06 | Probar el endpoint y obtener modelos desde `/models`. | Implementado inicialmente |
| FR-07 | Enviar mensajes a `/chat/completions` con modelo seleccionado. | Streaming incremental y cancelación de chat implementados; contratos de proveedores pendientes de validación manual |
| FR-08 | Incluir salida reciente de terminal y contexto acotado del proyecto en una solicitud. | Implementado inicialmente |
| FR-09 | Adjuntar archivos seleccionados explícitamente. | Implementado inicialmente |
| FR-10 | Pedir al modelo un plan de acciones estructurado y mostrarlo antes de aplicar. | Implementado inicialmente |
| FR-11 | Ejecutar comandos con confirmación por acción, reglas configurables o modo automático explícito. | Implementado inicialmente; reglas heurísticas |
| FR-12 | Modificar archivos del proyecto solo con aprobación explícita y respaldo del original. | Implementado inicialmente |
| FR-13 | Mostrar bloques de comandos y resultados como unidades navegables. | Implementación inicial; PowerShell, CMD y Bash señalizan fin/código cuando sus hooks están activos; edición de línea y shells personalizados requieren validación manual |
| FR-14 | Conservar un historial de chat local y permitir borrarlo. | Implementación inicial en almacenamiento local del WebView; límite de 100 mensajes |
| FR-15 | Cancelar una operación del agente durante la generación o ejecución. | Implementación inicial; cancela planificación, detiene el ciclo automático y envía Ctrl+C al comando activo; validar por shell |
| FR-16 | Sincronizar preferencias y metadatos de perfiles entre dispositivos con cuenta opcional. | Diseño aprobado; pendiente implementación |
| FR-17 | Elegir entre 12 paletas visuales y cambiar entre modo claro y oscuro. | Implementación inicial |
| FR-18 | Mantener la preferencia de apariencia tras reiniciar Laural. | Implementación inicial; localStorage |
| FR-19 | Revisar el contexto terminal/proyecto/archivos antes de enviarlo al proveedor. | Implementación inicial; muestra el contenido con los mismos límites de envío |
| FR-20 | Consultar, descargar e instalar actualizaciones de GitHub; permitir decisión manual o instalación automática y mostrar versión. | Integrado para instaladores NSIS de Windows; validación real de release pendiente |
| FR-21 | Consultar y borrar el historial local de acciones del agente. | Implementado con metadatos mínimos, límite de 200 eventos/64 KiB y sin contenido de usuario |
| FR-22 | Buscar acciones, sesiones y comandos recientes desde una paleta; reutilizar un comando sin ejecutarlo automáticamente. | Implementación inicial; historial solo en memoria, limitado a 100 comandos |
| FR-23 | Exportar/importar preferencias y, opcionalmente, claves de proveedor entre equipos sin cuenta. | Diseño aprobado; pendiente. Las claves solo podrán exportarse cifradas con contraseña obligatoria; sincronización nunca las incluye |
| FR-24 | Proteger la cuenta de sincronización con email/contraseña, Google, passkeys y TOTP; usar PIN solo para verificación o recuperación (nunca como inicio de sesión ni sustituto de MFA) y enviar correo transaccional con Resend desde el backend. | Email/contraseña con challenge TOTP, enrolamiento, passkeys passwordless con TOTP adicional si está activo, códigos de recuperación y avisos transaccionales de cambios TOTP/passkey integrados detrás de flags; CI prueba PostgreSQL temporal. Google, entrega/monitorización Resend y despliegue VPS pendientes |
| FR-25 | Mostrar disponibilidad, incidentes, acciones en curso y mantenimiento en una página pública sin autenticación. | Diseño aprobado; pendiente implementación en el mismo VPS |
| FR-26 | Permitir que el administrador revise manualmente una solicitud tras perder todos los factores; el PIN no retira MFA. | Runbook documentado; recuperación administrativa, acción privilegiada y ensayo pendientes; códigos TOTP disponibles localmente |
| FR-27 | Restablecer la contraseña de una cuenta verificada con un PIN de correo de un solo uso, sin iniciar sesión ni alterar factores MFA. | Implementado localmente; despliegue Resend/VPS y validación PostgreSQL en CI pendientes |
| FR-28 | Permitir al titular borrar la cuenta de sync y sus datos remotos tras autenticación reciente y confirmación explícita, conservando la configuración local. | API, cascada PostgreSQL y comando Tauri implementados; ensayo en instalación Windows/VPS pendiente |

## No funcionales

| ID | Requisito | Criterio |
| --- | --- | --- |
| NFR-01 | Windows primero. | Paquete x64; Windows 10+ con WebView2 como plataforma objetivo inicial. |
| NFR-02 | Operación local-first. | Inicio y terminal no dependen de cuenta o backend de Laural. |
| NFR-03 | Protección de secretos. | Claves en Windows Credential Manager; nunca en JSON de perfiles ni logs de Laural. |
| NFR-04 | Transporte remoto seguro. | HTTP solo en loopback; HTTPS obligatorio para hosts remotos; el cliente no sigue redirecciones del proveedor. |
| NFR-05 | Control de alcance de archivos. | Escrituras limitadas al directorio canónico del proyecto abierto. |
| NFR-06 | Contexto con límites. | Número y tamaño de archivos, salida terminal y mensajes acotados antes de enviar. |
| NFR-07 | Accesibilidad básica. | Navegación por teclado, etiquetas accesibles, contraste suficiente y escalado de ventana. |
| NFR-08 | Instalación reproducible. | Instrucciones de desarrollo y empaquetado versionadas junto al código. |
| NFR-09 | Sin telemetría por defecto. | Ningún evento de uso sale a un servicio de Laural. |
| NFR-10 | Portabilidad y sincronización local-first. | Snapshot cerrado/versionado; guardar local antes de red; claves y datos de proyecto nunca sincronizados. |
| NFR-11 | Legibilidad visual. | Contraste de texto y controles legibles en las 12 paletas y en ambos modos; cambio de tema no debe reiniciar shells. |
| NFR-12 | Integridad de actualizaciones. | HTTPS y firma del paquete verificada con clave pública antes de instalación; secreto privado solo en GitHub Actions. |
| NFR-13 | Privacidad del historial de terminal. | Los comandos recientes viven solo en memoria y se pierden al cerrar Laural; nunca se persisten ni sincronizan. |
| NFR-14 | Protección de credenciales exportadas y locales. | Sin claves en claro en archivos; Credential Manager para almacenamiento local y cifrado autenticado con contraseña para transferencia de claves. No prometer protección contra malware de la sesión activa. |
| NFR-15 | Transparencia del servicio hospedado. | TLS, logs sin payloads/secrets y aviso de que el operador puede leer snapshots permitidos; la primera versión no ofrece E2EE. |

## Supuestos y dependencias

- El shell que el usuario seleccione está instalado y es accesible en Windows.
- WSL y Git Bash no se instalan ni administran desde Laural.
- El servidor del proveedor anuncia modelos y admite el formato de chat solicitado.
- El usuario dispone de permisos para leer la carpeta de proyecto, iniciar shells y escribir los archivos aprobados.
- Los instaladores de Windows requieren WebView2 Runtime y dependencias del sistema compatibles.
