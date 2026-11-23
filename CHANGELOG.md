# Registro de cambios

## Sin publicar
- `sfc` ahora requiere aprobación para reparaciones, análisis programados al inicio, cambios de caché, reversión y opciones desconocidas. `/verifyonly` y `/verifyfile` permanecen como verificaciones sin reparación, incluidas rutas offline válidas; un log alternativo pide aprobación porque escribe en disco. Las regresiones comprueban también que reglas exactas no eludan la revisión. UI: 168/168, 79,78 % de cobertura de líneas. Rust: 140 pasadas y 2 pruebas manuales ignoradas; `cargo check` y formato correctos. La suite `cargo llvm-cov` pasa las pruebas pero MSVC no genera el informe local. Referencia: [SFC de Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/sfc).
- `dism` ahora pide aprobación para activar/desactivar características, instalar o quitar paquetes/capacidades, reparar o limpiar imágenes, montar imágenes, escribir logs indicados y ejecutar opciones desconocidas. Las consultas `Get-*`, salud/escaneo/análisis no reparadores y ayuda siguen como lectura; cualquier opción de cambio prevalece aunque coexista una consulta. Regresiones cubren operaciones online/offline y prioridad sobre reglas exactas. UI: 168/168 pruebas, 79,78 % de cobertura de líneas. Rust: 139 pasadas, 2 manuales ignoradas; `cargo check` y formato correctos. `cargo llvm-cov --lib` ejecutó la suite, pero Windows/MSVC no generó datos locales. Clasificación basada en [opciones de servicio de paquetes de DISM](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/dism-operating-system-package-servicing-command-line-options?view=windows-11).
- `powercfg` ahora exige aprobación para cambiar esquemas y valores, activar/desactivar hibernación, sobrescribir informes o ejecutar operaciones desconocidas. Se permiten únicamente consultas documentadas y ayuda explícita. Las regresiones verifican que reglas exactas tampoco autoricen los cambios. UI: 168/168 pruebas, 79,78 % de cobertura de líneas. Rust: 138 pasadas, 2 pruebas manuales ignoradas; `cargo check` y formato correctos. `cargo llvm-cov --lib` ejecutó la suite, pero Windows/MSVC no generó datos locales. Operaciones según [Microsoft Learn](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options).
- `netdom` ahora exige aprobación para unir, mover, quitar o renombrar equipos, gestionar nombres, reiniciar contraseñas/canales seguros, modificar confianzas y para operaciones desconocidas. `query` y `verify` permanecen como lectura, salvo `query /Reset`; la ayuda explícita también es segura. Las regresiones comprueban mutaciones, consultas y que una regla exacta no evada la aprobación. UI: 168/168 pruebas, 79,78 % de cobertura de líneas. Rust: 137 pasadas, 2 pruebas manuales ignoradas; `cargo check` y formato correctos. `cargo llvm-cov --lib` ejecutó la suite, pero Windows/MSVC no produjo datos de cobertura local. Operaciones según [Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netdom) y [sintaxis de `netdom query`](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netdom-query).
- El agente ahora exige aprobación para `auditpol` al cambiar o borrar políticas, restaurar/exportar respaldos y operaciones desconocidas, y para `secedit` al analizar con escritura, configurar, importar/exportar, generar rollback y operaciones desconocidas. `/get`, `/list`, `/validate` y ayuda siguen como lectura; las pruebas confirman que reglas exactas no eluden la aprobación. Suite Rust: 136 pasadas y 2 pruebas manuales ignoradas; `cargo check` y formato correctos. `cargo llvm-cov` ejecutó la suite, pero MSVC no generó perfil local. [Microsoft: auditpol](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/auditpol), [secedit](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/secedit).
- Ampliada la autorización de `net.exe`: exige confirmación al cambiar contraseñas/políticas de cuenta, grupos, recursos compartidos, sesiones, conexiones, archivos remotos, hora o servicios, incluso ante una regla coincidente; conserva consultas reconocidas como lectura. Regresiones cubren mutaciones, lecturas seguras y prioridad sobre reglas. Suite Rust: 134 pasadas y 2 pruebas manuales ignoradas; `cargo check` y formato correctos. `cargo llvm-cov` ejecutó la suite, pero MSVC no generó el perfil; cobertura CI pendiente.
- Quinta medición pasiva de alpha.16 instalada: árbol de 9 procesos durante 30 s (siete muestras), working set estable en 75,6 MiB, memoria privada 254,7–254,8 MiB y CPU acumulada 83,55–83,56 s. La diferencia de working set frente a una muestra anterior muestra que no deben inferirse mejoras sin repetir condiciones equivalentes; la prueba de salida activa dentro de la app sigue pendiente.
- El backend PTY limita a 256 KiB por terminal los bytes no confirmados y espera créditos antes de emitir más salida. La UI confirma cada lote después de que xterm procesa su callback; al cerrar se despierta el lector. Regresiones cubren liberación, ACK inválido, cierre y total confirmado de ráfagas. `terminal_flow.rs` se incorpora al gate CI de 85 % de líneas. Ensayo manual CMD/ConPTY con consumidor simulado: 4 sesiones, 2.100 líneas por sesión, 1.107.192 bytes en total y marcadores/cierres correctos; salida hasta la última marca 124,70 s (8,7 KiB/s). No mide xterm/WebView2 ni CPU/memoria. Verificación: UI 168/168, 79,78 % de líneas; Rust 134 pasadas y 2 pruebas manuales ignoradas; formato correcto. `cargo llvm-cov --lib` ejecutó las pruebas, pero Windows/MSVC no produjo el perfil local (`no coverage data found`). Sigue pendiente medir recursos de la app instalada bajo salida sostenida.
- Microbenchmark en Chromium con el parser real de xterm: 64 eventos de 32 KiB con líneas CRLF (2 MiB) completaron en una mediana de 295,6 ms con 64 escrituras y 268,3 ms con 8 (−9,2 %), cinco muestras por modo. No mide Base64, React, IPC, WebView2 ni la app instalada. La CI del commit `b53ccfb` pasó los tres jobs, incluida cobertura Rust de líneas y ramas.
- La salida PTY se agrupa antes de escribir en xterm y decodificar el contexto: ventana de 16 ms, flush inmediato a 256 KiB y flush al cerrar/desmontar. En una prueba de componente, 64 eventos de 32 KiB producen 8 escrituras xterm y 8 decodificaciones/contextos, conservando los 2 MiB; también se prueban Unicode dividido, límites, finalización y cancelación.
- Verificación de la agrupación: UI 167/167, 79,77 % de líneas; `terminalOutput.ts` 98,94 % de líneas / 96,55 % de ramas y `TerminalPane` 92,76 % de líneas. Rust 131/131 pasaron y 2 pruebas manuales quedaron ignoradas; `cargo check`, formato, build y gates pasan. `cargo llvm-cov` ejecuta las pruebas, pero MSVC no produce datos de cobertura.
- Repetido dos veces el ensayo manual de 16 terminales CMD/ConPTY: 16.000 líneas, 2,10 MB y 41,48–44,55 s (48,9–51,9 KiB/s); creación de shells 0,78–1,13 s, primer prompt 0,15–0,19 s, despacho 0,55–0,61 s y cierre 0,02 s. Un muestreo exploratorio de memoria/CPU no capturó el árbol completo durante suficiente tiempo, así que no se usa como métrica de recursos. El ensayo no incluye UI ni IPC de la app.
- Verificación tras la medición: interfaz 162/162, 79,37 % de cobertura de líneas; Rust 131 pasadas y 2 pruebas manuales ignoradas; formato, build, ocho gates de cobertura Rust y dos pruebas del límite de bundles correctos. El mayor bundle sigue en 336,25 KB frente al límite de 500 KiB.
- Se probó un mock de `AppHandle` de Tauri para cubrir emisión del backend, pero su feature de test hizo que el binario Rust terminara al cargar en este entorno Windows (`STATUS_ENTRYPOINT_NOT_FOUND`), incluso con un test unitario existente. Se retiró el experimento y se confirmó que la suite normal vuelve a ejecutar. La cobertura Rust sigue generándose en CI, no con MSVC local.
- Instrumentado el ensayo de 16 terminales para separar arranque, prompts, salida y cierre. Con búfer de 32 KiB: 0,86 s en crear shells, 0,07 s al primer prompt, 0,40 s en despachar, 39,87 s recibiendo la salida y 0,02 s en cerrar; actualizados roadmap y backlog con el límite de esta medición.
- Añadido un ensayo manual Windows del máximo de 16 sesiones CMD/ConPTY; comprueba 1.000 líneas por sesión, salida aislada y cierre correcto. Tres ejecuciones: 43,2–51,0 KiB/s. Documentada la limitación: no mide UI/IPC ni recursos de Laural completa. Suite Rust: 131 pasadas, 2 ignoradas; `cargo llvm-cov` no generó informe en MSVC. UI 162/162 (79,37 %); servicio 180/180 con PostgreSQL 16 (90,26 % de líneas / 80,01 % de ramas).
- Añadido un gate de tamaño al build: falla si un bundle JavaScript supera 500 KiB. El build actual valida 10 bundles; el mayor mide 336,25 KB. Tests de frontera: 2/2; UI 162/162 (79,37 % de líneas); servicio 180/180 con PostgreSQL 16 (90,26 % de líneas / 80,01 % de ramas); build y gates de cobertura correctos.
- Revalidada la cadena de dependencias: npm escritorio/servicio sin vulnerabilidades; gate Cargo de CI pasa. Se documentan cinco avisos transitivos sin mantenimiento y la excepción Linux de GLib; no hay actualización corregida disponible.
- Añadida al roadmap una cuarta muestra pasiva de recursos de la instalación Windows y el resultado de la revisión visual intentada. Siete muestras en 42 s: 9 procesos, 127,3–127,4 MiB de working set, 253,7–253,9 MiB de memoria privada y CPU acumulada estable; no representa carga activa. La herramienta no pudo activar la ventana, por lo que la inspección visual sigue pendiente.
- Añadido `npm run status:publish -- <archivo-status.json>` para publicar el estado público desde Linux/SSH. Valida el esquema cerrado antes de escribir, sincroniza un temporal con permisos 0644 y sustituye el archivo de forma atómica; limpia temporales ante fallos y conserva el documento anterior. Actualizados ADR-0032, runbook, requisitos, diseño, roadmap y backlog. No añade sondeos en vivo ni una ruta web de escritura.
- Verificación local: servicio 180/180 pruebas con PostgreSQL 16, cobertura 90,26 % de líneas / 80,01 % de ramas; `public-status.ts` alcanza 100 % de líneas. UI 162/162 con 79,37 % de líneas (repetición con timeout ampliado tras un timeout aislado al ejecutar en paralelo); builds de UI y servicio correctos.
- Añadido el reenrolamiento TOTP tras aprobación administrativa: enlace temporal de un uso, ticket cifrado en outbox, CSRF y cookie segura. Solo al confirmar el TOTP nuevo sustituye factores, elimina passkeys anteriores, revoca sesiones/códigos pendientes y encola aviso. No crea sesión y entrega códigos nuevos una sola vez. Migración 014, ADR-0050, UC-21, roadmap, backlog y runbook actualizados.
- Verificación actual: servicio 177/177 pruebas con PostgreSQL 16; cobertura 90,17 % de líneas y 80 % de ramas; build de servicio correcto.
- La CLI administrativa ahora informa que una aprobación emite un enlace temporal y que los factores solo cambian tras confirmar el TOTP nuevo.

