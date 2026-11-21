# ADR-0020: Perfiles locales, portabilidad y sincronización opcional

- **Estado:** Aceptada
- **Fecha:** 2026-11-21
- **Decisores:** Antonio Moles

## Contexto

Laural ya mantiene perfiles y preferencias en el dispositivo y guarda claves de proveedores en Windows Credential Manager. Se necesita transferir la configuración a otro equipo sin cuenta y, de forma opcional, mantener preferencias actualizadas mediante una cuenta. La nube aumenta la carga de privacidad, seguridad, recuperación y operación, por lo que debe tener un alcance explícito y no ser requisito para usar la app.

## Decisión

- Mantener Laural funcional localmente sin cuenta ni servicio.
- Separar **Exportar/importar** de **Sincronizar**. El perfil local inicial se llama **Usuario desconocido** y no es una identidad verificada.
- Exportar preferencias y perfiles sin claves por defecto. Las claves solo se incluyen con consentimiento y contraseña obligatoria, dentro de un archivo cifrado autenticado; no se permite exportar claves en claro. Importar directamente en Credential Manager.
- La nube nunca contiene claves API, credenciales de cuenta, tokens, passkeys, MFA, chat, comandos/historial, proyecto/rutas, actividad del agente ni reglas de ejecución.
- Sincronizar tema/apariencia, actualización y metadatos de perfiles de proveedor. Los endpoints personalizados requieren consentimiento individual por perfil.
- Mantener el servicio opcional, alojado por el proyecto. La primera versión no promete E2EE y debe informar que el operador puede leer el snapshot permitido.
- Solicitar elección antes de la primera carga, reemplazo o conflicto. Elegir un snapshot completo sin diferencias por campo ni fusión. Guardar copia recuperable antes del reemplazo; no aplicar «última escritura gana» en silencio.
- Sincronizar cambios guardados automáticamente, ofrecer **Sincronizar ahora** y revisar la nube cada tres horas mientras Laural está abierta. Guardar en local primero y mantener cambios pendientes si no hay red.
- Admitir email/contraseña, Google, passkeys y TOTP en la primera versión de sync. El PIN de correo de seis dígitos dura cinco minutos y es de un solo uso; solo sirve para verificación/recuperación, nunca como acceso por sí solo ni como sustituto MFA.
- Si se pierden todos los factores, el administrador evalúa el caso con pruebas independientes y decide manualmente. El PIN no autoriza a retirar factores.
- Añadir un estado público sin autenticación para disponibilidad, avisos y mantenimiento.

## Alternativas consideradas

- **Solo configuración local:** se conserva como modo garantizado, pero no cubre sincronización entre dispositivos.
- **Solo transferencia manual:** no requiere cuenta ni servidor, pero no mantiene dispositivos al día; se conserva como opción completa.
- **Sincronización mediante nube de terceros:** no ofrece un contrato uniforme de conflictos, acceso, revocación y borrado; no elegida para la primera versión.
- **E2EE desde el primer lanzamiento:** reduciría el acceso del operador, pero requiere definir recuperación de claves y nuevos dispositivos; queda fuera de la primera versión.
- **Diferencias por campo/fusión:** conserva cambios parciales, pero complica la interfaz y los conflictos; se elige un snapshot completo con advertencia genérica y copia recuperable.

## Consecuencias

- Los perfiles importados no llevan claves de proveedores; cada dispositivo requiere configurar sus secretos localmente, salvo que la persona eligiera exportarlos cifrados.
- Los snapshots de recuperación visibles no caducan automáticamente. El usuario puede borrarlos; eliminar cuenta elimina las copias de nube. Por ADR-0024 no se mantienen copias fuera del VPS; la pérdida total del host puede borrar definitivamente los datos sincronizados.
- La URL de endpoint puede revelar infraestructura privada y por eso no se sincroniza sin consentimiento expreso para ese perfil.
- Los perfiles y reglas del agente permanecen locales para evitar transferir permisos de ejecución.
- La exportación/importación local tiene una implementación inicial; cuentas y sincronización siguen pendientes. El contrato del snapshot v1 está en curso y aún no se construye desde los perfiles locales. Las fases y criterios están en el [plan de sincronización](../plans/sincronizacion-preferencias.md) y el [diseño formal](../designs/sincronizacion-preferencias-y-portabilidad.md).

## Evidencia

- [ADR-0007: sin cuenta ni sincronización en el MVP](0007-local-first-no-sync-mvp.md)
- [ADR-0005: Credential Manager](0005-windows-credential-storage.md)
- [ADR-0022: cifrado de exportaciones](0022-cifrado-de-exportaciones-y-claves-locales.md)
- [ADR-0023: servicio de sincronización](0023-servicio-de-sincronizacion.md)
