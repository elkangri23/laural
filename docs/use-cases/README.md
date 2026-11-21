# Casos de uso

Los casos describen el comportamiento esperado del producto. Los estados distinguen la implementación inicial de trabajo todavía pendiente.

| ID | Caso | Actor principal | Estado |
| --- | --- | --- | --- |
| UC-01 | Abrir una terminal y seleccionar shell | Desarrollador | Implementación inicial |
| UC-02 | Trabajar en varias terminales y proyecto | Desarrollador | Implementación inicial |
| UC-03 | Configurar y cambiar perfiles de modelo | Desarrollador | Implementación inicial |
| UC-04 | Preguntar al chat con contexto escogido | Desarrollador | Implementación inicial |
| UC-05 | Solicitar un plan al agente | Desarrollador | Implementación inicial |
| UC-06 | Revisar y ejecutar comandos propuestos | Desarrollador | Implementación inicial |
| UC-07 | Revisar y aplicar cambios de archivo | Desarrollador | Implementación inicial |
| UC-08 | Usar Laural sin servicio externo de Laural | Desarrollador | Implementación inicial |
| UC-09 | Instalar Laural en Windows | Colaborador/usuario | Paquete creado; instalación aún no validada |
| UC-10 | Elegir tema y modo claro/oscuro | Usuario | Implementación inicial |
| UC-11 | Revisar contexto antes de enviarlo al proveedor | Desarrollador | Implementación inicial |
| UC-12 | Detener una planificación o comando del agente | Desarrollador | Implementación inicial; validar en cada shell |
| UC-15 | Consultar y borrar actividad del agente | Desarrollador | Implementado; registro local de metadatos acotado |
| UC-17 | Exportar/importar perfil sin cuenta | Usuario | Implementación inicial; ensayo Windows pendiente |
| UC-18 | Transferir claves en archivo cifrado | Usuario | Implementación inicial; pruebas de rollback pendientes |
| UC-19 | Activar cuenta y escoger snapshot inicial | Usuario | Login Tauri y elección manual inicial disponibles; VPS pendiente |
| UC-20 | Sincronizar cambios y resolver conflicto | Usuario | Cliente manual/automático inicial; VPS y reconexión real pendientes |
| UC-21 | Recuperar acceso tras perder factores | Usuario/administrador | Diseño aprobado; runbook pendiente |
| UC-22 | Consultar estado público del servicio | Visitante | Página y contrato iniciales; despliegue y operación pendientes |
| UC-23 | Consultar rama, cambios y diff Git | Desarrollador | Implementación inicial de solo lectura |
| UC-24 | Preparar una tarea repetible con una receta del agente | Desarrollador | Implementación inicial; se guarda localmente |

Los casos UC-17 y UC-18 están disponibles en Configuración en su implementación inicial. UC-19 y UC-20 tienen un cliente inicial, pero requieren un servicio desplegado para su validación real. UC-21 sigue pendiente; UC-22 tiene una implementación local que requiere operación del VPS. Los flujos de sincronización están detallados en [portabilidad y sincronización](sincronizacion-preferencias.md).

## UC-01 — Abrir terminal

**Objetivo:** iniciar un shell disponible y trabajar interactivamente.

**Precondiciones:** Laural está abierta y el shell seleccionado está instalado.

**Flujo principal:**

1. La persona abre una pestaña y selecciona PowerShell, CMD, WSL o Git Bash.
2. Laural inicia el shell en el directorio inicial seleccionado o en el perfil de usuario.
3. La persona escribe comandos y ve salida en la terminal integrada.
4. La persona puede añadir pestañas, cambiar de pestaña o cerrar una sesión.

**Alternativas y errores:** si el ejecutable no está instalado o no arranca, Laural muestra un error en el panel. Cerrar la pestaña termina su proceso asociado y libera el contexto. Al salir de Laural, el backend termina los shells activos. La salida mostrada se entrega a la terminal por fragmentos; los bloques conservan hasta 24.000 unidades UTF-16 recientes. Si el shell finaliza o falla al iniciar, **Reiniciar terminal** abre otra sesión con el mismo shell y directorio inicial.

