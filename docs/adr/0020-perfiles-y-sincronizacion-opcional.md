# ADR-0020: Perfiles locales, portabilidad y sincronización opcional

- Estado: Propuesta
- Fecha: 2026-11-21
- Decisores: Laural contributors

## Contexto

El MVP funciona sin cuenta, mantiene perfiles y preferencias en el equipo y guarda las claves API en Credential Manager. Se solicita mover ajustes a otro equipo mediante un archivo, con inclusión voluntaria de claves, o sincronizarlos con una cuenta. La sincronización autenticada requeriría operar un backend e identidad.

## Decisión propuesta

- Mantener el uso local sin registro; el perfil local inicial se etiqueta **Usuario desconocido** y no representa una cuenta.
- Separar **exportar/importar** de **sincronizar** como flujos y formatos distintos.
- Permitir exportar preferencias y metadatos de perfiles. Las claves API se excluyen por defecto y solo entran al archivo tras selección explícita y contraseña obligatoria. No habrá exportación de claves en texto plano; sin contraseña se exporta solo configuración no secreta.
- No sincronizar nunca claves API, contraseñas, tokens OAuth/de sesión, passkeys, historial de chat/terminal ni contexto de proyectos.
- Sincronizar preferencias y perfiles de proveedor tras registro/inicio de sesión opcional. Registrar nombre, correo verificado y credenciales de cuenta en el servicio; ofrecer contraseña, Google OIDC, passkeys y MFA.
- Para la app nativa, usar navegador externo y Authorization Code con PKCE para Google. Implementar passkeys con WebAuthn y validar credenciales en servidor.
- No sobrescribir configuración al iniciar sesión sin vista previa y elección explícita; conservar copia local y detectar conflictos mediante revisiones.
- Mantener la app completa en modo local cuando la persona no quiera cuenta o el servicio no esté disponible.

Los detalles criptográficos del archivo, retención del servicio, sincronización de políticas del agente y alojamiento se desarrollan en el [plan de sincronización](../plans/sincronizacion-preferencias.md). Este ADR permanece propuesto hasta acordar servicio, privacidad y recuperación de cuenta.

## Alternativas consideradas

- Mantener solo configuración local: conserva privacidad y simplicidad, pero no resuelve transferencia segura ni sincronización.
- Sincronizar directamente un JSON con claves: descarta el aislamiento de Credential Manager y puede filtrar secretos; rechazada.
- Usar Google Drive/Dropbox como backend: acopla Laural a un tercero y no define autenticación, conflictos ni eliminación; no elegida para la propuesta.
- Sincronización en nube sin cuenta: no ofrece autorización individual, recuperación ni revocación de dispositivos.
- Añadir cifrado de extremo a extremo desde el primer incremento: ofrece confidencialidad frente al operador, pero requiere diseño adicional de recuperación y vinculación de dispositivos. Se deja como decisión pendiente, sin prometerlo.

## Consecuencias

- El modo local sigue sin coste operativo para la persona y sin registro.
- La transferencia puede contener claves solo si la persona lo solicita y protege el archivo con contraseña y cifrado autenticado. La configuración sin claves puede exportarse sin contraseña.
- El servicio opcional implica hosting, correo, almacenamiento, protección contra abuso, soporte, borrado de cuenta y política de privacidad.
- La metadata de endpoints personalizados puede revelar infraestructura privada; la app debe mostrarla antes de sincronizar y permitir excluirla.
- Los perfiles de proveedor sincronizados no contendrán claves. En un dispositivo nuevo, el usuario tendrá que introducir sus claves localmente.
- El modo/reglas del agente no se sincronizan por defecto; se requiere consentimiento separado para transferir permisos entre equipos.

## Evidencia

- [Plan de sincronización y portabilidad](../plans/sincronizacion-preferencias.md)
- [ADR-0007: sin cuentas ni sincronización en el MVP](0007-local-first-no-sync-mvp.md)
- [RFC 8252: OAuth para apps nativas](https://www.rfc-editor.org/rfc/rfc8252.html)
- [OWASP: almacenamiento de contraseñas](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
