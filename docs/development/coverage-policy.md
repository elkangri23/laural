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
- Servicio: autenticación, cuentas, MFA/TOTP, passkeys, OAuth, recuperación, criptografía de tickets, limitación de solicitudes, almacenamiento de sesiones/snapshots y outbox de avisos de seguridad.
- Interfaz: flujos de cuenta/factores, transferencia que puede incluir claves, aprobación/ejecución del agente, terminal y actualización firmada.

Para esta política, `scripts/check-critical-rust-coverage.mjs` y sus tests son Críticos porque deciden si el gate acepta un informe; `.github/workflows/cobertura.yml` es Trivial/configuración declarativa y no recibe tests propios.

`SettingsDialog.tsx` y las vistas de estado/ayuda con interacción ordinaria son Estándar. Catálogos de traducciones, iconos estáticos, configuración YAML/TOML, DTO puros y artefactos generados son Triviales. Cada archivo nuevo o modificado para tests recibe clasificación explícita antes de escribirlos.

## Estado de la aplicación de los gates

La política ya guía la clasificación y el diseño de pruebas. CI aplica un primer gate 100/100 a `server/src/config.ts`, `server/src/auth.ts` y `server/src/email-auth.ts` (líneas/ramas). El gate está definido en `server/scripts/check-critical-coverage.mjs` y se ejecuta después de la suite de cobertura del servicio. No afirmar cumplimiento global hasta que todos los archivos estén clasificados y los gates por categoría estén completos.

Medición local del 24-11-2026: servicio sync, 181 pruebas pasadas y 11 omitidas; 76,07 % de líneas y 74,68 % de ramas globales. Los tres módulos protegidos por el nuevo gate alcanzan 100 % de líneas y ramas. La cobertura global aún no cumple el nivel Estándar del 80 % y los demás módulos Críticos no llegan todos al 100 %.

La línea base anterior sigue siendo el último informe CI para interfaz y Rust: commit `087f03d`, 24-11-2026; UI 79,78 % de líneas; Rust 68,98 % global. En módulos Rust Críticos: `account.rs` 31,80 %, `agent_files.rs` 91,78 %, `chat_stream.rs` 96,18 %, `configuration_transfer.rs` 94,10 %, `git_panel.rs` 87,94 %, `preferences/snapshot.rs` 97,67 %, `providers.rs` 78,57 %, `sync.rs` 38,36 %, `terminal_flow.rs` 94,94 % y `terminal_output.rs` 100 %. El job de ramas de ese commit no generó medición al fallar la instalación de dependencias nativas en Ubuntu.

La migración pendiente es clasificar el resto del código por archivo, ampliar gates gradualmente a módulos Críticos hasta 100 % de líneas y ramas, subir los módulos Estándar a 80 % de líneas y excluir los Triviales de tests y denominadores. El gate Rust anterior continúa en 85 % de líneas y 65 % de ramas hasta migrar sus módulos.
