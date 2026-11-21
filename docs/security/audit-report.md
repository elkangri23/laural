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
- El token de cuenta se guarda solo en Credential Manager. La acción actual de quitar la cuenta elimina el token local, pero no lo revoca en el servidor; una sesión remota puede seguir válida hasta 30 días. No presentar esto como cierre de sesión remoto y añadir revocación antes de habilitar cuentas.
- El login nativo tiene límites por flow/código, pero aún no límites persistentes por IP ni mitigación distribuida. El backend permanece desactivado por defecto y sin despliegue público.
- La paleta mantiene hasta 100 comandos en memoria y puede copiarlos al portapapeles tras una acción explícita. Los comandos pueden incluir datos sensibles; el historial se pierde al cerrar Laural, pero el portapapeles permanece sujeto al sistema operativo.
- La sustitución de un archivo existente consta de dos renombrados para conservar un backup y rechazar destinos concurrentes. Si Laural se interrumpe entre ambos, el archivo puede faltar hasta restaurar su versión desde `.laural-backups`.
- No se probó malware local, una cadena de suministro comprometida, instalación limpia, escape del sandbox del WebView ni seguridad del sistema operativo. La firma del updater no equivale a Authenticode ni protege frente a una cuenta/repositorio o clave privada comprometidos.

## Verificación

La revisión de esta entrega ejecutó `git diff --check`, auditoría npm/Rust, pruebas frontend con cobertura, tests Rust, compilación Tauri y build frontend. No se probó el login contra un servicio habilitado ni contra PostgreSQL/Resend reales. La revisión estática no sustituye una prueba de penetración ni la validación manual del instalador/actualizador.

- Interfaz (21-11-2026): 49 pruebas pasadas; cobertura global 66,96 % de líneas, 52,70 % de ramas, 60,87 % de sentencias y 55,68 % de funciones. El panel nuevo de cuenta tiene 100 % de líneas y 76,19 % de ramas.
- Backend Rust (21-11-2026): 66 pruebas pasadas, 0 fallidas, 1 ignorada. `cargo llvm-cov` ejecuta la suite, pero MSVC no deja datos de cobertura y no genera informe (`no coverage data found`); no se declara porcentaje Rust para esta ejecución.
- Servicio sync: 62 pruebas, 96,45 % líneas y 91,75 % ramas con PostgreSQL/Resend simulados.
- `npm audit --omit=dev`: 0 vulnerabilidades; `cargo check`, build frontend y formato Rust pasan. El build advierte que el chunk JavaScript principal supera 500 kB. La generación NSIS firmada se verificó el 20-11-2026; esta entrega no reconstruyó el instalador.
