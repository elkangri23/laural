# Arquitectura

## Estado

Esta página describe la implementación inicial, y señala dónde termina la implementación y empieza la intención de producto. No afirma aislamiento del agente ni soporte completo de cualquier proveedor OpenAI-compatible.

## Componentes

```mermaid
flowchart LR
  UI[React + TypeScript] -->|invoke / eventos| Tauri[Tauri 2]
  UI --> XTerm[xterm.js]
  Tauri --> PTY[Rust + portable-pty]
  PTY --> Shells[PowerShell / CMD / WSL / Git Bash]
  Tauri --> Provider[Cliente HTTP reqwest]
  Provider --> API[OpenAI-compatible endpoint]
  Tauri --> Keyring[Windows Credential Manager]
  Tauri --> Config[JSON local: perfiles y política]
  Tauri --> Project[Archivos dentro del proyecto]
  SyncAPI[Fastify API local de snapshots] --> SyncDB[(PostgreSQL)]
```

## Responsabilidades

### UI (React/TypeScript)

Administra pestañas, shell seleccionado, directorio del proyecto, contexto elegido, chat, planes de agente y confirmaciones. Renderiza la terminal mediante xterm.js y convierte entrada/salida a invocaciones/eventos Tauri.

La apariencia se administra en React y se aplica con atributos CSS `data-theme`/`data-mode` y propiedades personalizadas. La paleta de 12 temas y el modo claro/oscuro se guardan en `localStorage` del WebView; actualizar los colores de xterm.js no debe destruir la sesión PTY. La preferencia local `laural.powershell-prediction.v1` es optativa, inicia desactivada y solo se lee al crear terminales nuevas.

### Shell nativo (Rust)

`portable-pty` abre un pseudo-terminal para el shell seleccionado. Rust mantiene sesiones, redimensiona la terminal y envía bytes de salida al frontend. Cada terminal marca entrada con OSC 133 para delimitar bloques y devolver códigos de salida cuando el shell lo permite. Las marcas son locales a la sesión; no se escriben perfiles persistentes del usuario. Si la preferencia local está activa y la shell es PowerShell, el constructor existente añade un bloque fijo que comprueba los parámetros de predicción de PSReadLine y solicita historial inline dentro de `try/catch`; ante ausencia o incompatibilidad, la sesión continúa con su prompt normal. Ningún otro shell recibe este bloque.

### Proveedores

El cliente Rust usa HTTP para consultar `/models` y enviar solicitudes en streaming a `/chat/completions`. Los eventos de fragmentos se asocian al identificador de la petición; el registro local permite cancelarla. `preview_context` devuelve los mismos recortes de terminal, proyecto y archivos que usa el envío. El identificador de modelo, URL base y nombre se guardan en `providers.json`; la clave se busca por perfil en el almacén del sistema operativo.

En modo Chat, los bloques Markdown etiquetados para el shell activo pueden preparar una línea en el PTY correspondiente. La capa UI exige shell compatible y línea única; `TerminalPane` rechaza una terminal ocupada y usa el pegado nativo de xterm.js, sin carácter Enter y sin reemplazar texto presente en la línea. El prompt de Rust especifica PowerShell, CMD o Bash para WSL/Git Bash. El botón no forma parte del modo Agente y no ejecuta el comando.

### Agente

El modelo propone un JSON con resumen, comandos y archivos. Rust valida el formato, las rutas relativas y tamaños. Los comandos pasan por la política del usuario; el plan puede cancelarse, cada comando se espera hasta su marca de finalización y se puede transmitir Ctrl+C al PTY. Las escrituras de archivo exigen aprobación y guardan una copia de archivos existentes. No hay bucle autónomo de herramientas ilimitado.

### Almacenamiento local

- `providers.json`: perfiles sin secretos y perfil activo.
- `agent.json`: modo y comandos exactos permitidos.
- `localStorage`: tema, modo de apariencia e historial acotado de hasta 100 mensajes.
- `localStorage`: preferencia desactivada por defecto de predicción PSReadLine; no se incluye en snapshots ni transferencia.
- Memoria de UI: historial efímero de hasta 100 comandos para la paleta; no se conserva tras cerrar la app.
- Windows Credential Manager: secretos por proveedor.
- Archivos de proyecto: solo archivos explícitamente aprobados por la persona.
- Bloques de comando: estado en memoria de la sesión, hasta 160 por aplicación.

## Flujos de datos

### Terminal

```mermaid
sequenceDiagram
  participant U as Usuario
  participant UI as React/xterm.js
  participant R as Backend Rust
  participant S as Shell de Windows
  U->>UI: Escribe entrada
  UI->>R: write_terminal
  R->>S: bytes por PTY
  S-->>R: salida por PTY
  R-->>UI: evento terminal-output
  UI-->>U: renderiza la salida
```

### Chat contextual

