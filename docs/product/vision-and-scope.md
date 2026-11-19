# Visión y alcance

## Resumen

Laural es una aplicación de escritorio local-first para trabajar en terminales de Windows con asistencia de modelos configurables. Reúne terminales, chat contextual y un agente que prepara acciones revisables. Cada persona configura su propio modelo, incluyendo servidores locales o APIs compatibles con OpenAI.

Laural es una implementación independiente. La referencia a otros productos describe la categoría de uso, no una intención de copiar código, marca, recursos o interfaz privada.

## Problema

Quienes trabajan en terminal alternan entre shells, documentación, asistentes y herramientas de edición. El contexto útil queda repartido, y conectar un modelo local o un proveedor distinto suele requerir configuración manual. Laural reúne esos flujos en una aplicación de escritorio y deja al usuario elegir dónde se procesa el contexto.

## Usuarios previstos

- Desarrolladores de Windows que utilizan PowerShell, CMD, WSL o Git Bash.
- Personas que prefieren ejecutar modelos localmente con Ollama o LM Studio.
- Usuarios que desean configurar una API compatible sin depender de un backend de Laural.
- Contribuidores que quieran mantener una aplicación de terminal libre bajo MIT.

## Objetivos del MVP

1. Proporcionar terminales de Windows con pestañas y paneles divididos.
2. Ofrecer 12 temas de color con modos claro y oscuro.
3. Conectar varios perfiles de proveedores y modelos compatibles con `/v1/models` y `/v1/chat/completions`.
4. Permitir preguntas con contexto que el usuario pueda inspeccionar y seleccionar.
5. Permitir que el agente prepare comandos y cambios en archivos del proyecto, con controles claros antes de modificar o ejecutar.
6. Distribuir código fuente y un instalador Windows x64.
7. Funcionar sin registro ni servicio alojado por Laural.

## No objetivos del MVP

- Replicar de forma exacta productos comerciales o usar sus recursos protegidos.
- Ofrecer funciones de pago, cuentas o monetización.
- Sincronizar perfiles, credenciales, proyectos o conversaciones entre dispositivos.
- Ejecutar código de manera aislada en un sandbox propio.
- Soportar macOS o Linux en el primer hito.
- Garantizar compatibilidad con toda API que se describa como OpenAI-compatible.
- Sustituir un IDE, un gestor de secretos ni una solución de acceso remoto.

## Principios

- El usuario escoge proveedor, modelo y contexto enviado.
- El usuario puede cambiar paleta y apariencia sin perder la selección al reiniciar.
- Las credenciales no se guardan en texto plano en la configuración de la aplicación.
- Los cambios de archivos necesitan aprobación explícita.
- La automatización debe poder desactivarse y mostrar qué comando se ejecutó.
- Las rutas de archivos modificados quedan dentro del proyecto abierto.
- La interfaz y la implementación mantienen identidad propia.

## Criterios de resultado

- Inicio de terminal en las cuatro shells instaladas y selección de directorio de trabajo.
- Configuración y cambio entre varios perfiles guardados.
- Cambio entre doce paletas y modos claro/oscuro sin reiniciar sesiones.
- Chat que puede responder usando salida reciente, archivos adjuntos y archivos acotados del proyecto.
- Plan del agente visible antes de actuar; edición de archivo solo tras aprobación.
- Instalador x64 que se instala y arranca en Windows 10/11 limpio con WebView2.
- La documentación permite a una persona nueva ejecutar el modo desarrollo y entender los límites de seguridad.

## Límites conocidos

La versión actual tiene implementación inicial de streaming, historial local, bloques de comandos, vista previa contextual y cancelación del agente. Falta validar estos flujos dentro de la aplicación en los cuatro shells y con cada proveedor. Las políticas del agente no aíslan procesos y Ctrl+C no garantiza detener procesos hijos. La compatibilidad depende de los endpoints que cada servidor implemente.
