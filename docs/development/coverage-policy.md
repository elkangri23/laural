# Política de cobertura de pruebas 100/80/0

## Objetivo

Aplicar la cobertura según el riesgo y la responsabilidad del código. El porcentaje sirve para localizar rutas sin ejercitar; los tests deben comprobar resultados, límites, errores y efectos observables.

## Niveles

| Nivel | Alcance | Criterio |
| --- | --- | --- |
| Crítico · 100 % | Autenticación, autorización, MFA, secretos, criptografía, privacidad, sincronización íntegra, operaciones de archivos, ejecución de comandos y seguridad del actualizador. | 100 % de líneas y ramas medibles. Cubrir límites, errores, estados inválidos y efectos de seguridad. |
| Estándar · 80 % | Controladores, servicios de aplicación, transformaciones y componentes de interfaz con comportamiento. | Al menos 80 % de líneas; probar los flujos principales y errores habituales. Medir ramas y cubrir decisiones relevantes sin fabricar casos para alcanzar el número. |
| Trivial · 0 % | Configuración declarativa, tipos/DTO sin lógica, vistas estáticas y código generado. | No crear tests propios y excluirlo del denominador de los gates. |

La clasificación se hace por archivo y por responsabilidad real, no por extensión. Un archivo con lógica crítica no pasa a trivial por estar generado por una plantilla ni por contener principalmente tipos. Si un archivo mezcla niveles, se propone separarlo antes de reducir el rigor.

## Regla de trabajo

Antes de añadir o revisar tests, comunicar el archivo y su nivel. Para Crítico, describir las líneas, ramas y casos de seguridad que se van a cerrar; para Estándar, indicar el flujo o error que cubre; para Trivial, no añadir tests. Mantener esta clasificación en la revisión y avisar si el cambio revela una responsabilidad distinta.

## Clasificación inicial de seguridad

Estos módulos son Críticos por las responsabilidades que implementan:

- Rust: `account.rs`, `activity_log.rs`, `agent_files.rs`, `chat_stream.rs`, `configuration_transfer.rs`, `git_panel.rs`, `preferences/snapshot.rs`, `providers.rs`, `sync.rs`, `terminal_flow.rs` y `terminal_output.rs`.
- Servicio: autenticación, cuentas, MFA/TOTP, passkeys, OAuth, recuperación, criptografía de tickets, limitación de solicitudes, purga de retención, almacenamiento de sesiones/snapshots y outbox de avisos de seguridad.
- Interfaz: flujos de cuenta/factores, transferencia que puede incluir claves, aprobación/ejecución del agente, terminal y actualización firmada.

Para esta política, `scripts/check-critical-rust-coverage.mjs` y `server/scripts/critical-coverage.mjs` con sus tests son Críticos porque deciden si el gate acepta un informe; `.github/workflows/cobertura.yml` y el lanzador `server/scripts/check-critical-coverage.mjs` son Triviales/configuración de ejecución sin lógica de cobertura propia.

`SettingsDialog.tsx` y las vistas de estado/ayuda con interacción ordinaria son Estándar. Catálogos de traducciones, iconos estáticos, configuración YAML/TOML, DTO puros, JSON Schema, fixtures declarativas y artefactos generados son Triviales; los validadores y las rutas que los consumen conservan su clasificación por riesgo. Cada archivo nuevo o modificado para tests recibe clasificación explícita antes de escribirlos.

Clasificación aplicada a M13: `App.tsx` es Estándar (80 % de líneas); `AccountSettings.tsx`, `accountActionGuards.ts`, `ConfigurationTransfer.tsx`, `UpdateManager.tsx`, `AgentSettings.tsx`, `TerminalPane.tsx`, `terminalPaneState.ts` y `src-tauri/src/terminal_prediction.rs` son Críticos (objetivo 100 % de líneas y ramas); `AgentSettings.tsx` expone políticas de ejecución y aprobación, `TerminalPane.tsx` crea sesiones de shell y los módulos de estado/guardas aíslan decisiones sensibles. `ModalShell.tsx` y `SettingsDialog.tsx` son Estándar.