- La CLI Linux de revisión registra decisiones con evidencia independiente y emite un enlace cifrado de un solo uso para el reenrolamiento descrito en ADR-0050; no elimina factores ni concede acceso por sí misma.
- La cifra de cobertura vigente está en la primera entrada de esta sección; los resultados posteriores son históricos.
- Añadida la solicitud web de revisión por pérdida de factores, desactivada por defecto. El PIN de correo solo verifica el buzón; tras confirmarlo, una outbox envía al administrador el identificador del caso. El PIN no inicia sesión, cambia la contraseña ni altera TOTP/passkeys. ADR-0048, UC-29, runbook, roadmap y backlog actualizados.
- Verificación del servicio: 166/166 pruebas con PostgreSQL 16 aislado, 89,72 % de líneas, 79,82 % de ramas; build correcto. La herramienta administrativa para decidir y retirar factores, y el ensayo VPS, siguen pendientes.
- Añadido un runbook para configurar Google OAuth, aplicar migraciones, activar gradualmente el flag, probar registro/vinculación/MFA y revertir. Corregido el runbook de recuperación para reflejar passkeys y Google implementados localmente pero todavía desactivados; credenciales y ensayo VPS siguen pendientes.
- Ampliadas las regresiones OAuth unitarias y PostgreSQL real: vincula una identidad verificada a una cuenta existente verificada y rechaza el correo local que aún no se verificó. Se amplió a 15 s el límite de la prueba integral de login que usa Argon2, tras observar un timeout ocasional con el límite general de 5 s.
- Añadido acceso y registro opcional con Google OIDC para las cuentas de sincronización. Usa `state`, `nonce` y PKCE de un solo uso, exige correo verificado, vincula identidades por `sub`, conserva TOTP y no almacena tokens Google. La migración 011, ADR-0047, UC-28 y guías quedaron documentadas; el flag sigue apagado hasta configurar credenciales y validar el VPS.
- Verificación local: 159/159 pruebas con PostgreSQL 16 aislado; cobertura 89,60 % líneas / 80,05 % ramas. Build del servicio correcto y `npm audit` sin vulnerabilidades. Pendientes credenciales reales de Google Cloud, ensayo end-to-end y migración/validación en VPS.
- La página pública de estado ahora muestra API, sincronización y correo por separado, con estados allowlist publicados manualmente; indica que no son comprobaciones en vivo y conserva fallback seguro y renderizado sin HTML.
- Verificación: build y validador del documento correctos; servidor 149/149 con PostgreSQL 16 aislado, 90,13 % de líneas; `public-status.ts` con 100 % de líneas. Pendiente validación visual y despliegue en VPS.
- Añadido historial cloud de preferencias: consulta paginada, borrado por versión y restauración como revisión nueva con concurrencia e idempotencia. Se conserva la revisión reemplazada y la app crea una copia `.laural` antes de aplicar la restauración; las API keys siguen excluidas. Migración 010, ADR-0045 y documentación actualizados.
- Verificación: servidor 149/149 pruebas con PostgreSQL 16 aislado, 90,13 % de líneas y 81,08 % de ramas. Interfaz 162/162 y 79,39 %; Rust 131 pasadas, 1 ignorada y `cargo check` correcto. `cargo llvm-cov` ejecuta los tests, pero MSVC no genera datos de cobertura.
- Los cambios de preferencias de Microsoft Defender mediante `Add-MpPreference`, `Set-MpPreference` o `Remove-MpPreference` ahora requieren aprobación; las consultas `Get-MpPreference` siguen siendo de lectura.
- Verificación: Rust 131 pasadas y 1 ignorada; UI 161/161 (79,18 % de líneas), ocho gates y formato correctos. LLVM ejecuta Rust, pero MSVC no genera el informe local.
- El agente exige aprobación manual para `runas`, `gsudo`, `doas`, `su` y `pkexec`, que pueden cambiar de usuario o ejecutar procesos con privilegios elevados; las reglas permitidas no eluden esta revisión.
- Verificación local: Rust 131 pasadas y 1 ignorada; UI 161/161 (79,18 % de líneas), 8 gates de cobertura y formato correctos. `cargo llvm-cov` ejecuta Rust, pero MSVC no genera datos para el informe local.
- En Windows, las ediciones del agente ahora rechazan el reemplazo cuando otro editor mantiene el archivo abierto para escritura, conservando el contenido y sin crear una copia inconsistente.
- Verificación local: Rust 131 pasadas y 1 ignorada; UI 161/161 (79,18 % de líneas), 8 gates de cobertura y formato correctos. `cargo llvm-cov` ejecuta Rust pero no genera informe instrumentado en Windows/MSVC.
- El agente exige aprobación antes de ejecutar `taskkill` o `Stop-Computer`, incluso si coinciden con una regla permitida; las consultas de procesos siguen disponibles sin revisión.
- Verificación local: Rust 129 pasadas y 1 ignorada; UI 161/161 (79,18 % de líneas); 8 pruebas de política de cobertura y formato correctos. La generación de cobertura Rust continúa sin datos en Windows/MSVC.
- `git config` requiere aprobación manual también cuando se antepone `-C` u otra opción global; las regresiones cubren alias persistentes y `core.sshCommand`.
- Se exige aprobación para ejecutar y gestionar contenedores con Docker/Compose; se conservan consultas Compose reconocidas como solo lectura.
- Regresiones de Docker/Compose: Rust 129 pasadas y 1 ignorada; UI 161/161 (79,18 % de líneas), gates de cobertura y formato correctos. Windows/MSVC no genera el informe LLVM de Rust.
- Los ejecutores `npx`, `pnpm`, `yarn`, `bun`/`bunx`, `corepack`, `deno`, `pipx` y `uvx` ahora exigen aprobación antes de aplicar reglas o modo automático.
- Las operaciones de cambio en `cmdkey` y `vaultcmd` exigen aprobación; los listados explícitos siguen siendo consultas de lectura.
- Los lanzadores SSH/SCP/SFTP, PuTTY, PsExec, WinRS y la gestión de sesiones remotas PowerShell ahora requieren aprobación manual.
- Las utilidades Windows `msiexec`, `wmic`, `bitsadmin` y `certutil` requieren aprobación antes de ejecutarse.
- Verificación: Rust 130 pasadas y 1 ignorada; UI 161/161 (79,18 % líneas), 8 gates de cobertura y formato correctos. MSVC ejecuta la suite Rust pero no genera el informe LLVM.
- Verificación de acceso remoto: Rust 130 pasadas y 1 ignorada; UI 161/161 (79,18 % líneas), gates y formato correctos. La cobertura Rust no genera informe en Windows/MSVC.
- Verificación de credenciales Windows: Rust 130 pasadas y 1 ignorada; UI 161/161 (79,18 % de líneas), 8 gates de cobertura y formato correctos. La cobertura LLVM Rust sigue limitada en Windows/MSVC.
- Verificación: Rust 129 pasadas y 1 ignorada; UI 161/161 (79,18 % de líneas), 8 gates de cobertura y formato correctos. Windows/MSVC no genera el informe de cobertura Rust.
- La suite local pasa: Rust 129/129 ejecutables y UI 161/161 (79,18 % de líneas); los ocho gates de política y el formato Rust pasan. La generación local de cobertura Rust sigue limitada por Windows/MSVC.
- El segundo factor TOTP y los códigos de recuperación comparten un límite de diez intentos por cuenta cada cinco minutos entre flujos e IP. La cuenta se obtiene del flujo ligado al primer factor y PostgreSQL conserva solo su HMAC.
- CI `45192735950` pasó los tres jobs; el servicio ejecutó 144/144 pruebas con PostgreSQL real, incluida la regresión de límite MFA entre flujos.
- Endurecidos registro, verificación y recuperación de cuenta con límites compartidos por correo normalizado entre API y formulario nativo. La base de datos conserva solo huellas HMAC; los intentos fallidos reciben `429` y `Retry-After`.
- La integración PostgreSQL comprueba los límites cruzados entre API y formulario desde IP distintas y verifica que los contadores solo guardan el HMAC del correo.
- La integración PostgreSQL y los gates de cobertura terminaron en verde en CI (`45185068795`).
- El inicio de sesión limita a diez intentos por correo normalizado y minuto entre IP, después de validar CSRF.
- Corregida la actualización transaccional de intentos fallidos en PostgreSQL: el contador se incrementa en SQL y no produce una incompatibilidad de tipos.
- CI `45189988942` pasa en los tres jobs: integración PostgreSQL, cobertura de escritorio y gates de cobertura Rust.