**Criterios de aceptación:** entrada, salida, resize y cierre se mantienen en la sesión elegida; cerrar una pestaña no cierra las demás.

## UC-02 — Abrir proyecto y organizar terminales

**Objetivo:** trabajar en una carpeta con más de un shell o tarea simultánea.

**Flujo principal:** elegir una carpeta, iniciar una terminal en ella, crear nuevas pestañas y mostrar dos terminales en paneles divididos.

**Alternativas:** si la carpeta no existe o no es accesible, informar sin iniciar una terminal con ruta inválida.

**Criterios:** cada terminal mantiene su propio shell y directorio de trabajo; el cambio de tamaño actualiza el área PTY.

**Pendiente:** persistencia del layout y validación de la detección de bloques en shells y prompts personalizados.

## UC-03 — Configurar proveedor y modelo

**Objetivo:** asociar Laural a un servidor local o endpoint OpenAI-compatible.

**Flujo principal:** elegir perfil proveedor, indicar URL, introducir clave opcional, probar conexión, seleccionar un modelo y guardar. Se pueden guardar perfiles separados y cambiar el activo.

**Alternativas:** indicar errores de conexión, autenticación, respuesta incompatible o lista vacía. No incluir la clave en mensajes de error.

**Criterios:** perfiles no secretos persisten localmente; clave queda en Windows Credential Manager; HTTP remoto se rechaza; HTTPS remoto y HTTP loopback se aceptan.

## UC-04 — Chat con contexto elegido

**Objetivo:** preguntar sobre salida del shell, proyecto abierto y archivos adjuntos.

**Flujo principal:** abrir chat, revisar las señales de contexto, añadir archivos si es necesario, escribir pregunta y enviar. La respuesta aparece en la conversación.

**Límite de privacidad:** el contexto se entrega al endpoint activo. El usuario debe conocer proveedor y modelo antes de enviar.

**Criterios:** limitar número y tamaño de archivos y salida; ignorar rutas fuera de contexto permitido; mostrar errores del proveedor sin registrar claves.

Si la conexión se corta antes del final o el proveedor envía un evento inválido, el chat conserva el texto recibido y muestra el error. Se admite una respuesta de hasta 2 MB de texto UTF-8.

**Implementado inicialmente:** vista previa del contexto limitado, streaming cancelable e historial local borrable. La exclusión de rutas es fija, no configurable.

## UC-05 — Pedir plan al agente

**Objetivo:** recibir pasos para cambiar el proyecto usando información contextual.

**Precondiciones:** hay proveedor configurado y carpeta de proyecto abierta.

**Flujo principal:** describir la tarea, pedir plan, recibir resumen y lista acotada de comandos o cambios de archivo, revisar cada acción.

**Criterios:** el backend valida JSON, número de acciones, longitud de comandos y rutas relativas; el texto del proyecto se trata como entrada no confiable.

## UC-06 — Autorizar comandos del agente

**Objetivo:** ejecutar un comando propuesto bajo la política del usuario.

**Flujo principal:** el agente propone comando y motivo; Laural muestra ambos; aplica el modo de confirmación, reglas o automático; escribe el comando en terminal activa; presenta salida.

**Alternativas:** comandos de riesgo reconocido se bloquean en ejecución automática o por regla y requieren confirmación manual; se puede rechazar una acción.

**Criterios:** rechazos no envían bytes al shell; el modo efectivo se ve en UI; comandos de varias líneas se rechazan; el bloque muestra salida y código cuando el shell emite la marca de fin.

**Riesgo residual:** el análisis de comando es heurístico y se puede evadir; modo automático no es sandbox.

## UC-11 — Revisar contexto del proveedor

**Objetivo:** saber qué contenido de la terminal, proyecto y archivos seleccionados se enviará al proveedor.

**Flujo principal:** abrir «Revisar contexto», inspeccionar cada sección con los límites aplicados y cerrar antes de enviar la consulta.

**Criterios:** la vista previa se genera desde el mismo backend que arma el contexto del chat y no incluye credenciales del proveedor.

## UC-12 — Detener agente