`ModalShell.tsx` ahora requiere un título explícito para impedir que una ventana nueva reutilice el fallback español; sus dos pruebas focalizadas cubren apertura, accesibilidad y cierre. `SettingsDialog`, Cuenta, Transferencia y Actualizaciones ya suministran título desde su catálogo.

`TaskRecipes.tsx` es Estándar: muestra recetas y crea el texto que se envía al modelo, sin ejecutar comandos ni modificar archivos. Sus 23 pruebas pasan con 99 % de cobertura de líneas; incluyen localización de plantillas y prompt, y preservación literal de recetas editadas.

La traducción del mensaje sintético de comando editado se añadió a `TerminalPane.tsx`, Crítico. Sus 36 pruebas pasan y el módulo mantiene 100 % de líneas y ramas; los casos de histórico comprueban ambos idiomas sin modificar la captura de entrada ni la salida del shell.

`SettingsDialog.tsx` completa la navegación por flechas (arriba, abajo, izquierda y derecha), Inicio y Fin con 5/5 pruebas y 100 % de líneas, ramas y funciones. En el primer informe posterior a esa ampliación, la suite completa pasó 272/272; cobertura global 92,09 % de líneas.

`AgentSettings.tsx` (Crítico) consume ahora el catálogo tipado para permisos, editor de reglas y avisos de ejecución/PSReadLine. Las pruebas verifican ambos idiomas y los callbacks de política existentes; 4/4 pasan y el archivo conserva 100 % de líneas y ramas. La suite completa pasa 274/274; cobertura global 92,09 % de líneas.

`App.tsx` (Estándar) consume claves para el encabezado de la categoría Agente y el estado accesible de carga de la terminal. Las 46 pruebas del componente pasan; conserva 81,71 % de líneas, por encima del 80 % requerido. El test de carga demora deliberadamente la importación lazy para comprobar el texto inglés mientras la terminal todavía no se ha montado.

La prueba de contexto Git añade también el flujo inglés del chip “Selected Git diff”. `App.tsx` pasa 47 pruebas focalizadas y mantiene 81,71 % de líneas; la lógica de selección explícita y el contenido del diff no cambian.

Validación manual separada de cobertura: en PowerShell 7.6.9 dentro de ConPTY, el bloque fijo de `terminal_prediction.rs` estableció History/InlineView; el mismo comando no puede activar sugerencias con salida redirigida porque el host no ofrece VT. Esta comprobación de runtime no sustituye el gate Crítico 100/100, que debe confirmarse en CI Linux.

## Estado de la aplicación de los gates

La política ya guía la clasificación y el diseño de pruebas. El gate exacto del servicio comprueba 18 módulos Críticos: `config.ts`, `auth.ts`, `email-auth.ts`, `account-deletion.ts`, `account-mfa.ts`, `account-passkeys.ts`, `account-recovery.ts`, `google-oauth.ts`, `app.ts`, `native-auth.ts`, `recovery-ticket-crypto.ts`, `retention.ts`, `security-email-outbox.ts`, `resend-mailer.ts`, `migration-runner.ts`, `snapshot-validation.ts`, `auth-pages.ts` y `scripts/critical-coverage.mjs`. `app.ts`, `native-auth.ts` y `recovery-ticket-crypto.ts` alcanzan 100 % de líneas y ramas; `retention.ts` alcanza 100 % de líneas y no tiene ramas ejecutables. El lanzador `server/scripts/check-critical-coverage.mjs` se ejecuta después de la suite de cobertura del servicio. No afirmar cumplimiento global hasta que todos los archivos estén clasificados y los gates por categoría estén completos.