## 0.1.0-alpha.17

- Publicada el 23-11-2026 como pre-release NSIS x64 con instalador y manifiesto de actualización firmados y checksum verificado. SHA-256: `B965085B9EB6F193DBFE19BF1FB847FD1D179D0FB909EB791D7D62980A3B1DF8`.
- Corregida la búsqueda manual de actualizaciones: ahora respeta el modo guardado. En modo automático descarga e instala reiniciando Laural; en modo manual deja la descarga lista para que el usuario decida cuándo instalar.

## 0.1.0-alpha.16

- Publicada el 23-11-2026 como pre-release NSIS x64 con firma del updater, manifiesto `latest.json` firmado y suma SHA-256 del instalador. SHA-256: `A49D9017FB060B75DB5726EE4CA4DBE4093C49975B1BA80A57A531E4520A709B`.
- Actualizado `cookie` de 0.18.2 a 0.18.3 para corregir el aviso RUSTSEC-2026-0594 publicado el 23-11-2026; la auditoría Rust vuelve a pasar salvo los avisos de crates sin mantenimiento ya documentados.
- Los mensajes de error de proveedores ocultan la clave API si el servidor la devuelve en la respuesta, tanto al consultar modelos como en chat, streaming y planificación.
- La tarjeta lateral deja de mostrar «Conecta tu modelo» cuando ya hay un proveedor activo; muestra el perfil y modelo seleccionados.
- Validación manual de FreeLLMAPI desde la app: 311 modelos listados y respuesta de chat por streaming correctos. La clave guardada no se mostró ni modificó.
- Las altas y bajas de passkeys ahora encolan un aviso en la misma transacción que modifica la credencial. Resend recibe mensajes genéricos sin nombres, identificadores ni datos del dispositivo; la migración 009 amplía los tipos permitidos del outbox existente.
- Añadido login passwordless con passkeys WebAuthn, conservando TOTP como segundo factor cuando la cuenta lo tenga activo. Configuración permite abrir en el navegador la gestión segura para registrar y revocar hasta diez passkeys; requiere sesión reciente para cambios. Las passkeys están apagadas por defecto y requieren configurar dominio/RP ID y aplicar las migraciones. Pendientes pruebas con autenticadores reales, despliegue VPS y Google OAuth.
- El menú de opciones del perfil se despliega hacia el área principal para que sus elementos no queden fuera del borde izquierdo; añade desplazamiento cuando falta altura.
- El agente solicita aprobación antes de abrir `diskpart` de forma interactiva o pasarle scripts y operaciones; solo deja pasar la ayuda explícita.
- El agente requiere aprobación para comandos de BitLocker que cifran, descifran, bloquean o desbloquean unidades y que administran protectores; conserva ayuda y consultas de estado acotadas.

