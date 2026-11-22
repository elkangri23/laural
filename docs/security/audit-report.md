# Auditoría de seguridad

- Fecha: 2026-11-21
- Alcance: código fuente de Laural, configuración de Tauri, dependencias declaradas, controles de tamaño, canal de actualización y verificación de firma.
- Objetivo de distribución: aplicación de escritorio Windows.
- Tipo: revisión estática y pruebas automatizadas; no es una certificación ni una prueba de penetración externa.

## Hallazgos corregidos

| Severidad | Hallazgo | Corrección |
| --- | --- | --- |
| Alta | WebView sin CSP (`csp: null`), aumentando el impacto de contenido/script inyectado | CSP local: scripts propios; IPC de Tauri como única conexión; objetos, frames y formularios externos bloqueados; sin `unsafe-eval`. Se conserva `unsafe-inline` solo para estilos requeridos. |
| Media | Respuestas HTTP no streaming se leían sin límite y podían consumir memoria | Lectura incremental con límite de 2 MB para respuestas de proveedor. Las respuestas streaming mantienen límites propios. |
| Media | El descubrimiento de contexto de proyecto podía enumerar un árbol enorme antes de limitar los resultados | Recorrido acotado a 1.000 entradas y 200 archivos; contexto de contenido con límites de tamaño. |
| Baja | El login necesita abrir el navegador externo sin conceder esa capacidad al WebView | Opener se invoca solo desde Rust y recibe una URL HTTPS construida con un origen fijo; JavaScript no recibe permiso genérico de apertura. |
| Media | Solicitudes de IA podían reutilizar identificadores o crecer sin límite | Rechazo de IDs inválidos/duplicados y máximo de ocho consultas simultáneas. |
| Media | Datos IPC de chat, contexto y escritura carecían de límites uniformes | Límite de 1 MB por escritura de terminal/contexto, 100 mensajes con 64 KB cada uno, 12 archivos elegidos, URL de 2.048 caracteres, clave de 16 KB, y límites del agente aplicados en backend. |
| Media | Un proveedor podía responder con una redirección a otro destino | El cliente no sigue redirecciones; una regresión local confirma que una solicitud con autenticación no llega al destino indicado por un 302. |
| Media | El filtro del agente omitía operaciones de archivos y cambios del sistema habituales | Comandos frecuentes de borrado, copia, movimiento, truncado, escritura, permisos, atributos y enlaces requieren revisión. También se detectan alias conocidos de PowerShell, lanzadores de scripts y ejecutables por ruta explícita. La detección sigue siendo heurística y no evalúa perfiles personalizados. |
| Media | La restauración y limpieza de copias podían sufrir sustitución de directorios entre validación y acceso | En Windows se fijan los directorios intermedios; la restauración abre el archivo como objeto ordinario sin permitir escritura o borrado concurrente. Regresiones rechazan enlaces y verifican el bloqueo durante lectura y que limpiar no afecta archivos externos. |
| Media | El destino de una edición podía cambiar entre validación y reemplazo | En Windows se abre el archivo ordinario con acceso `DELETE`, sin compartir borrado; se fijan la cadena canónica de directorios y se hacen renombrados por handle sin sobrescritura. Una colisión concurrente no reemplaza el destino y conserva el original en backup. |
| Media | El plan del agente podía aceptar rutas que la operación posterior rechazaría, incluidos nombres reservados de Windows o rutas con espacios externos | La vista previa del plan, la escritura, la restauración y las copias usan el mismo validador. Los espacios al inicio o final se rechazan sin normalizarlos. |
| Baja | No había un modo local de revisar el resultado reciente de acciones del agente | Configuración muestra un historial limitado a 200 eventos/64 KiB que contiene únicamente tipo, resultado y hora, y permite borrarlo. Los fallos de registro no detienen las acciones. |
| Alta | Las releases anteriores no tenían un instalador desde la app ni autenticación criptográfica de los paquetes de actualización | Integrado updater Tauri, HTTPS, clave pública fija, artefactos NSIS firmados y secreto privado en GitHub Actions. Falta validar el salto real entre versiones publicadas. |
| Alta | Las rutas de autenticación y snapshots no tenían límites persistentes por IP/ruta | Añadido control atómico en PostgreSQL con huella HMAC de IP, respuesta `429`/`Retry-After` y proxy confiable limitado a loopback. CI aplica las migraciones y prueba concurrencia con PostgreSQL real; falta verificar IP y carga detrás de Caddy en el VPS. |

## Dependencias

