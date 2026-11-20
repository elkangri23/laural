# ADR 0015: CSP estricta y permisos mínimos en WebView

- Estado: Aceptada
- Fecha: 2026-11-20

## Contexto

La ventana Tauri ejecuta una interfaz web que puede invocar comandos de terminal y del agente. Una política CSP desactivada aumenta el impacto de una inyección de script. El plugin de apertura externa no se usa y ampliaba permisos disponibles.

## Decisión

Configurar CSP para permitir scripts solo desde el propio bundle, limitar conexiones del WebView al IPC de Tauri, bloquear objetos, frames y formularios externos y conservar estilos inline requeridos por la interfaz. Retirar el plugin de apertura y su permiso. Las peticiones a proveedores siguen saliendo desde Rust.

## Consecuencias

- Reduce vías de carga y ejecución de contenido remoto en el WebView.
- El bundle puede usar estilos inline; no se habilitan `unsafe-eval` ni scripts externos.
- Un XSS que explote código local, una vulnerabilidad del WebView o una compilación comprometida aún puede invocar los comandos concedidos a la ventana.
- Las capacidades Tauri continúan siendo autoridad de la interfaz; CSP no es un sandbox de procesos.
- Toda nueva fuente de scripts, conexión o permiso necesita justificar y revisar el cambio.