## 0.1.0-alpha.15

- Publicada el 23-11-2026 como pre-release NSIS x64 con firma del updater, manifiesto `latest.json` y suma SHA-256 del instalador.
- El agente requiere aprobación para eliminar o modificar copias sombra y respaldos con `vssadmin`, `wbadmin` y `diskshadow`; conserva las consultas de listado/estado y ayuda.
- El agente requiere aprobación para operaciones de `pnputil` que instalan o eliminan controladores, cambian el estado de dispositivos o escriben exportaciones; las enumeraciones sin salida a archivo y la ayuda siguen siendo de lectura.
- El agente ahora exige revisión para comandos `netsh` interactivos o que modifiquen red/firewall, y para exportaciones que revelen claves Wi-Fi en texto claro; conserva ayuda y consultas de solo lectura.
- El filtro del agente ahora requiere revisión para crear, modificar, renombrar o eliminar grupos/cuentas locales y para crear, retirar, reanudar o suspender servicios; las consultas `Get-*` siguen siendo de lectura.
- El agente ahora exige revisión para cmdlets PowerShell que crean, limitan, borran o escriben en registros clásicos de eventos; las consultas de eventos siguen siendo de lectura.
- La revisión del agente ahora cubre cmdlets y aliases de PowerShell que modifican propiedades de elementos, incluidos valores del Registro; las consultas de lectura siguen sin revisión adicional.
- La regresión del transporte PTY cubre el máximo exacto de 32 KiB y el rechazo del byte adicional.
- El decodificador PTY acepta solo Base64 estándar con relleno canónico; rechaza espacios, caracteres ajenos al alfabeto y relleno omitido antes de decodificar.
- El formato de evento PTY Base64 ahora usa un fixture compartido por Rust y TypeScript, con una prueba en cada runtime para evitar divergencias del contrato.
- Las terminales inactivas detienen el parpadeo del cursor; solo la visible y activa mantiene la animación, que se reactiva al volver a ella.
- El gate de CI Rust exige ahora 85 % de cobertura de líneas en el módulo de transporte Base64 de terminal; el gate de ramas continúa limitado a módulos con decisiones de código medibles.
- La salida de terminal viaja como Base64 en vez de arrays JSON numéricos, con límite estricto de 32 KiB al decodificar. Una carga de 32 KiB se serializa en menos de la mitad de bytes y mantiene el round-trip exacto.
- Las terminales omiten peticiones de redimensionado repetidas cuando filas y columnas no cambiaron; los tamaños nuevos se aplican sin demora.
- El chat acumula los fragmentos del streaming y solo compone el texto al solicitar una instantánea visual, reduciendo concatenaciones sin cambiar el ritmo de actualización. El benchmark sintético comparativo obtuvo ≈9,6 % menos tiempo al acumular 270.000 caracteres con 375 lecturas; no representa una medición del proceso de escritorio.
- Durante el streaming del asistente, los deltas se acumulan cada 50 ms sin actualizar el estado global de React en cada lote; la interfaz se actualiza como máximo cada 200 ms. Primer fragmento y respuesta final inmediatos, y no se pierden fragmentos si falla la conexión. Regresiones dirigidas cubren los límites temporales, éxito y error.
- El CI mide los commits de React con 20 deltas durante un segundo simulado y limita el total a 14; esto evita reintroducir una actualización global por cada lote.
- El historial del chat agrupa escrituras locales cada 500 ms durante streaming, hasta diez veces menos frecuentes, y fuerza el guardado al ocultar la ventana.
- Las filas del chat ya no se vuelven a renderizar cuando un delta solo actualiza otra respuesta.
- El Markdown de la respuesta activa se actualiza como máximo cada 200 ms durante el streaming; el primer fragmento y el resultado final aparecen de inmediato.
- La captura de texto de la terminal para contexto y bloques se agrupa durante 16 ms; la salida visible sigue inmediata y el lote pendiente se vacía al cerrar la sesión.
- Una regresión sintética confirma que 1.500 eventos PTY en una ráfaga producen una sola actualización de contexto, limitada a los últimos 24.000 caracteres; no representa una medición de CPU con carga real.
- El acumulador de contexto PTY conserva fragmentos en una cola acotada, suelta referencias al recortarlos y une el texto una vez por lote.
- Microbenchmark local del módulo real con Node 24: 1.500 fragmentos de 180 caracteres dieron una mediana de 0,127 ms con el acumulador nuevo frente a 2,789 ms con el anterior (22×); salidas idénticas. Es una medición aislada, no de la app completa.
- Los bloques secundarios de comandos actualizan su estado a 20 Hz en vez de 30 Hz; el terminal visible sigue escribiendo al instante y los bloques vacían siempre el último fragmento al terminar.
- Cada bloque de comando ahora está memoizado: una salida nueva no vuelve a limpiar y renderizar las otras 29 entradas visibles.
- El historial activo del chat se limita a los últimos 100 mensajes, igual que el almacenamiento y el límite del backend; evita crecimiento indefinido y solicitudes rechazadas al superar el máximo.
- Antes del IPC, el contexto del chat se reduce a los últimos 20 mensajes y 8.000 caracteres Unicode por mensaje, los mismos límites que aplica Rust; evita reenviar respuestas largas completas.
- La limpieza de contadores del limitador ahora trabaja en lotes de hasta 1.000 filas y evita consultas de purga simultáneas dentro de una misma instancia; una regresión PostgreSQL verifica el tamaño real del lote.
- Nueva medición de recursos del proceso release abierto: durante 62 s y con PowerShell presente sin salida/chat, el árbol se mantuvo en 9 procesos, 108,2–108,3 MiB de working set y añadió 0,07 s de CPU. Arranque frío e instalación limpia siguen sin medirse.
- Añadido un runbook de respuesta a incidentes del servicio de sync y actualizado el de recuperación de cuenta para reflejar TOTP/códigos implementados localmente. Se registró una segunda muestra de memoria en reposo de la app Windows y sus límites.
- Mejorado el rendimiento del streaming: los fragmentos del asistente se agrupan cada 50 ms y Markdown evita renderizar mensajes que no cambiaron. La terminal limita a 16 sesiones y cada PTY envía eventos solo a su propia pestaña, con menos eventos por salida.
- Añadidas regresiones para el límite de terminales y el renderizado agrupado del chat. Auditoría actual: npm sin vulnerabilidades conocidas; se mantienen documentados los avisos transitivos Rust sin parche compatible.
- Endurecida la autorización del agente ante evaluación de comandos y cambios persistentes del shell: `eval`, `source`, dot-sourcing, traps, asignaciones compuestas como `PATH+=...` y cambios de variables de sesión/entorno en CMD, PowerShell, Bash y WSL ahora requieren revisión manual. Consultas simples como `$env:PATH` siguen permitidas; perfiles personalizados siguen fuera del alcance.
- En Bash y WSL, las mutaciones con `declare`, `typeset`, `readonly`, `local` y `enable` requieren revisión; listados explícitos como `declare -p PATH`, `readonly -p` y `enable -a/-p` continúan disponibles sin aprobación.
- En PowerShell, las mutaciones de incremento/decremento en prefijo y sufijo (`++$contador`, `++ $contador`, `($contador)++`, `$contador --`) y las asignaciones a variables entre paréntesis requieren revisión. Las lecturas entre paréntesis siguen permitidas.
- Los cmdlets PowerShell `Set-Variable`, `New-Variable`, `Clear-Variable`, `Remove-Variable` y alias como `sv`, `nv`, `clv`, `rv` y `set` requieren revisión; `Get-Variable`/`gv` continúan disponibles para consulta.
- Las escrituras/borrados a través de los proveedores `Variable:` y `Env:` con `Set-Item`, `New-Item`, `Remove-Item` y `Clear-Item` (incluidos alias) también requieren revisión; `Get-Item` de lectura sigue permitido.
- En PowerShell, los modos automático y por reglas ahora requieren confirmación manual porque los perfiles de usuario pueden redefinir comandos con alias y funciones. La política no intenta adivinar qué comandos alteró cada perfil.
- Añadido borrado definitivo de cuenta de sincronización con autenticación de menos de diez minutos y confirmación `ELIMINAR`. El servidor elimina datos asociados en cascada y limita solicitudes; Tauri borra token y estado local de sync, sin borrar perfiles, preferencias ni claves locales. Añadidas pruebas API, cascada PostgreSQL y UI. Pendiente ensayo Windows/VPS y tratamiento operativo de resultado ambiguo por timeout.
- Añadidos avisos de seguridad por correo para activar/desactivar TOTP y renovar códigos de recuperación. La notificación queda en una cola PostgreSQL dentro de la transacción de MFA, se reintenta con espera exponencial y usa una clave idempotente de Resend; no incluye códigos, IP ni datos de dispositivo. Añadidas migración 007 y pruebas PostgreSQL de reintento/flujo MFA. Pendiente probar Resend real y monitorizar la cola antes de habilitar cuentas.
- Integrado TOTP para las cuentas de sincronización: challenge de login, enrolamiento desde Cuenta, códigos de recuperación de un uso y revocación de otras sesiones al cambiar el factor. Los códigos nuevos no se activan hasta confirmar que se guardaron; los códigos previos siguen activos durante una rotación pendiente. Añadidas migración 006, API documentada, pruebas de servicio/login/UI y un flujo de integración PostgreSQL real. MFA sigue detrás del flag; faltan Google/passkeys y validación de despliegue.
- Implementado el restablecimiento de contraseña mediante PIN de correo de seis dígitos y cinco minutos. Respuestas genéricas, HMAC separado, límites y máximo de intentos; el cambio de contraseña invalida sesiones y no inicia sesión ni modifica MFA. Añadidas migración PostgreSQL, correo Resend y pruebas unitarias/de integración. Falta el despliegue/validación del VPS con Resend.
- Documentado el runbook de recuperación de cuenta: el PIN solo demuestra acceso al buzón y el administrador necesita una prueba preexistente e independiente para retirar factores. Sin esa prueba, la solicitud se deniega. El procedimiento todavía no se puede operar; MFA, códigos, acción administrativa local al VPS y ensayos siguen pendientes.
- Añadida gestión de sesiones de cuenta: consulta limitada a 100 sesiones con fechas y marca «Este equipo», y revocación individual de otras sesiones con confirmación. No se guardan ni muestran IP, ubicación, tokens o huellas de dispositivo; se cubre la API con PostgreSQL real en CI.
- Añadida una acción confirmada para revocar todas las demás sesiones, incluida cualquier sesión fuera de las 100 mostradas; el token de este equipo se valida de nuevo dentro de la operación SQL y se mantiene activo.
- Añadida limpieza transaccional al iniciar el servicio y cada hora: PINs de más de 15 minutos, flows/códigos PKCE de más de 24 horas, sesiones revocadas o vencidas e idempotencias de más de 30 días. Las pruebas PostgreSQL comprueban que borra lo antiguo y conserva los registros recientes.
- Los tests de interfaz ahora esperan la resolución real de los módulos lazy antes de interactuar con sus botones, evitando depender de un retardo fijo y corrigiendo falsos fallos en Windows CI.
- Añadida revocación remota de la sesión actual al cerrar cuenta: endpoint autenticado con limitador, invalidación por hash en PostgreSQL y cliente Tauri que borra siempre Credential Manager aunque no haya conexión. La interfaz distingue revocación confirmada de cierre solo local.
- Ampliada la integración PostgreSQL para cubrir registro con Argon2id, verificación de PIN sin inicio de sesión, login nativo PKCE, creación de sesión por hash y uso posterior de sync; el correo se captura en un mailer de prueba y no sale del proceso. El job PostgreSQL de CI pasó.
- La integración PostgreSQL ahora atraviesa Fastify y el almacén real de snapshots: verifica aislamiento por cuenta, lectura/escritura, `ETag`/conflicto, idempotencia y rechazo de campos no permitidos. CI ejecuta esta prueba junto con las migraciones y el rate limit; la integración de login/verificación y el VPS aún quedan pendientes.
- Añadida prueba de integración PostgreSQL aislada: aplica migraciones v1–v5, verifica rate limits, autenticación y restablecimiento con una base efímera en CI. Para correrla localmente, `server` requiere `TEST_DATABASE_URL`.
- El servicio aplica límites persistentes por IP y ruta en PostgreSQL, comparte los contadores entre instancias y guarda solo huellas HMAC de IP. Se limitan auth y snapshots; el exceso recibe `429` con `Retry-After` y el proxy confiable queda restringido a loopback.
- La comprobación al reconectar/volver a primer plano agrupa eventos y se prueba junto a la reanudación. El lector del estado de sync local valida campos obligatorios, contenido, integridad y tamaño antes de usarlo.
- Al recuperar la conexión o volver a la app, se programa una comprobación sincronizada de preferencias; las comprobaciones cercanas se agrupan y la aceptación local de riesgos sigue siendo obligatoria.
- La sincronización queda bloqueada hasta aceptar en este equipo el riesgo de pérdida total del VPS y la lectura de preferencias por su operador. La aceptación protege tanto el flujo automático como las acciones manuales; las claves API siguen excluidas.
- Separada la carga de la terminal, el renderizado Markdown y paneles secundarios: la entrada JavaScript baja de 824 KB a 297 KB; la terminal se sirve en su propio bloque de 336 KB y el Markdown se carga al necesitarlo. Ningún bloque supera 500 KB.
- Mejorado el contraste de etiquetas secundarias de navegación y paneles en ambos modos; pruebas de regresión comparan sus tokens reales con los fondos que usan.
- Mejorado el contraste del texto secundario en modo claro y añadidas regresiones que comprueban ese texto sobre las tres superficies principales de ambos modos.
- Comprobado contraste WCAG AA (4,5:1) del acento como texto en las doce paletas y ambos modos; se oscureció el verde azulado claro para cumplir el umbral.
- El panel Git permite incluir explícitamente el diff en el contexto de chat o agente; aparece como adjunto removible y se muestra en la vista previa antes de enviarlo. El backend limita el tamaño y trata el contenido como dato no confiable.
- El menú general lleva el foco a la primera opción y permite recorrer las acciones con flechas, Inicio y Fin; Escape cierra y devuelve el foco al botón.
- El menú general junto al nombre de Laural ofrece accesos a terminal, proyecto, búsqueda, proveedor, configuración y ayuda; se cierra al pulsar Escape o fuera del menú.
- El menú Más opciones de terminal ofrece accesos rápidos a Git, bloques, asistente, proveedor, copiar selección y limpiar.
- El diálogo de recetas mantiene el foco dentro, permite cerrarlo con Escape y enfoca el formulario al crear o editar.
- Añadida una regresión que verifica la persistencia de recetas propias al cerrar y volver a abrir el panel.
- Los controles de terminal permiten copiar la selección actual y limpiar la pantalla sin ejecutar comandos adicionales.
- La navegación Historial abre una vista filtrada de comandos recientes de la sesión; desde ahí solo se copian, nunca se ejecutan.
- El panel lateral del asistente se puede ocultar y volver a mostrar; la preferencia se conserva en este equipo.
- La paleta de comandos ahora permite recorrer acciones y comandos recientes con las flechas y abrir/copiar con Enter.
- El menú de los tres puntos del perfil local abre configuración, portabilidad y sincronización.
- La paleta `Ctrl+K` incorpora accesos a proyectos, Git, recetas, ayuda y notificaciones.
- El selector del espacio personal ahora muestra su estado local y accesos a proyectos y sincronización.
- Conectados los botones de Ayuda y Notificaciones con sus paneles y acciones correspondientes.
- Añadida la página pública `/status` del servicio, con estado e incidencias desde un documento JSON validado y limitado. La actualización administrativa se hace por SSH mediante archivo persistente; la vista nunca expone errores internos y muestra estado desconocido ante fallos. Aún no está desplegada en el VPS.
- Añadidas recetas de tareas locales y editables para el modo Agente. La vista previa muestra objetivo y pasos; usar una receta solo rellena el compositor. Las recetas no ejecutan comandos, no amplían permisos y no se exportan ni sincronizan.
- Añadido un panel Git local de solo lectura: rama, lista de cambios y diff preparado/no preparado del proyecto abierto. Usa argumentos fijos sin shell, limita proceso y salida, desactiva diff externo/textconv/fsmonitor y no envía contenido al asistente. Pruebas manuales con repositorios reales pendientes.
- El asistente ahora representa Markdown con títulos, listas, tablas, enlaces y código formateado. HTML arbitrario no se ejecuta, los esquemas de enlace se limitan a HTTP(S)/mailto y las imágenes remotas no se cargan.
- Añadida sincronización automática tras guardar tema, modo, proveedor o perfil activo; también al iniciar sesión, al abrir Laural y cada tres horas. Un estado local atómico guarda los snapshots permitidos local/nube, revisión y marca pendiente. Reintenta al volver la conexión y detiene escrituras si otra revisión remota avanzó. Preserva endpoints aceptados desde nube sin re-compartirlos desde este dispositivo; al revocar explícitamente el consentimiento local, quita el endpoint de nube. El servidor sigue sin estar desplegado; falta validar VPS y reconexión/reanudación en Windows.
- Conectado el cliente de escritorio con la API privada de snapshots: consulta `ETag`, escribe con `If-Match` e idempotencia, y no expone la sesión al WebView. Configuración permite comparar, elegir entre equipo/nube y subir por primera vez; aplicar la nube crea antes un `.laural` local sin claves. Las API keys permanecen en Credential Manager y los endpoints no compartidos no se envían. Pendientes auto-sync al guardar, comprobación cada tres horas, cola offline y prueba con VPS habilitado.
- El ejecutor de migraciones ahora es compartido con la integración PostgreSQL: CI comprueba que aplica las cuatro migraciones de forma idempotente antes de probar límites concurrentes. El placeholder del pepper de rate limit ya no pasa la validación; el servicio requiere configurar un secreto real antes de arrancar.
- Añadido el primer servicio privado de snapshots: Fastify, schema v1 cerrado, límite de tamaño, revisión condicional, idempotencia transaccional en PostgreSQL, autenticación mediante hash de sesión y migraciones. Aún no se puede publicar: faltan validación de VPS/Caddy, pruebas PostgreSQL de autenticación, status público operativo y controles de producción.
- Añadido el flujo de registro/verificación por correo, desactivado por defecto: contraseñas Argon2id, PIN aleatorio de seis cifras con HMAC, cinco minutos, cinco intentos y límites de reenvío por cuenta. Resend se configura solo en el servidor; verificar correo no inicia sesión.
- CI incorpora una tarea independiente de Linux para compilar el servicio de sincronización, ejecutar su suite de cobertura y publicar el informe como artefacto.
- Añadida página propia de login en español con contraseña en navegador externo, cookie HttpOnly/CSRF, redirect loopback exacto y canje PKCE de un solo uso. La app abre el navegador, valida `state`, canjea por HTTPS y guarda el token de 30 días solo en Credential Manager; PostgreSQL conserva el hash. Rutas de cuenta desactivadas por defecto.
- Añadido en Configuración el acceso a cuenta: callback IPv4 loopback efímero, comprobación de state en tiempo constante, canje PKCE sin seguir redirecciones y estado de sesión sin exponer el token al frontend. El cierre de sesión ya intenta revocar el token actual y siempre elimina la credencial local.
- Iniciado el contrato v1 compartido para preferencias sincronizables con schema cerrado, fixture común y tipos Rust/TypeScript. Rechaza versiones/campos desconocidos, perfiles duplicados, endpoints no válidos y snapshots mayores de 256 KiB.
- Guardado el tipo de proveedor y el consentimiento opcional por perfil para compartir el endpoint en una futura sincronización; queda desactivado por defecto y los perfiles anteriores conservan sus destinos.
- Añadido el constructor nativo del snapshot v1: incluye tema, apariencia, actualización, proveedor activo y metadatos permitidos. Solo incorpora URLs de perfiles con consentimiento; no consulta ni serializa claves.
- Añadida la primera versión de exportar/importar configuración `.laural` en Configuración, con vista previa y opciones de fusión/reemplazo. Las claves API se excluyen por defecto; al incluirlas, el archivo exige contraseña y usa Argon2id + AES-256-GCM. La importación crea una copia local previa y revierte cambios de claves si falla la aplicación.
- Añadidas regresiones de fallo de escritura de credenciales para comprobar el rollback correcto y la ruta de recuperación si el almacén también falla.
- Endurecido el diseño de exportación/importación: las claves quedan fuera por defecto y solo podrán exportarse con contraseña obligatoria y cifrado autenticado; nunca en texto plano. Documentado el alcance y los límites reales de Credential Manager.
- Añadida paleta `Ctrl+K` para buscar acciones, sesiones y comandos recientes. El historial es efímero y elegir un comando solo lo copia para revisión; no lo ejecuta.
- Verificada la compatibilidad del descubrimiento de modelos con respuestas OpenAI-compatible y Ollama; se ordenan y deduplican los nombres, y se rechazan listas inválidas o vacías.
- Unificadas la preparación del historial y el contexto de chat normal/streaming; una regresión comprueba límites, roles admitidos y etiquetado del contexto como dato no confiable.
- Añadidas regresiones de la aplicación principal para persistencia de tema/modo, disponibilidad de los doce temas, pestañas de shell y orientación de paneles divididos.
- Agrupadas las actualizaciones visuales de salida de terminal en lotes de 33 ms; el contexto queda actualizado inmediatamente y el último lote se muestra al terminar el comando.
- Evitados los renders de los paneles xterm cuando solo se actualizan los bloques de salida; el reinicio conserva una función estable por pestaña.
- Reducido el historial xterm por pestaña de 5.000 a 2.500 líneas; los bloques mantienen los últimos 8.000 caracteres y se conservan hasta 80 bloques. El contexto del asistente mantiene su límite de 24.000 caracteres.
- Configuración incluye un historial local y borrable de actividad del agente con solo tipo de acción, resultado y hora.
- El agente rechaza al recibir el plan los nombres reservados, rutas inválidas de Windows y la carpeta interna de copias; la comprobación se comparte con las operaciones de archivo.
- En Windows, los archivos existentes se mueven a backup y se sustituyen mediante handles con renombrado sin sobrescritura; se fijan los directorios ante cambios concurrentes y se restaura el original si el segundo paso falla y el destino sigue libre.
- Endurecidas la restauración y limpieza de copias en Windows: se fijan los directorios del recorrido; la restauración abre el archivo sin seguir reparse points ni permitir su sustitución mientras se lee.
- El filtro del agente requiere confirmación para comandos habituales de copia, movimiento, truncado y escritura de archivos en Windows y shells tipo Bash.
- Ampliada la revisión obligatoria a comandos habituales que cambian permisos, atributos o crean enlaces simbólicos en Windows y shells tipo Bash.
- Añadida regresión de proveedor que comprueba que una redirección HTTP no reenvía la solicitud autenticada a otro destino.
- La cancelación de chat y planes interrumpe el envío HTTP y la lectura de los cuerpos de respuesta; añadida regresión local con una operación pendiente.
- Añadida prueba local que confirma que el descubrimiento de modelos respeta `Retry-After` y no duplica solicitudes cuando el proveedor pide esperar.
- Mejorada la navegación por teclado de Configuración: el diálogo enfoca el título al abrir y Escape cierra mediante el evento nativo; añadidas pruebas de apertura y cancelación.
- Añadida regresión de cambio entre perfiles que comprueba que la clave en memoria del proveedor anterior no se envía al probar ni guardar el nuevo perfil.
- Añadida prueba de arranque en frío simulado: tema y modo se recuperan del almacenamiento local, y el perfil activo vuelve a cargarse sin rellenar la clave en el formulario.
- Endurecida la autorización del agente para exigir revisión ante alias peligrosos conocidos de PowerShell, ejecución de scripts y lanzadores de shells; Configuración explica que los perfiles personalizados no están aislados.