**Objetivo:** cancelar una planificación, detener la secuencia automática o interrumpir el comando activo.

**Flujo principal:** pulsar «Detener agente»; Laural cancela la petición de plan y, si hay un comando enviado, transmite Ctrl+C al PTY. La secuencia automática no envía acciones posteriores.

**Límite:** un proceso puede ignorar Ctrl+C o continuar por trabajo delegado a procesos hijos. La cancelación no revierte cambios ya realizados.

## UC-07 — Aplicar cambio de archivo

**Objetivo:** permitir que una propuesta edite un archivo dentro del proyecto.

**Flujo principal:** el modelo propone una ruta relativa y contenido; la persona revisa la propuesta; al aprobar, Laural valida la ruta, prepara el contenido y sustituye el archivo. Si ya existía, conserva su versión anterior en `.laural-backups`.

**Criterios:** nunca sobrescribir fuera de la carpeta canónica; rechazar rutas absolutas y `..`; limitar tamaño; mantener respaldos excluidos del contexto automático.

## UC-08 — Uso local-first

**Objetivo:** trabajar sin cuenta ni servicio alojado por Laural.

**Flujo principal:** utilizar un modelo local o remoto configurado, terminales locales, perfiles y política en disco local.

**Criterios:** no se contacta infraestructura de Laural en funcionamiento normal; al usar proveedor remoto, las solicitudes van al proveedor configurado.

## UC-09 — Instalar Laural en Windows

**Objetivo:** instalar aplicación compilada desde el paquete x64.

**Precondiciones:** Windows compatible y WebView2 Runtime.

**Flujo esperado:** iniciar paquete MSI o EXE, revisar editor y origen, instalar, abrir Laural, crear terminal y configurar endpoint de prueba.

**Estado:** compilación de los dos formatos completada en el equipo de desarrollo. La instalación limpia todavía necesita validación antes de anunciar una release estable.

## UC-10 — Personalizar la apariencia

**Objetivo:** adaptar contraste y color de acento al gusto del usuario.

**Flujo principal:** abrir **Configuración → Apariencia**, elegir modo claro u oscuro y seleccionar una de las doce paletas. La interfaz y terminal reflejan la selección; Laural la guarda localmente.

**Criterios:** hay exactamente doce opciones etiquetadas, cada una ofrece modo claro y oscuro, la selección activa se anuncia con `aria-pressed`, el tema persiste al reiniciar y el terminal mantiene su sesión al cambiar colores.

## UC-14 — Consultar e instalar actualizaciones

**Objetivo:** mantener Laural actualizado desde sus publicaciones oficiales sin una cuenta propia.

**Flujo principal:** en el primer inicio, elegir instalación manual o automática. La app consulta al abrir y cada seis horas. En modo manual, el usuario abre el aviso, descarga, ve el estado «lista para instalar» y pulsa **Instalar y reiniciar**. En modo automático, Laural descarga e instala al encontrar una versión nueva. En Configuración se muestra la versión actual y se puede buscar de inmediato.

**Criterios:** las actualizaciones usan HTTPS y deben superar la verificación de firma antes de instalarse. Una consulta fallida ofrece reintentar y no bloquea el resto de la app. Instalar cierra las sesiones de terminal abiertas. Las versiones previas a alpha.14 requieren una instalación manual inicial.

## UC-13 — Gestionar preferencias del equipo

Desde la barra lateral, abre Configuración. Selecciona Apariencia para cambiar la paleta o Proveedores y modelos para conectar un servidor. En Permisos del agente elige el modo y, si corresponde, guarda una regla por línea. Al reabrir Laural deben recuperarse los ajustes guardados. Si falla el guardado, revisa el mensaje del formulario antes de ejecutar el agente.

Al cambiar de servidor en UC-13, se crea un perfil independiente. Al habilitar reglas, el comando completo debe coincidir con una entrada guardada. Los argumentos adicionales requieren revisión.
Después de aplicar un archivo, el usuario puede listar copias y restaurar una versión anterior. La restauración conserva primero el contenido actual.

## UC-15 — Consultar actividad del agente

