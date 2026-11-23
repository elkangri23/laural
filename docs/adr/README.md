# Decisiones de arquitectura (ADR)

Los ADR registran por qué se eligió una opción y qué costes trae. Un ADR aceptado no implica que todos sus detalles estén terminados. Para cambiar una decisión, crea un ADR nuevo que la sustituya y conserva el anterior.

| ADR | Decisión | Estado |
| --- | --- | --- |
| [0001](0001-tauri-windows-desktop.md) | Aplicación de escritorio con Tauri 2 | Aceptada |
| [0002](0002-rust-pty-backend.md) | Backend Rust y `portable-pty` para sesiones de shell | Aceptada |
| [0003](0003-xterm-terminal-ui.md) | xterm.js para dibujar terminales | Aceptada |
| [0004](0004-openai-compatible-providers.md) | API compatible con OpenAI como interfaz inicial de proveedores | Aceptada |
| [0005](0005-windows-credential-storage.md) | Guardar claves en Credential Manager de Windows | Aceptada |
| [0006](0006-agent-plan-and-approval.md) | Planes del agente validados y acciones con controles locales | Aceptada |
| [0007](0007-local-first-no-sync-mvp.md) | Sin cuenta ni sincronización en el MVP | Aceptada |
| [0008](0008-independent-implementation-mit.md) | Implementación independiente y licencia MIT | Aceptada |
| [0009](0009-local-json-profile-storage.md) | Perfiles y política en JSON local, secretos aparte | Aceptada |
| [0010](0010-theme-and-appearance-preferences.md) | Doce paletas y modo claro/oscuro local | Aceptada |
| [0011](0011-streaming-chat-and-local-history.md) | Chat incremental y almacenamiento local de conversaciones | Aceptada |
| [0012](0012-shell-integration-and-command-blocks.md) | Marcas OSC de shell y bloques de comando | Aceptada |
| [0013](0013-configuracion-local.md) | Centro de configuración local | Aceptada |
| [0014](0014-escritura-segura-agente.md) | Escritura segura de archivos del agente | Aceptada |
| [0015](0015-csp-y-minimo-de-permisos.md) | CSP estricta y permisos mínimos en WebView | Aceptada |
| [0016](0016-retencion-configurable-copias.md) | Retención opcional de copias del agente | Aceptada |
| [0017](0017-actualizaciones-firmadas.md) | Actualizaciones firmadas desde GitHub | Aceptada |
| [0018](0018-registro-local-de-actividad-del-agente.md) | Historial local acotado con metadatos mínimos del agente | Aceptada |
| [0019](0019-reemplazo-seguro-por-handle.md) | Reemplazo de archivos existentes con handles y colisión sin sobrescritura en Windows | Aceptada |
| [0020](0020-perfiles-y-sincronizacion-opcional.md) | Perfil local, exportación/importación y sincronización opcional sin claves API en nube | Aceptada; portabilidad parcial, sync pendiente |
| [0021](0021-paleta-e-historial-de-comandos.md) | Paleta de acciones y comandos recientes solo en sesión | Aceptada |
| [0022](0022-cifrado-de-exportaciones-y-claves-locales.md) | Contraseña obligatoria para exportar claves y límites del Credential Manager | Aceptada; implementación inicial disponible |
| [0023](0023-servicio-de-sincronizacion.md) | Fastify/PostgreSQL, API oficial, revisiones, auth nativa y estado público | Aceptada; servicio parcial |
| [0024](0024-sin-copias-fuera-del-vps.md) | No mantener copias de sincronización fuera del VPS | Aceptada; comunicar riesgo de pérdida total |
| [0025](0025-correo-transaccional-con-resend.md) | Correo transaccional del servicio con Resend | Aceptada; primer adapter implementado, remitente/secretos por configurar |
| [0026](0026-api-inicial-de-snapshots.md) | API privada de snapshots con revisión, idempotencia y schema compartido | Aceptada; integración Tauri y despliegue pendientes |
| [0027](0027-registro-y-verificacion-de-correo.md) | Registro inicial y PIN de correo no autenticador mediante Resend | Aceptada; primera fase implementada |
| [0028](0028-login-nativo-pkce.md) | Login por navegador externo, callback loopback y canje PKCE | Aceptada; cliente inicial implementado, VPS pendiente |
| [0029](0029-cliente-de-sincronizacion-y-conflictos.md) | Cliente Rust, elección de snapshots completos y copia local previa | Aceptada; cliente manual/automático implementado inicialmente, validación VPS pendiente |
| [0030](0030-panel-git-de-solo-lectura.md) | Panel Git local de solo lectura, con límites y sin shell | Aceptada; implementación inicial disponible |
| [0031](0031-recetas-locales-del-agente.md) | Recetas locales como instrucciones revisables para el agente | Aceptada; versión inicial disponible |
| [0032](0032-pagina-publica-de-estado.md) | Estado público servido en el mismo VPS y actualizado por SSH | Aceptada; implementación inicial, despliegue pendiente |
| [0033](0033-limites-persistentes-por-ip.md) | Límites atómicos por IP/ruta en PostgreSQL con huella HMAC | Aceptada; código y migración listos, validación VPS pendiente |
| [0034](0034-revocacion-de-sesion-al-cerrar-sesion.md) | Revocar la sesión actual al cerrar sesión, con limpieza local aun sin red | Aceptada; API y cliente implementados, VPS pendiente |
| [0035](0035-retencion-de-registros-transitorios.md) | Limpieza periódica de PINs, PKCE, sesiones e idempotencias | Aceptada; servicio y pruebas implementados, VPS pendiente |
| [0036](0036-gestion-de-sesiones-de-cuenta.md) | Consultar y revocar sesiones propias de otros dispositivos | Aceptada; API, cliente y pruebas implementados, VPS pendiente |
| [0037](0037-restablecimiento-de-contrasena-por-pin.md) | Cambiar la contraseña con PIN de correo, sin crear sesión ni quitar MFA | Aceptada; servicio implementado, Resend/VPS pendiente |
| [0038](0038-fundamentos-de-mfa-totp.md) | TOTP RFC 6238, semilla cifrada y códigos de recuperación | Aceptada; integración y avisos en cola locales, entrega VPS pendiente |
| [0039](0039-outbox-de-avisos-de-seguridad.md) | Cola PostgreSQL transaccional para avisos de cambios MFA | Aceptada; entrega Resend real y despliegue pendientes |
| [0040](0040-borrado-definitivo-de-cuenta.md) | Borrado definitivo en servidor con autenticación reciente | Aceptada; API/cliente iniciales, ensayo VPS pendiente |
| [0041](0041-interrupcion-aislada-de-terminal-windows.md) | Señales de interrupción aisladas por sesión ConPTY | Aceptada; el prototipo seguro sigue pendiente |
| [0042](0042-passkeys-para-cuentas.md) | Passkeys passwordless con TOTP adicional y gestión web acotada | Aceptada; primera implementación local, despliegue pendiente |
| [0043](0043-avisos-de-cambios-passkey.md) | Alta/baja de passkey notificadas mediante outbox transaccional | Aceptada; integración local, entrega Resend pendiente |
| [0044](0044-limites-de-mfa-entre-flujos.md) | Limitar desafíos MFA entre flujos con cuenta vinculada y huella HMAC | Aceptada; CI con PostgreSQL en verde, despliegue VPS pendiente |
| [0045](0045-historial-recuperable-de-preferencias-en-nube.md) | Historial recuperable, paginado y borrable de snapshots de preferencias | Aceptada; implementación local, validación PostgreSQL/VPS pendiente |

## Crear un ADR

Copia [la plantilla](template.md), asigna el siguiente número y registra la decisión antes de implementar un cambio que afecte a arquitectura, privacidad, compatibilidad o formatos persistidos.