## 0.1.0-alpha.14

- Consulta de actualizaciones firmadas de GitHub al iniciar y cada seis horas; preferencia de instalación manual o automática, indicador visible, descarga separada de instalación y versión instalada en Configuración.
- Los paquetes NSIS de Windows se verifican con una clave pública integrada antes de instalar. El primer paquete con updater debe instalarse manualmente sobre versiones anteriores a alpha.14.
- Publicación automatizada de releases alpha y manifiesto de actualización firmado para Windows x64.
- Añadidas pruebas de actualización manual, preferencia inicial y progreso de descarga.
- Configuración opcional para conservar 5, 10, 20, 50 o 100 copias recientes por archivo y limpiar las antiguas después de guardar/restaurar; por defecto no se elimina historial.
- La lista de copias se ordena por fecha de creación en vez de por el nombre aleatorio de la carpeta.
- Aplicada CSP local estricta en WebView y retirado el permiso de apertura externa no utilizado.
- Limitadas las respuestas no streaming de proveedores a 2 MB, la exploración de proyectos a 1.000 entradas y 200 archivos, la concurrencia a ocho solicitudes, las escrituras/contexto del terminal a 1 MB y los datos IPC de chat/proveedor.
- Añadidos regresiones para respuestas sobredimensionadas, identificadores/concurrencia y límites del escaneo del proyecto.
- Documentada la primera auditoría, incluidas dependencias con avisos de mantenimiento y riesgos residuales del agente.
- Validar la instalación limpia, actualización y desinstalación de Windows en entornos de usuario.
- Revisar la validación del agente con perfiles y alias personalizados de PowerShell, CMD, WSL y Git Bash.

