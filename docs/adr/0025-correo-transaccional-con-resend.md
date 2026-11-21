# ADR-0025: Correo transaccional con Resend

- **Estado:** Aceptada; adapter y flujo inicial implementados, remitente/secretos por configurar
- **Fecha:** 2026-11-21
- **Decisor:** Antonio Moles

## Contexto

El servicio de sincronización necesita enviar verificación de correo, recuperación de acceso y avisos de seguridad. La aplicación de escritorio no debe depender de un servicio propio de correo ni contener credenciales de envío.

## Decisión

- Usar Resend como proveedor de correo transaccional para el servicio alojado en el VPS.
- Realizar los envíos desde el backend TypeScript/Fastify mediante la API/SDK de servidor de Resend. El cliente Tauri nunca se conecta a Resend.
- Mantener la API key en un secreto o variable de entorno del VPS, por ejemplo `RESEND_API_KEY`. No se guarda en Git, en el instalador ni en la configuración de usuario. No pedir ni enviar la clave por el chat.
- Crear una API key restringida a envío y, si Resend lo permite en la cuenta, limitarla al dominio verificado.
- Verificar en Resend un dominio de envío y publicar los registros DNS que muestre el panel (incluidos SPF/DKIM según corresponda) antes de enviar a direcciones de usuarios. El nombre de dominio y la dirección `From` aún deben elegirse.
- Usar el proveedor solo para correo necesario para la cuenta: verificación, PIN de seis dígitos, recuperación, restablecimiento de contraseña y avisos de seguridad. No enviar marketing ni sincronizar la agenda de contactos.
- No registrar PIN, enlaces secretos, contenido completo del correo ni API keys en los logs de Laural. Manejar errores y reintentos sin duplicar envíos; usar idempotencia cuando la operación lo admita.

## Alternativas consideradas

- **SMTP propio:** requiere administrar entrega, reputación, rebotes y protección contra abuso. No elegido para el primer servicio.
- **Otro proveedor transaccional:** no elegido; el propietario ya tiene una cuenta gratuita de desarrollador en Resend.

## Consecuencias

- Resend recibirá la dirección destinataria y el contenido necesario para entregar los correos de cuenta. La política de privacidad deberá identificarlo como proveedor cuando la función esté implementada.
- El sistema depende de la disponibilidad y límites de la cuenta de Resend; si el envío falla, la cuenta local no debe perder datos y la UI debe mostrar una vía de reintento o estado claro.
- Antes de producción faltan: dominio/remitente verificado, registros DNS, clave de envío restringida, variables de entorno del VPS, plantillas accesibles y pruebas de entrega, expiración de PIN y fallos/reintentos.

## Referencias

- [Documentación de la API de correo de Resend](https://resend.com/features/email-api)
- [Permisos de las API keys de Resend](https://resend.com/changelog/new-api-key-permissions)
- [ADR-0023: arquitectura del servicio de preferencias](0023-servicio-de-sincronizacion.md)