Medición local del 24-11-2026: servicio sync, 281 pruebas pasadas y 11 omitidas; 93,43 % de líneas y 94,27 % de ramas globales. Los 18 módulos del gate Crítico alcanzan 100 % de líneas y ramas, salvo `retention.ts`, que no tiene ramas ejecutables. `app.ts` alcanza 100 % de líneas, ramas y funciones (475/475, 348/348, 87/87); `native-auth.ts` y `recovery-ticket-crypto.ts` también llegan a 100 % de líneas, ramas y funciones; cubren login/MFA/passkeys/OAuth/PKCE y cifrado autenticado de tickets, respectivamente. `account-mfa.ts`, `account-passkeys.ts`, `account-recovery.ts` y `google-oauth.ts` también alcanzan 100/100 con pruebas de éxito, rechazo, expiración y fallos transaccionales. La cobertura global supera el 80 % de líneas Estándar, pero el servicio aún no tiene gates exhaustivos por categoría ni cobertura Crítica completa fuera del conjunto ya protegido.

Último informe CI disponible de interfaz/Rust: run `45484498240`, commit `875b452`, 24-11-2026; UI 79,78 % de líneas; Rust 69,72 % de líneas / 62,37 % de ramas globales. Módulos Rust Críticos (líneas/ramas): `account.rs` 31,80/33,72 %, `agent_files.rs` 88,62/66,95 %, `chat_stream.rs` 96,18/87,50 %, `configuration_transfer.rs` 94,10/94,29 %, `git_panel.rs` 88,24/67,31 %, `preferences/snapshot.rs` 97,67/73,68 %, `providers.rs` 78,22/63,25 %, `sync.rs` 38,36/32,35 %, `terminal_flow.rs` 94,94/100 % y `terminal_output.rs` 100/0 % (sin ramas instrumentadas). Las pruebas de `providers.rs` ampliadas localmente todavía no están incluidas en ese informe.

En la revisión local del 24-11-2026 se amplían pruebas Críticas de `account.rs` para respuestas JSON, límites de bytes, callback local, rechazos previos a leer credenciales, HTTPS-only y tokens PKCE. El módulo pasa 15 pruebas; la suite Rust pasa 187 y omite 2; `cargo fmt --check` pasa. `cargo llvm-cov` en Windows/MSVC ejecuta las pruebas, pero no exporta datos (`no coverage data found`); mantener la cifra CI anterior hasta obtener un artefacto actualizado de Linux.

Actualización: `account.rs` prueba la respuesta de error 400 del callback local y sus encabezados defensivos. También cubre `code`/`state` ausentes o inválidos, fragmentos y bytes UTF-8 malformados. El módulo pasa 16 pruebas y la suite Rust pasa 207 con 2 ignoradas; `cargo fmt --check` pasa. La cifra Crítica requiere CI Linux; MSVC sigue sin producir perfil.

Actualización de `sync.rs`: las regresiones Críticas verifican que un endpoint local prevalece, que no se inventa uno ausente en la nube y que la falta de snapshot remoto conserva el estado local. El módulo pasa 16 pruebas y Rust pasa 208 con 2 ignoradas; `cargo fmt --check` pasa. Medir líneas y ramas en CI Linux antes de evaluar el gate 100/100.

Actualización de `agent_files.rs`: una regresión Crítica comprueba el límite de tamaño del listado de copias en ambos lados: 100 KB se acepta y 100 KB + 1 byte se omite. La suite focalizada y Rust (209 pasadas, 2 ignoradas) pasan; `cargo fmt --check` pasa. Confirmar el cambio de cobertura en CI Linux.

Actualización de `configuration_transfer.rs`: la validación de contraseñas se prueba con caracteres multibyte en el mínimo y con el máximo de 1 KiB medido en bytes. El módulo pasa 16 pruebas; Rust pasa 210 y omite 2; `cargo fmt --check` pasa. La cobertura 100/100 debe confirmarse en CI Linux.

Actualización de `git_panel.rs`: el parser de estado rechaza registros de renombrado/copia incompletos en que falta la segunda ruta o llega vacía. El test focalizado y la suite Rust (211 pasadas, 2 ignoradas) pasan; `cargo fmt --check` pasa. Medir la cobertura Crítica actual en CI Linux.