## 0.1.0-alpha.13

- Las claves de API se guardan y recuperan mediante Windows Credential Manager; se verifica su persistencia antes de confirmar el guardado.
- Los errores al leer credenciales ya no se silencian ni provocan peticiones sin autenticación por accidente.
- Los instaladores MSI y NSIS se generan en español.

## 0.1.0-alpha.12

- El agente aplica una primera validación de operadores según PowerShell, CMD, WSL o Git Bash antes de los modos automático y reglas.
- Se reconocen alias habituales de borrado y escritura para exigir aprobación manual.
- Se generan instaladores MSI y NSIS de Windows x64 y se publican sus sumas SHA-256.

## 0.1.0-alpha.11 y anteriores

- Se pueden listar y restaurar copias anteriores de archivos modificados por el agente; cada restauración respalda el estado actual.
- Añadida limpieza manual confirmada de copias de seguridad por archivo.
- Los cambios del agente se preparan y preservan mediante archivos temporales y copias versionadas; se rechazan rutas de dispositivos y enlaces simbólicos.

## 0.1.0-alpha.7

- Al salir de la aplicación se cierran las sesiones activas aunque haya una escritura en curso. El contexto de salida larga y los bloques comparten un recorte que respeta caracteres Unicode.
- La terminal registra los eventos antes de iniciar el shell, conserva la sesión al ocultar una pestaña y ofrece reiniciar una sesión terminada. Al cerrar una pestaña se libera su contexto.
- La consulta de modelos repite una vez los fallos temporales de conexión o pasarela.
- El chat conserva los caracteres divididos entre paquetes, procesa eventos de varias líneas y avisa si la respuesta está incompleta, vacía, mal formada o supera el límite.