**Objetivo:** revisar el resultado reciente de las acciones del agente sin persistir su contenido.

**Flujo principal:** abrir **Configuración → Actividad del agente**, consultar los últimos eventos y, si se desea, confirmar el borrado del historial.

**Datos guardados:** tipo de acción, resultado categorizado y hora; hasta 200 eventos o 64 KiB. La vista muestra como máximo los 30 más recientes.

**Límite de privacidad:** comandos, rutas, prompts, salida, contenido de archivos, URLs, claves y detalles de error no se registran ni se envían. Si falla el registro, no se bloquea la acción del agente.

## UC-16 — Buscar acciones y reutilizar comandos recientes

**Objetivo:** abrir acciones frecuentes, cambiar de sesión y recuperar un comando sin volver a escribirlo.

**Flujo principal:** pulsa `Ctrl+K` o el botón de búsqueda. Escribe parte del nombre de una acción, una sesión o un comando. Elige una acción para abrirla o cambiar de pestaña; al elegir un comando, Laural lo copia al portapapeles para que puedas revisarlo y pegarlo manualmente.

**Criterios:** la paleta se cierra con `Escape`; el historial no supera 100 comandos y solo vive en memoria. La paleta no ejecuta comandos. Los comandos no se envían a los servicios de Laural ni se incluyen en la sincronización.

## UC-23 — Consultar el estado Git del proyecto

**Objetivo:** revisar rama, archivos preparados/modificados y diff del proyecto abierto desde Laural.

**Flujo principal:** abre **Panel Git** desde la barra de herramientas. Laural consulta el repositorio con comandos Git de solo lectura y muestra los cambios preparados y sin preparar. La persona puede actualizar el panel cuando quiera.

**Alternativas:** si la carpeta no es un repositorio Git, Git no está instalado o la consulta excede tiempo/tamaño, se muestra un error y no se ejecutan otras operaciones.

**Privacidad y seguridad:** el diff no se envía al modelo; no se ejecutan comandos por shell, diffs externos, textconv ni fsmonitor. Los archivos no rastreados se listan en estado, pero su contenido no se incluye en el diff.

**Criterios de aceptación:** el panel es de solo lectura, limita salida y tiempo, escapa los nombres como texto y no modifica el índice ni el árbol de trabajo.

## UC-24 — Usar una receta de tarea

**Objetivo:** repetir instrucciones habituales al agente sin volver a redactarlas.

**Flujo principal:** activa el modo Agente, abre **Recetas**, revisa el objetivo y los pasos de una receta, y pulsa **Usar receta**. Laural rellena el compositor; la persona puede editar el texto antes de enviarlo. El agente genera un plan que se revisa bajo los permisos actuales.

**Alternativas:** la persona puede crear, editar o eliminar recetas locales. Datos inválidos o almacenamiento no disponible se informan sin ejecutar acciones.

**Privacidad y seguridad:** las recetas se guardan solo en `localStorage` local y no se sincronizan, exportan ni ejecutan. Elegir una receta no envía solicitudes al modelo ni ejecuta comandos. La generación de plan requiere enviar el mensaje y cada acción queda sujeta a las aprobaciones vigentes.

**Criterios de aceptación:** un objetivo y entre uno y doce pasos de texto acotado; vista previa antes de usar; sin permisos adicionales y sin ejecución directa.

## UC-22 — Consultar el estado del servicio

**Objetivo:** conocer el estado general de sincronización y leer avisos de incidencias o mantenimiento.

**Flujo principal:** la visita `/status` sin iniciar sesión. La página muestra el estado, el resumen, la fecha de actualización y los avisos públicos, y consulta cambios cada minuto.

**Alternativas:** si el documento no existe, no valida o el servicio no puede leerlo, se muestra estado desconocido sin rutas ni errores internos.

**Administración y privacidad:** solo el administrador actualiza el archivo por SSH. No existe modificación web. El contenido no debe incluir cuentas, correos, direcciones IP, logs, secretos, rutas privadas ni detalles de seguridad.

**Limitación:** la página comparte el VPS; una caída total del host también la deja inaccesible.