Actualización de `chat_stream.rs`: se cubre el formato SSE válido `data:{JSON}` sin espacio separador opcional. El módulo pasa 9 pruebas; Rust pasa 212 y omite 2; `cargo fmt --check` pasa. Confirmar líneas y ramas en CI Linux.

El gate Rust incluye ahora `chat_stream.rs` y `preferences/snapshot.rs` con el umbral provisional M11 de 85 % de líneas y 65 % de ramas. El verificador tiene 10 regresiones que cubren umbral, módulo faltante, datos inválidos y requisitos 100/100 existentes; pasan todas. Estos umbrales transitorios no sustituyen el objetivo final Crítico 100/100.

Actualización de `activity_log.rs`: el lector acotado, clasificado Crítico, se prueba en el límite de 64 KiB y con un byte adicional, cubriendo la segunda verificación ante crecimiento durante la lectura. El módulo pasa 8 pruebas; Rust pasa 213 y omite 2; `cargo fmt --check` pasa. Medir ramas/líneas en CI Linux.

Para `sync.rs` se amplía la batería Crítica a la lectura/borrado del historial remoto: paginación, autorización, respuestas inválidas y límites. Incluye también lectura/escritura de snapshots, ETag, conflictos, idempotencia, estado incoherente y respuesta chunked sin `Content-Length`. El módulo pasa 15 pruebas; Rust pasa 202 y omite 2; `cargo fmt --check` pasa. Windows/MSVC no genera perfil; CI anterior marca 38,36 % de líneas / 32,35 % de ramas. Mantenerlo abierto hasta medir en Linux y cumplir el umbral Crítico acordado.

Para `chat_stream.rs` se amplían pruebas Críticas del protocolo SSE: cierre al final del archivo con CR, campos auxiliares/no-data, payload sin contenido y error del consumidor al emitir. El módulo pasa 7 pruebas; Rust pasa 190 y omite 2; `cargo fmt --check` pasa. La medición CI anterior marca 96,18 % de líneas / 87,50 % de ramas; Windows/MSVC no genera el perfil actualizado. Mantenerlo abierto hasta confirmar 100/100 en Linux.

Nueva regresión de `chat_stream.rs`: al recibir `[DONE]` como evento delimitado, se completa de inmediato y los bytes posteriores no pueden invalidar el texto emitido. El test focalizado y la suite Rust pasan; suite total: 205 pasadas y 2 ignoradas. `cargo fmt --check` pasa. La cobertura Crítica actualizada requiere CI Linux.

Para `preferences/snapshot.rs` se prueban los límites permitidos/excedidos de ID, nombre, modelo y cantidad de perfiles, además de campos inválidos, tamaño máximo exacto, proveedor activo ausente, entrada vacía y versión futura al codificar. El módulo pasa 10 pruebas; Rust pasa 206 y omite 2; `cargo fmt --check` pasa. El último CI marca 97,67 % de líneas / 73,68 % de ramas antes de estos casos; Windows/MSVC no genera cobertura local. Confirmar el 100/100 Crítico en CI Linux.

Para `configuration_transfer.rs` se cubren límites válidos de campos, 100 perfiles y claves, contraseñas en el mínimo/máximo, exportación que excede 4 MiB y lectura de archivo justo en el límite. El módulo pasa 15 pruebas; Rust pasa 194 y omite 2; `cargo fmt --check` pasa. El último CI marca 94,10 % de líneas / 94,29 % de ramas antes de estas pruebas. Windows/MSVC no genera perfil; verificar el 100/100 en CI Linux.

Para `terminal_flow.rs` se añaden pruebas Críticas de confirmación parcial exacta de créditos y recuperación directa de un mutex envenenado. El módulo pasa 6 pruebas; Rust pasa 196 y omite 2; `cargo fmt --check` pasa. El último CI marca 94,94 % de líneas / 100 % de ramas antes de estos casos. Windows/MSVC no genera perfil; confirmar el 100/100 en CI Linux.