## 0.1.0-alpha.6

- Corregidas las marcas de bloque en Windows PowerShell 5 y Bash, incluida la primera orden de una sesión de PowerShell.
- Cada perfil conserva su URL y sus credenciales. Las reglas del agente autorizan solo líneas completas y el modo automático admite tres consultas de Git.

## 0.1.0-alpha.5

- Centro de configuración local y guías de instalación, preferencias y mantenimiento.

## Alpha.4 y versiones anteriores

- Bloques navegables con comando, salida y código de salida por marcas OSC 133; integración inicial de PowerShell, CMD y Bash/WSL.
- Cancelación del plan del agente, Ctrl+C para el comando activo y corte de acciones automáticas después de un error.
- Vista previa del contenido exacto y recortado de terminal, proyecto y archivos elegidos.
- Respuestas incrementales del chat con cancelación e historial local borrable, limitado a 100 mensajes.
- División de terminal horizontal además de la vertical.
- Bloqueo adicional de operadores de composición y sustitución en comandos del agente.
- Icono propio y workflow de build de Windows para GitHub Actions.
- Hoja de ruta y requisitos actualizados para separar implementación y validación manual.

## 0.1.0 — Prototipo inicial

- Terminal Tauri con PowerShell, CMD, WSL y Git Bash, pestañas y división vertical.
- Configuración de proveedores, descubrimiento de modelos y chat contextual inicial.
- Planificación del agente, políticas iniciales de comandos y cambios de archivo con aprobación.
- Selector de doce paletas, modos claro/oscuro y preferencias locales.
- Sistema visual documentado y accesible desde el panel Apariencia.
- Escritura temporal y reemplazo de archivos aprobados con copia de seguridad por versión.
- Rechazo de nombres de dispositivos y destinos con puntos de reanálisis.
- Paquetes Windows x64 MSI y NSIS; la instalación limpia sigue pendiente de validación.

La versión `0.1.0` es un prototipo de desarrollo, no una release estable.