```mermaid
sequenceDiagram
  participant U as Usuario
  participant UI as Laural
  participant R as Backend Rust
  participant P as Proveedor configurado
  U->>UI: Envía pregunta y contexto elegido
  UI->>R: mensajes + terminal + proyecto + adjuntos
  R->>R: aplica límites y carga clave del almacén
  R->>P: POST /chat/completions
  P-->>R: eventos SSE
  R-->>UI: fragmentos asociados al ID de solicitud
```

## Límites y evolución

- La terminal es un shell con los permisos del usuario de Windows; Laural no lo sandboxea.
- El modo automático usa comprobaciones heurísticas y no reemplaza el consentimiento informado ni controles del sistema operativo.
- La autorización de una acción del agente no significa que la operación sea reversible.
- El contexto se envía al endpoint elegido por el usuario. Un endpoint remoto puede almacenar solicitudes según sus propias condiciones.
- Las marcas de bloques y códigos de salida varían por shell; PowerShell, CMD y Bash están instrumentados inicialmente. Scripts de inicio pueden sobrescribir `PROMPT_COMMAND` y comandos interactivos pueden no terminar solos.
- La vista previa representa el contenido recogido al abrirla; la terminal puede producir más salida antes de enviar.
- El cliente instalado ya prepara snapshots v2 con idioma y maneja rechazos sin reemplazar el estado local; falta desplegar y probar el servicio v2 en el VPS antes de publicar esta versión. El inicio de sesión de cuenta conecta con el servidor configurado si está habilitado; las rutas de registro/login del backend local permanecen desactivadas por defecto.

## Extensión aprobada: portabilidad local y sync

El diseño posterior aprobado añade una superficie opcional sin cambiar el funcionamiento local actual:

```mermaid
flowchart LR
  UI[Configuración React] -->|IPC| R[Rust: allowlist y cliente HTTPS]
  R --> LOCAL[Preferencias y perfiles locales]
  R -->|snapshot versionado, revisiones condicionales| API[Fastify en VPS del proyecto]
  API --> DB[(PostgreSQL)]
  R -. claves siempre locales .-> CM[Credential Manager]
  STATUS[status estático en Caddy, mismo VPS] --> API
```

La portabilidad local ya cuenta con un módulo Rust para el formato `.laural` v2, lector v1, validación y cifrado/descifrado autenticado por versión, y comandos Tauri para vista previa, exportación e importación. La UI nativa de Configuración permite fusionar o reemplazar perfiles. Las claves se escriben en Windows Credential Manager; las copias previas se guardan localmente. Falta validar fallos reales y recuperación en Windows. Los contratos cerrados v1 y v2 tienen schemas compartidos y tipos Rust/TypeScript; v2 añade únicamente `preferences.language` (`es` o `en`) a la allowlist. Rust construye snapshots v2 desde preferencias y metadatos permitidos, acepta v1 al leer y conserva el idioma local al aplicar snapshot v1. El servicio desplegado en VPS acepta ambos formatos; falta validar desde la app instalada la escritura v2, conflictos y continuidad ante errores. Si el servidor rechaza una versión, la app conserva la configuración local y marca la sincronización pendiente. Los perfiles guardan el tipo y el consentimiento opcional del endpoint, falso por defecto, con migración compatible. El backend incluye API Fastify de snapshots, registro/verificación, página de login PKCE y sesión por hash; TOTP y passkeys passwordless están integradas detrás de flags, manteniendo TOTP si está habilitado. Las altas y bajas de passkeys encolan avisos genéricos en la misma transacción, mediante el outbox común. CI prueba migraciones, rate limit y rutas de snapshots con PostgreSQL temporal. El proxy inverso sirve `/status` desde el VPS. Verificación externa 24-11-2026 confirma status 200, health live/ready 200, HTTPS y cabeceras de seguridad en la página; el documento de status es manual. Tauri abre el navegador, valida callback, guarda el token en Credential Manager y ofrece gestión passkey mediante enlace limitado; quedan Google, validar la integración real, recuperación administrativa y operación/actualización del status. Consulta el [servicio](../../server/README.md), el [diseño formal](../designs/sincronizacion-preferencias-y-portabilidad.md) y el [plan de entrega](../plans/sincronizacion-preferencias.md).

## Estructura de código

| Ruta | Propósito |
| --- | --- |
| `src/App.tsx` | Estado y composición principal de interfaz |
| `src/components/TerminalPane.tsx` | xterm.js, eventos de salida y entrada de terminal |
| `src/accountActionGuards.ts` | Guardas testeables de MFA, borrado y sincronización; transformación inmutable del historial |
| `src/terminalPaneState.ts` | Actualización de tema/parpadeo y lectura segura de selección de xterm |
| `src-tauri/src/lib.rs` | PTY, ejecución controlada de comandos y escrituras de archivo |
| `src-tauri/src/providers.rs` | Proveedores, contexto, chat, planes y política del agente |
| `server/src` | API privada local para snapshots, auth de sesiones ya provisionadas y persistencia PostgreSQL |
| `src-tauri/src/activity_log.rs` | Historial local acotado de metadatos de acciones del agente |
| `src-tauri/capabilities/default.json` | Permisos Tauri explícitos |
