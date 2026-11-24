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

La estrategia ya rige las decisiones de clasificación y diseño de tests, pero los gates de CI aún no la reflejan por completo. No afirmar que la cobertura del proyecto cumple 100/80/0 hasta que los informes por categoría y los gates lo demuestren.

Línea base obtenida del artefacto CI del commit `087f03d` (24-11-2026): la interfaz ejecutó 168 tests y alcanzó 79,78 % de líneas. En Rust, la medición estable dio 68,98 % de líneas globales; entre módulos Críticos, `account.rs` 31,80 %, `agent_files.rs` 91,78 %, `chat_stream.rs` 96,18 %, `configuration_transfer.rs` 94,10 %, `git_panel.rs` 87,94 %, `preferences/snapshot.rs` 97,67 %, `providers.rs` 78,57 %, `sync.rs` 38,36 %, `terminal_flow.rs` 94,94 % y `terminal_output.rs` 100 %. El job de ramas de ese commit no midió cobertura porque falló durante la instalación de dependencias nativas en Ubuntu; no se interpreta como incumplimiento del umbral.

El gate existente todavía pide 85 % de líneas en un subconjunto de Rust y 65 % de ramas en tres módulos. La migración pendiente es clasificar el resto del código por archivo, cubrir los huecos Críticos hasta 100 %, llevar los módulos Estándar al menos a 80 % y hacer que CI valide cada categoría mientras excluye Triviales.