Para `activity_log.rs` se amplían pruebas Críticas de límite exacto de retención, valores fijos de acción/resultado, lectura ausente/corrupta y rechazo de escritura mayor al límite sin reemplazar el registro anterior. El módulo pasa 7 pruebas; Rust pasa 200 y omite 2; `cargo fmt --check` pasa. Windows/MSVC no produce perfil; medir 100/100 en CI Linux.

Para `providers.rs` se añaden pruebas de límites de selección, IDs, mutex envenenado, terminal ANSI/Unicode, instrucciones del agente y migración de perfiles. Las 88 pruebas del módulo pasan y el servicio compila. El último CI disponible mide 78,22 % de líneas / 63,25 % de ramas antes de estas regresiones; Windows/MSVC no puede cuantificar el cambio. Mantener el módulo Crítico abierto hasta el siguiente artefacto Linux y seguir cerrando sus rutas de ejecución de cuenta/proveedor/agente.

Para `git_panel.rs` se amplían pruebas Críticas de diff preparado/sin preparar y validación de carpetas, archivos y rutas inexistentes. El módulo pasa 10 pruebas y la suite Rust completa pasa 178 con 2 ignoradas; `cargo fmt --check` pasa. `cargo llvm-cov` ejecuta en Windows/MSVC pero no produce el perfil (`no coverage data found`). El último CI disponible marca 87,94 % de líneas / 72,97 % de ramas antes de estas pruebas; mantener el módulo abierto hasta generar una medición actual en Linux.

Para `agent_files.rs` se añaden casos Críticos de nombres reservados de Windows, rutas no relativas, destinos no regulares, historial ausente, restauraciones inválidas o inexistentes, límite de 20 copias, restauración superior a 100 KB sin alterar el destino y exclusión de enlaces simbólicos. El módulo pasa 20 pruebas en Windows; Rust pasa 204 y omite 2; `cargo fmt --check` pasa. La regresión nueva que crea un enlace simbólico está condicionada a Unix, por lo que no corre en Windows. En Windows/MSVC `cargo llvm-cov` ejecuta los tests, pero no exporta el perfil. El último CI disponible marca 88,62 % de líneas / 66,95 % de ramas antes de estas pruebas; confirmar la cobertura actual en Linux y no declarar el módulo conforme todavía.

Para `providers.rs` se prueban más rutas del contexto entregado al modelo: ANSI/Unicode y límite de terminal, exclusión automática de `.env` y directorios generados, y omisión de archivos seleccionados binarios, directorios o superiores al límite. El módulo pasa 90 pruebas; Rust pasa 184 y omite 2; `cargo fmt --check` pasa. En Windows/MSVC `cargo llvm-cov` ejecuta, pero no genera datos. El último CI disponible (78,22 % de líneas / 63,25 % de ramas) es anterior a los cambios locales; medir en Linux y mantener abierto el objetivo Crítico.

Medición local de interfaz 24-11-2026: 268 pruebas pasan; 91,44 % de líneas globales. `App.tsx` (Estándar) está en 80,30 % de líneas; `AccountSettings.tsx`, `ConfigurationTransfer.tsx`, `UpdateManager.tsx`, `TerminalPane.tsx`, `accountActionGuards.ts` y `AssistantMarkdown.tsx` (Críticos) están en 100 % de líneas y ramas. `AssistantMarkdown.tsx` conserva pruebas de HTML no ejecutable, protocolos permitidos/rechazados, destinos inválidos e imágenes remotas bloqueadas. `AgentSettings.tsx`, `ModalShell.tsx` y `terminalPaneState.ts` también alcanzan 100/100. El guard del host DOM ausente se prueba mediante `initializeWithTerminalHost`; no se añade excepción al gate. La integración de CI aún no aplica estos umbrales a todos los archivos. Para Rust, `terminal_prediction.rs` ya tiene un gate exacto de líneas/ramas 100/100; el gate del verificador pasa 9/9. `cargo llvm-cov` en Windows/MSVC ejecuta los 158 tests (2 manuales ignoradas), pero no produce perfiles, por lo que el porcentaje del módulo debe confirmarse en CI.

