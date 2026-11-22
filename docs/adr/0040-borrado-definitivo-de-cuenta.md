# ADR-0040: Borrado definitivo de la cuenta de sincronización

- **Estado:** Aceptada; API y cliente local integrados, validación VPS pendiente
- **Fecha:** 2026-11-22
- **Decisores:** Antonio Moles

## Contexto

La cuenta de sync conserva correo, sesiones, factores MFA, snapshots de preferencias y eventos de notificación. El usuario necesita poder borrar la cuenta y los datos remotos sin perder su configuración local ni sus claves de proveedor.

## Decisión

- La persona solicita el borrado desde **Cuenta y sincronización**, vuelve a autenticarse por el flujo normal de Laural, confirma con la frase literal `ELIMINAR` y completa la operación con una sesión emitida en los últimos diez minutos.
- El servicio elimina la fila de `accounts` en una sola transacción. Las claves foráneas `ON DELETE CASCADE` eliminan sesiones, snapshots, idempotencias, desafíos, factores, códigos y avisos asociados.
- Limitar cada origen a tres solicitudes cada quince minutos. La ruta acepta solo el campo de confirmación cerrado y no registra cuerpo/cabeceras.
- Tras `204`, el cliente quita la sesión de Credential Manager y elimina el estado local de sync (snapshots y revisión). Mantiene preferencias, perfiles, claves API, conversaciones locales y archivos del proyecto. Si la limpieza local falla, muestra el estado y ofrece reintentarla sin repetir la solicitud remota.
- La aplicación no envía correo de despedida y no conserva un registro personal de cuentas borradas. Los avisos de seguridad pendientes asociados desaparecen con la cuenta.
- Si la sesión no es reciente, devolver `403 recent_auth_required`; no usar el PIN del buzón como sustituto de la autenticación. Un fallo de red deja el resultado remoto indeterminado, por lo que el cliente advierte que debe comprobar el estado antes de repetir.

## Alternativas consideradas

- Retención lógica mediante `deleted_at`: mantiene identificadores y requiere definir purga/retención, y contradice el borrado inmediato solicitado por el diseño.
- Solicitar el PIN de correo: el correo no se acepta como autenticador de sesión ni permite sustituir MFA.
- Borrar también perfiles y claves locales: mezcla la eliminación de la cuenta con la configuración local-first y puede destruir credenciales que el usuario quiere conservar.

## Consecuencias

- El borrado es irreversible desde el servicio; copia local de preferencias/perfiles y claves permanece en el equipo. No hay backups externos; una copia en el mismo VPS queda fuera de esta implementación.
- La última sesión reciente y la frase de confirmación protegen contra una sesión antigua o un clic accidental; cuentas con TOTP deben completar el challenge MFA normal al volver a iniciar sesión.
- Fallos de respuesta durante la conexión pueden hacer ambiguo el resultado para el cliente; debe tratarse como operación sensible y validar el estado antes de volver a intentar.
- Pruebas de cascada, aislamiento entre cuentas, vencimiento de autenticación, límites y flujo de reintento pasan localmente; aún falta ensayo en una instalación Windows y contra el VPS antes del despliegue.

## Evidencia / enlaces

- [Diseño de sincronización](../designs/sincronizacion-preferencias-y-portabilidad.md)
- [Caso de uso UC-27](../use-cases/sincronizacion-preferencias.md)
- [Threat model](../security/threat-model.md)