- `npm audit --audit-level=high`: 0 vulnerabilidades conocidas en dependencias npm al auditar.
- `npm audit --omit=dev`: 0 vulnerabilidades conocidas en dependencias de producción del servicio.
- `cargo audit` sobre el lockfile actual termina con seis avisos, sin vulnerabilidades explotables reportadas: `chrono`, `proc-macro-error`, `zbus_names` y `zvariant`/`zvariant_derive` figuran como sin mantenimiento; `glib 0.18.5` reporta RUSTSEC-2024-0429 (soundness; parche desde `>=0.20.0`). `zbus*` entra por el soporte Linux del plugin opener; `cargo tree --target x86_64-pc-windows-msvc -i <crate>` no encuentra los seis crates en el árbol Windows. Mantener la advertencia para futuros targets Linux y revisar al actualizar Tauri.

## Riesgos pendientes / límites

- La terminal ejecuta procesos con los permisos completos de la cuenta Windows. El modo automático del agente usa filtros heurísticos y no es un sandbox; alias, funciones y perfiles de shell personalizados pueden alterar su significado.
- Los comandos Tauri de la ventana son una frontera de confianza. CSP reduce la exposición a inyección web, pero una vulnerabilidad local del WebView o del frontend puede alcanzar capacidades concedidas.
- La conexión HTTPS a un endpoint configurado por el usuario puede enviarle prompts, contexto de terminal y archivos elegidos. Revisar el destino y el contexto antes de enviar.
- El historial local del agente sirve para consulta, no es inviolable: una aplicación ejecutada con la misma cuenta puede alterarlo o borrarlo.
- El almacenamiento actual de claves usa Windows Credential Manager mediante `keyring` y no guarda claves en `providers.json`. Credential Manager protege secretos en reposo a través del sistema; no impide que malware bajo la cuenta activa o un proceso Laural comprometido recupere una clave cuando se usa. La exportación/importación cifrada sigue pendiente.
- El token de cuenta se guarda solo en Credential Manager. Al quitar la cuenta, Laural intenta revocar la sesión actual por HTTPS y borra siempre la credencial local. Si el servidor no responde, la sesión remota puede seguir válida hasta 30 días y la UI lo comunica. La revocación no incluye otros dispositivos ni sustituye la administración/cierre completo de cuenta.
- El login nativo tiene límites por flow/código y ahora también límites persistentes por IP/ruta en PostgreSQL compartidos entre instancias. Falta validarlos tras el proxy y bajo carga; el backend permanece desactivado por defecto y sin despliegue público.
- La paleta mantiene hasta 100 comandos en memoria y puede copiarlos al portapapeles tras una acción explícita. Los comandos pueden incluir datos sensibles; el historial se pierde al cerrar Laural, pero el portapapeles permanece sujeto al sistema operativo.
- La sustitución de un archivo existente consta de dos renombrados para conservar un backup y rechazar destinos concurrentes. Si Laural se interrumpe entre ambos, el archivo puede faltar hasta restaurar su versión desde `.laural-backups`.
- No se probó malware local, una cadena de suministro comprometida, instalación limpia, escape del sandbox del WebView ni seguridad del sistema operativo. La firma del updater no equivale a Authenticode ni protege frente a una cuenta/repositorio o clave privada comprometidos.

## Verificación

La auditoría inicial ejecutó `git diff --check`, auditoría npm/Rust, pruebas frontend con cobertura, tests Rust, compilación Tauri y build frontend. No se probó el login contra un servicio habilitado ni contra PostgreSQL/Resend reales. La revisión estática no sustituye una prueba de penetración ni la validación manual del instalador/actualizador.

Actualización del 21-11-2026: desde `server/`, `npm run test:coverage` pasa localmente con 80 pruebas; 94,36 % de líneas y 91,71 % de ramas. Sin `TEST_DATABASE_URL`, Vitest omite cuatro pruebas de integración PostgreSQL. `npm run build` pasa. `cargo test` pasa con 83 pruebas y una ignorada. CI aplica las migraciones y ejercita limitador, snapshots, flujo de cuenta, revocación y limpieza contra PostgreSQL temporal. Falta validar IP y carga detrás de Caddy en el VPS.

- Interfaz (21-11-2026): 49 pruebas pasadas; cobertura global 66,96 % de líneas, 52,70 % de ramas, 60,87 % de sentencias y 55,68 % de funciones. El panel nuevo de cuenta tiene 100 % de líneas y 76,19 % de ramas.
- Backend Rust (21-11-2026): 66 pruebas pasadas, 0 fallidas, 1 ignorada. `cargo llvm-cov` ejecuta la suite, pero MSVC no deja datos de cobertura y no genera informe (`no coverage data found`); no se declara porcentaje Rust para esta ejecución.
- Servicio sync (21-11-2026): 80 pruebas locales, 94,36 % líneas y 91,71 % ramas. Migraciones, rate limit, rutas de snapshots, autenticación/sync, revocación y política de retención pasan con PostgreSQL real en CI; Resend y despliegue siguen pendientes.
- `npm audit --omit=dev`: 0 vulnerabilidades; `cargo check`, build frontend y formato Rust pasan. El build advierte que el chunk JavaScript principal supera 500 kB. La generación NSIS firmada se verificó el 20-11-2026; esta entrega no reconstruyó el instalador.

