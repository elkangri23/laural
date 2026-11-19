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
| FR-13 | Mostrar bloques de comandos y resultados como unidades navegables. | Pendiente; requiere integración shell-aware para identificar fin y estado de cada comando |
| FR-14 | Conservar un historial de chat local y permitir borrarlo. | Implementación inicial en almacenamiento local del WebView; límite de 100 mensajes |
| FR-15 | Cancelar una operación del agente durante la generación o ejecución. | Pendiente |
| FR-16 | Sincronizar configuración/proveedores entre dispositivos. | Diferido; fuera del MVP |
| FR-17 | Elegir entre 12 paletas visuales y cambiar entre modo claro y oscuro. | Implementación inicial |
| FR-18 | Mantener la preferencia de apariencia tras reiniciar Laural. | Implementación inicial; localStorage |

## No funcionales

| ID | Requisito | Criterio |
| --- | --- | --- |
| NFR-01 | Windows primero. | Paquete x64; Windows 10+ con WebView2 como plataforma objetivo inicial. |
| NFR-02 | Operación local-first. | Inicio y terminal no dependen de cuenta o backend de Laural. |
| NFR-03 | Protección de secretos. | Claves en Windows Credential Manager; nunca en JSON de perfiles ni logs de Laural. |
| NFR-04 | Transporte remoto seguro. | HTTP solo en loopback; HTTPS obligatorio para hosts remotos. |
| NFR-05 | Control de alcance de archivos. | Escrituras limitadas al directorio canónico del proyecto abierto. |
| NFR-06 | Contexto con límites. | Número y tamaño de archivos, salida terminal y mensajes acotados antes de enviar. |
| NFR-07 | Accesibilidad básica. | Navegación por teclado, etiquetas accesibles, contraste suficiente y escalado de ventana. |
| NFR-08 | Instalación reproducible. | Instrucciones de desarrollo y empaquetado versionadas junto al código. |
| NFR-09 | Sin telemetría por defecto. | Ningún evento de uso sale a un servicio de Laural. |
| NFR-10 | Portabilidad de datos futura. | Configuración no secreta legible y documentada; sincronización requiere decisión y diseño separados. |
| NFR-11 | Legibilidad visual. | Contraste de texto y controles legibles en las 12 paletas y en ambos modos; cambio de tema no debe reiniciar shells. |

## Supuestos y dependencias

- El shell que el usuario seleccione está instalado y es accesible en Windows.
- WSL y Git Bash no se instalan ni administran desde Laural.
- El servidor del proveedor anuncia modelos y admite el formato de chat solicitado.
- El usuario dispone de permisos para leer la carpeta de proyecto, iniciar shells y escribir los archivos aprobados.
- Los instaladores de Windows requieren WebView2 Runtime y dependencias del sistema compatibles.
