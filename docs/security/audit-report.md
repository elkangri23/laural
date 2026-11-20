# Auditoría de seguridad

- Fecha: 2026-11-20
- Alcance: código fuente de Laural, configuración de Tauri, dependencias declaradas, controles de tamaño, canal de actualización y verificación de firma.
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
| Media | Un proveedor podía responder con una redirección a otro destino | El cliente no sigue redirecciones; una regresión local confirma que una solicitud con autenticación no llega al destino indicado por un 302. |
| Media | El filtro del agente omitía operaciones habituales de copia, movimiento y truncado | Ampliada la lista de comandos que requieren confirmación en PowerShell, CMD y shells tipo Bash; incluye regresiones. La detección sigue siendo heurística y no evalúa perfiles personalizados. |
| Media | La restauración y limpieza de copias podían sufrir sustitución de directorios entre validación y acceso | En Windows se fijan los directorios intermedios; la restauración abre el archivo como objeto ordinario sin permitir escritura o borrado concurrente. Regresiones rechazan enlaces y verifican el bloqueo durante lectura y que limpiar no afecta archivos externos. |
| Media | El destino de una edición podía convertirse en un reparse point después de la validación inicial | Se vuelve a verificar que el destino sea un archivo ordinario inmediatamente antes de `ReplaceFileW`. La operación Win32 aún es por ruta y conserva una ventana de carrera pequeña; resolverla requiere una operación relativa al handle del directorio. |
| Alta | Las releases anteriores no tenían un instalador desde la app ni autenticación criptográfica de los paquetes de actualización | Integrado updater Tauri, HTTPS, clave pública fija, artefactos NSIS firmados y secreto privado en GitHub Actions. Falta validar el salto real entre versiones publicadas. |

## Dependencias

- `npm audit --audit-level=high`: 0 vulnerabilidades conocidas en dependencias npm al auditar.
- `cargo audit` sobre `Cargo.lock` reportó tres avisos: `chrono` (sin mantenimiento), `proc-macro-error` (sin mantenimiento) y `glib 0.18.5` con una advertencia de soundness RUSTSEC-2024-0429 (solución `>=0.20.0`). `cargo tree -i <crate> --target x86_64-pc-windows-msvc` no encuentra ninguno en el árbol de Windows; son dependencias para otros targets de Tauri. Son avisos del lockfile multi-plataforma, no componentes del artefacto Windows auditado. Repetir auditoría al habilitar distribución para esos otros targets.

## Riesgos pendientes / límites

- La terminal ejecuta procesos con los permisos completos de la cuenta Windows. El modo automático del agente usa filtros heurísticos y no es un sandbox; alias, funciones y perfiles de shell personalizados pueden alterar su significado.
- Los comandos Tauri de la ventana son una frontera de confianza. CSP reduce la exposición a inyección web, pero una vulnerabilidad local del WebView o del frontend puede alcanzar capacidades concedidas.
- La conexión HTTPS a un endpoint configurado por el usuario puede enviarle prompts, contexto de terminal y archivos elegidos. Revisar el destino y el contexto antes de enviar.
- No se probó malware local, una cadena de suministro comprometida, instalación limpia, escape del sandbox del WebView ni seguridad del sistema operativo. La firma del updater no equivale a Authenticode ni protege frente a una cuenta/repositorio o clave privada comprometidos.

## Verificación

Se ejecutaron `git diff --check`, `npm audit`, `cargo audit`, pruebas frontend con cobertura, cobertura Rust y build NSIS de Windows con generación de `.sig`. La prueba estática no sustituye la validación manual del instalador y actualización real.

- Interfaz: 26 pruebas pasadas; cobertura global 28,93 % de líneas. La suite no monta `App.tsx`; `TerminalPane.tsx` tiene 88,88 % de líneas y el gestor de actualizaciones 95,29 %.
- Backend Rust: 30 pruebas pasadas, 0 fallidas, 1 ignorada; cobertura 51,58 % de líneas (53,99 % de regiones). `lib.rs` y `providers.rs` requieren más cobertura.
- `npm audit`: 0 vulnerabilidades; `cargo check`, build frontend, build NSIS y `git diff --check` pasan. `cargo audit` conserva tres avisos heredados de mantenimiento/soundness de dependencias no usadas en el artefacto Windows.
- Build NSIS: completado con firma de updater; generó `Laural_0.1.0-alpha.14_x64-setup.exe` (2,97 MiB) y su archivo `.sig`. Instalación limpia, aviso de Windows y actualización real aún requieren ejecución manual.
