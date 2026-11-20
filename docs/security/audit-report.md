# Auditoría de seguridad

- Fecha: 2026-11-20
- Alcance: código fuente de Laural, configuración de Tauri, dependencias declaradas y controles de tamaño alrededor de proveedor, proyecto y terminal.
- Objetivo de distribución: aplicación de escritorio Windows.
- Tipo: revisión estática y pruebas automatizadas; no es una certificación ni una prueba de penetración externa.

## Hallazgos corregidos

| Severidad | Hallazgo | Corrección |
| --- | --- | --- |
| Alta | WebView sin CSP (`csp: null`), aumentando el impacto de contenido/script inyectado | CSP local: scripts propios; IPC de Tauri como única conexión; objetos, frames y formularios externos bloqueados; sin `unsafe-eval`. Se conserva `unsafe-inline` solo para estilos requeridos. |
| Media | Respuestas HTTP no streaming se leían sin límite y podían consumir memoria | Lectura incremental con límite de 2 MB para respuestas de proveedor. Las respuestas streaming mantienen límites propios. |
| Media | El descubrimiento de contexto de proyecto podía enumerar un árbol enorme antes de limitar los resultados | Recorrido acotado a 1.000 entradas y 200 archivos; contexto de contenido con límites de tamaño. |
| Baja | Plugin y permiso de apertura externa no usados estaban habilitados | Eliminados dependencia, inicialización y permiso de opener. |
| Media | Solicitudes de IA podían reutilizar identificadores o crecer sin límite | Rechazo de IDs inválidos/duplicados y máximo de ocho consultas simultáneas. |
| Media | Datos IPC de chat, contexto y escritura carecían de límites uniformes | Límite de 1 MB por escritura de terminal/contexto, 100 mensajes con 64 KB cada uno, 12 archivos elegidos, URL de 2.048 caracteres, clave de 16 KB, y límites del agente aplicados en backend. |

## Dependencias

- `npm audit --audit-level=moderate`: 0 vulnerabilidades conocidas en dependencias npm al auditar.
- `cargo audit` sobre `Cargo.lock` reportó tres avisos: `chrono` (sin mantenimiento), `proc-macro-error` (sin mantenimiento) y `glib 0.18.5` con una advertencia de soundness RUSTSEC-2024-0429 (solución `>=0.20.0`). `cargo tree -i <crate> --target x86_64-pc-windows-msvc` no encuentra ninguno en el árbol de Windows; son dependencias para otros targets de Tauri. Son avisos del lockfile multi-plataforma, no componentes del artefacto Windows auditado. Repetir auditoría al habilitar distribución para esos otros targets.

## Riesgos pendientes / límites

- La terminal ejecuta procesos con los permisos completos de la cuenta Windows. El modo automático del agente usa filtros heurísticos y no es un sandbox; alias, funciones y perfiles de shell personalizados pueden alterar su significado.
- Los comandos Tauri de la ventana son una frontera de confianza. CSP reduce la exposición a inyección web, pero una vulnerabilidad local del WebView o del frontend puede alcanzar capacidades concedidas.
- La conexión HTTPS a un endpoint configurado por el usuario puede enviarle prompts, contexto de terminal y archivos elegidos. Revisar el destino y el contexto antes de enviar.
- No se probó malware local, una cadena de suministro comprometida, firma/actualización, escape del sandbox del WebView ni seguridad del sistema operativo. El instalador aún requiere validación limpia y firma.

## Verificación

Se ejecutaron `cargo fmt --check`, `git diff --check`, `npm audit`, pruebas frontend con cobertura, cobertura Rust y build NSIS de Windows. La prueba estática no sustituye la validación manual del instalador.

- Interfaz: 19 pruebas pasadas; cobertura global 16,19 % de líneas. `App.tsx` no tiene cobertura y es el principal hueco.
- Backend Rust: 25 pruebas pasadas, 0 fallidas, 1 ignorada; cobertura 46,29 % de líneas (47,88 % de regiones). `lib.rs` y `providers.rs` requieren más cobertura.
- `npm audit`: 0 vulnerabilidades; `cargo check`, build frontend, `cargo fmt --check` y `git diff --check` pasan.
- Build NSIS: completado; generó `Laural_0.1.0_x64-setup.exe` (2,70 MiB). Instalación limpia y comportamiento visual de CSP aún requieren ejecución manual.