Actualización del 21-11-2026: la gestión de sesiones permite revocación individual y conjunta. El update SQL confirma que el token actual sigue activo en la misma operación y nunca revoca ese token; el listado no incluye IP, ubicación ni credenciales. La suite de interfaz pasa 110 pruebas (74,36 % líneas), el servicio 84 (94,74 % líneas; 92,05 % ramas) y Rust 84 (una ignorada). `npm run build` de app y servicio, `cargo fmt --check` y `cargo test` pasan. Las cuatro pruebas PostgreSQL requieren la DB de CI; validar el despliegue con Caddy/VPS sigue pendiente.

Actualización del 21-11-2026: se implementó restablecimiento de contraseña con PIN de correo: HMAC separado por propósito, cinco intentos, expiración de cinco minutos, respuesta genérica, hash Argon2id y revocación de sesiones en la misma transacción. El cambio no crea sesión ni elimina MFA. Se añadieron y probaron primitivas TOTP aisladas; aún no aplican MFA al login. Servicio: 99/99 pruebas pasan con PostgreSQL local; cobertura 94,70 % de líneas y 89,80 % de ramas. App: 110/110 y 74,36 % de líneas. Build del servicio correcto. No se habilita producción: MFA sigue incompleta y falta validar Resend/proxy en el VPS; como el buzón permite cambiar la contraseña, cuentas públicas requieren MFA.

Actualización del 22-11-2026: el clasificador de riesgo identifica alias/ejecutables por shell, cubre alias conocidos PowerShell/CMD, operaciones Unix, subcomandos Git con opciones globales y gestores de paquetes. También requiere revisión para `eval`/carga de scripts, traps, cambios simples y compuestos de entorno, mutaciones de variables de sesión PowerShell y cambios de builtins Bash/WSL mediante `declare`, `typeset`, `readonly`, `local` y `enable`; los listados de consulta explícitos siguen permitidos. También cubre wrappers de ejecución, `find -delete/-exec` y configuración Git inline. Siguen fuera aliases/funciones personalizados y procesos no aislados; comandos aprobados conservan permisos completos de la cuenta Windows.

Regresión local de autorización tras ampliar los builtins: 109 pruebas Rust pasan y 1 queda ignorada; interfaz 124/124 con 74,80 % de líneas. El comando de cobertura Rust vuelve a ejecutar los tests pero `llvm-cov` no encuentra datos con Windows/MSVC; se conserva como referencia la última cobertura obtenida en CI hasta completar el workflow de este commit.

Ampliación del filtro de PowerShell: detecta también operadores `++`/`--` en prefijo (`++$contador`, `--$global:contador`) y sufijo con espacios (`$contador ++`, `$global:contador --`). La suite Rust pasa: 109 pruebas y 1 ignorada; UI 124/124 con 74,80 % de líneas. El informe de cobertura local está limitado por Windows/MSVC; el último informe CI disponible (commit 7f6d817) marca 64,13 % de líneas Rust total y 67,08 % para `providers.rs`.

Ampliación de PowerShell: se añaden destinos variables entre paréntesis (`($contador)++`, `++($contador)`, `($env:PATH) += ...`) y una regresión de lectura segura para `($env:PATH)`.

También se detectan operadores de prefijo separados por espacios (`++ $contador`, `-- ($contador)`). PowerShell local confirmó que estas formas mutan el valor; las regresiones Rust pasan con 109 pruebas y 1 ignorada.

Actualización del 22-11-2026: se extrajo la decisión de autorización a una función pura para probar el flujo completo sin acceder a archivos del usuario. Regresiones verifican que las operaciones de riesgo requieren revisión incluso si aparecen en reglas, el modo automático permite solo las consultas Git exactas y las reglas usan igualdad completa y rechazan operadores. Localmente pasan 91 pruebas Rust, 115 de UI y 121 de servicio; este Windows/MSVC no genera perfiles de cobertura Rust, que se producen en CI.

Actualización del 22-11-2026: PowerShell también exige revisión para `Set-Variable`/`sv`/`set`, `New-Variable`/`nv`, `Clear-Variable`/`clv` y `Remove-Variable`/`rv`; `Get-Variable`/`gv` se conserva como consulta segura. Las regresiones incluyen la precedencia sobre reglas de permiso. La suite local pasa con 110 pruebas Rust y 1 ignorada; UI 124/124, con 74,80 % de líneas. El workflow CI del commit `de05b24` terminó en verde y midió 64,33 % de líneas Rust total y 67,49 % en `providers.rs`; Windows/MSVC no genera el informe de cobertura local. Los perfiles personalizados y funciones de PowerShell siguen fuera de la clasificación.
