# ADR-0023: Arquitectura del servicio de preferencias

- **Estado:** Aceptada
- **Fecha:** 2026-11-21
- **Decisores:** Antonio Moles

## Contexto

ADR-0020 decide el alcance funcional: una transferencia local sin cuenta y sincronización opcional que excluye secretos. Hace falta concretar el servicio de cuenta, el protocolo de revisiones, la autenticación nativa y el aviso público del estado. El código actual no contiene backend de cuentas ni cliente de sync.

## Decisión

- Implementar el servicio en TypeScript con Fastify y PostgreSQL en el VPS del proyecto, bajo `https://sync.laurafernandezenfermeria.com`.
- Mantener la aplicación como Tauri 2/React/Rust. El WebView solicita operaciones por IPC; Rust construye un snapshot cerrado desde preferencias permitidas y perfiles no secretos y realiza las peticiones HTTPS.
- Compartir un esquema JSON versionado para el snapshot. El payload tiene límite de 256 KiB. Las escrituras usan revisión condicional e idempotencia; un conflicto detiene la escritura y solicita una elección completa.
- Guardar localmente la revisión confirmada y el estado pendiente sin credenciales. Guardar primero la configuración local y conservar uso offline.
- Alojar el inicio de sesión en una página propia HTTPS abierta con el navegador externo. Usar PKCE/estado y callback loopback de un solo uso. WebAuthn usa como origin y RP ID `sync.laurafernandezenfermeria.com`. Guardar credenciales de sesión de Laural en Credential Manager.
- Mantener email/contraseña, Google, passkeys y TOTP. El email PIN no sustituye un factor ni permite retirar factores. Para pérdida de todos los factores, el administrador revisa evidencia de forma manual y la operación se realiza desde el VPS; no existe ruta pública de retirada de MFA.
- Enviar correo transaccional mediante Resend; la configuración de remitente, dominio y credenciales queda en variables/secretos del servidor, nunca en el instalador ni en el repositorio.
- Usar TLS y cifrado de almacenamiento del servidor, sin prometer E2EE. El operador puede leer el snapshot permitido; las claves de modelos nunca se suben.
- Servir `/status` sin autenticación como contenido estático desde Caddy en el mismo VPS, separado del proceso API. El administrador publica avisos desde una operación protegida en el servidor. La página sobrevive a fallos de API/base de datos mientras Caddy y el VPS estén activos; no sobrevive a una caída total del host o de red.

## Alternativas consideradas

- **Servicio de sincronización gestionado por terceros:** reduce operación propia, pero añade un proveedor con acceso a datos y acopla cuenta, borrado y recuperación; no elegido.
- **E2EE:** se difiere porque la recuperación de claves y dispositivos requiere diseño adicional y no forma parte del alcance inicial aprobado.
- **Tarea de Windows para sincronizar con Laural cerrada:** añade ciclo de vida, credenciales y mantenimiento del componente; se elige revisar cada tres horas solo mientras la app está abierta y ponerse al día al reabrir.
- **Página de estado en alojamiento independiente:** soportaría una caída total del VPS, pero agrega una infraestructura separada. Se elige el mismo VPS con la limitación documentada.
- **Panel web público de administración:** aumenta superficie de ataque; los avisos y la recuperación se publican/aprueban mediante operaciones administrativas protegidas en el VPS.

## Consecuencias

- El servicio tiene costos de operación, Resend/correo transaccional, abuso, incidentes y soporte; la cuenta es optativa. No habrá copias fuera del VPS por ADR-0024.
- Los endpoints personalizados requieren consentimiento por perfil y pueden revelar nombres de host privados al operador.
- Los conflictos no se fusionan por campo y requieren elección humana con copia recuperable previa.
- Los snapshots de recuperación visibles no caducan automáticamente. No se configurarán copias de desastre fuera del VPS, según ADR-0024. La pérdida total del host puede destruir datos de cuenta y snapshots; la app debe comunicar esta limitación antes de habilitar sync. La existencia de una copia de PostgreSQL dentro del VPS sigue sin decidirse y no protege ante la pérdida del host.
- La propuesta de recuperación genera códigos de un solo uso al activar MFA; el administrador solo retira factores con PIN de correo y una prueba independiente preexistente, revoca sesiones y notifica. Si no hay prueba independiente, no se retiran factores. Falta implementar y ensayar el runbook antes de habilitar el flujo.
- El diseño aprobado no afirma que el backend o la UI estén implementados.

## Evidencia

- [Diseño formal de sincronización y portabilidad](../designs/sincronizacion-preferencias-y-portabilidad.md)
- [Plan de fases y criterios de aceptación](../plans/sincronizacion-preferencias.md)
- [ADR-0020: decisión funcional](0020-perfiles-y-sincronizacion-opcional.md)
- [RFC 8252: OAuth para aplicaciones nativas](https://www.rfc-editor.org/rfc/rfc8252.html)