Medición UI local 24-11-2026: 271/271 pruebas pasan; 92,08 % de líneas globales. `App.tsx` Estándar alcanza 81,71 % de líneas. El gate UI comprueba 11 módulos Críticos al 100 % de líneas y ramas, 14 Estándar con al menos 80 % de líneas y excluye ocho Triviales; todos los archivos TS/TSX del inventario `src` están clasificados. `chatHistory.ts` y `chatPersistence.ts` quedan como Estándar por sus límites y persistencia local. `AccountSettings.tsx` conserva 100 % de líneas/ramas/funciones (322/322, 197/197 y 80/80); `ConfigurationTransfer.tsx` y `terminalOutput.ts` también llegan a 100/100. El gate verifica `coverage/lcov.info` en CI y sus 16 pruebas pasan localmente. Para Rust, `cargo llvm-cov --lib` ejecutó 166 pruebas y omitió 2 manuales, pero Windows/MSVC no produjo perfil. Confirmar líneas y ramas Críticas de Rust en CI.

La migración pendiente es ampliar los gates por categoría al servicio y Rust, elevar módulos Estándar al 80 % de líneas y exigir 100 % de líneas/ramas a cada módulo Crítico. El inventario UI TS/TSX ya está clasificado; el gate UI cubre 11 Críticos y 14 Estándar. El gate Rust general continúa en 85 % de líneas y 65 % de ramas durante la migración. `terminal_flow.rs` y `terminal_prediction.rs` tienen requisito exacto 100/100. La cobertura local Rust debe confirmarse en CI Linux porque Windows/MSVC no genera perfiles válidos.

## Medición local Linux · 25-11-2026

La suite instrumentada corrió en Ubuntu 24.04 con Rust 1.100.0: 211/211 pruebas Linux aplicables pasan. El informe `cargo llvm-cov --lib --json --summary-only` midió 77,74 % de líneas globales. Por módulo: `account.rs` 53,66 %, `activity_log.rs` 78,87 %, `agent_files.rs` 94,26 %, `chat_stream.rs` 98,72 %, `configuration_transfer.rs` 95,91 %, `git_panel.rs` 92,01 %, `preferences/snapshot.rs` 98,91 %, `providers.rs` 81,09 %, `sync.rs` 78,11 %, y `terminal_flow.rs`, `terminal_output.rs` y `terminal_prediction.rs` 100 %. Los umbrales de línea del gate actual pasan; `providers.rs` aún no llega al 85 % provisional si se incorpora. Este informe no incluyó `--branch`: sus campos de ramas son cero por omisión y no representan una medición. Usar CI/artefacto de ramas previo hasta ejecutar la medición específica; conservar las brechas de ramas como pendientes.

Regresiones posteriores en módulos Críticos: `account.rs` acepta un callback OAuth de exactamente 8 KiB; `activity_log.rs` traduce errores de lectura a un mensaje fijo; `sync.rs` acepta ETag de `u64::MAX` y rechaza desbordamiento; `providers.rs` acepta URL de 2.048 caracteres y rechaza 2.049. La suite Windows pasa 224 pruebas y omite 2 manuales; `cargo fmt --check` pasa. La línea base Linux de 211 pruebas y la cobertura de ramas aún requieren actualización.

Intento local de ramas · 26-11-2026: se usó el nightly fijado en CI (`nightly-2026-11-21`) y Ubuntu 24.04. La compilación instrumentada se detuvo antes de ejecutar pruebas, en `aws-lc-sys`, tras más de 35 minutos. No se generó informe nuevo; conservar las cifras de ramas del último CI y repetir en el runner de CI, que dispone de caché.
