# Runbook: recuperación de cuenta y factores

- **Estado:** flujo TOTP/códigos implementado localmente; no desplegado. La retirada administrativa de factores y el ensayo del VPS están pendientes.
- **Propietario:** administrador del servicio
- **Aprobación de política:** el propietario de Laural
- **Relacionado:** [ADR-0023](../adr/0023-servicio-de-sincronizacion.md), [ADR-0027](../adr/0027-registro-y-verificacion-de-correo.md), [ADR-0028](../adr/0028-login-nativo-pkce.md), [ADR-0036](../adr/0036-gestion-de-sesiones-de-cuenta.md), [ADR-0042](../adr/0042-passkeys-para-cuentas.md), [ADR-0047](../adr/0047-login-con-google-oauth.md)

## Alcance y límite actual

Este procedimiento se refiere a la pérdida de TOTP/códigos y a la recuperación de acceso MFA. TOTP, códigos de recuperación, passkeys passwordless y Google OIDC están implementados localmente detrás de flags; la autenticación permanece desactivada por defecto y no está desplegada. La operación administrativa para retirar factores aún no existe. Este runbook **no autoriza** a retirar factores mediante manipulación manual de la base de datos. La recuperación de contraseña es un flujo distinto.

No hay endpoint público ni panel web administrativo para retirar factores. La acción, cuando esté implementada, se ejecutará desde un canal administrativo autenticado en el VPS. No se debe hacer una excepción informal a los criterios de este procedimiento.

## Rutas permitidas

### 1. El usuario conserva un código de recuperación

1. El usuario inicia sesión con correo/contraseña y presenta un código de recuperación cuando el flujo solicita el segundo factor. El código es de un solo uso y se consume atómicamente.
2. Si el login termina correctamente, el usuario obtiene una sesión normal. El código no inicia por sí solo una retirada de MFA ni revoca automáticamente las demás sesiones.
3. Desde una sesión reciente, el usuario puede administrar TOTP y rotar sus códigos en Configuración. Debe guardar y confirmar los códigos nuevos antes de que reemplacen los anteriores. Desactivar TOTP requiere una sesión reciente y envía un aviso de seguridad cuando el servicio de correo está habilitado.

Un PIN válido sin TOTP/código válido **no** completa el login, no crea una sesión y no retira MFA.

### 2. Se han perdido todos los factores y códigos

1. La persona contacta al administrador por el canal de soporte publicado. El correo registrado solo acredita acceso al buzón mediante el PIN; no demuestra por sí solo la titularidad de los factores perdidos.
2. Con el flujo opcional habilitado, la persona solicita revisión desde la página de acceso. La respuesta es genérica. El servicio limita los envíos y guarda solo HMAC del PIN. Al verificar el buzón con un PIN de un solo uso y cinco minutos, marca el caso como verificado y encola el aviso administrativo con reintentos.
3. El administrador recibe el identificador aleatorio y el correo de la cuenta. El correo advierte que la verificación no constituye prueba independiente. Hasta que exista una herramienta privilegiada ensayada, el aviso solo inicia contacto y no autoriza ninguna operación sobre la cuenta.
4. El administrador evalúa al menos una prueba de titularidad **preexistente**, obtenida antes de la pérdida y contrastable por una fuente independiente del buzón y de la cuenta Laural. Entre las pruebas que pueden cumplir el criterio están una identidad Google ya vinculada, otro factor MFA aún inscrito o un dispositivo de confianza que conserve una sesión autenticada. La prueba debe corresponder a la cuenta y no depender exclusivamente de información proporcionada dentro del mismo correo o de la cuenta posiblemente comprometida.
5. El administrador decide y registra el resultado. La evaluación y la decisión son criterio del administrador; el PIN, la urgencia o el conocimiento de datos sincronizados no sustituyen la prueba independiente.
6. Solo si la prueba es suficiente, el administrador podrá retirar/restablecer factores mediante un procedimiento privilegiado local al VPS cuando este esté implementado y ensayado. La operación deberá revocar todas las sesiones, exigir factores nuevos y enviar un aviso de seguridad. Mientras no exista, no se manipulan filas directamente ni se promete recuperación.
7. Si no existe una prueba independiente suficiente, el administrador **deniega** la retirada. No se reduce la cuenta a autenticación solo por correo y no se crea un bypass alternativo.

## Registro y privacidad

Conservar únicamente: ID de caso, cuenta interna, categoría de prueba (no su contenido), administrador que decidió, decisión, motivo categorizado, factores retirados, fecha/hora y confirmación de revocación de sesiones/aviso. No incluir contraseñas, PIN, códigos, secretos MFA, contenido de documentos ni copias de evidencias en logs o tickets. Restringir el acceso y definir un plazo de retención antes de habilitar la operación.

La app no sincroniza factores MFA ni códigos de recuperación. El operador del VPS puede leer los snapshots permitidos; este procedimiento no cambia esa limitación ni crea copias externas de datos.

## Lista de comprobación antes de cerrar un caso

- [ ] La persona confirmó el buzón mediante un PIN vigente y no reutilizado.
- [ ] Hay código de recuperación válido, o el administrador verificó prueba preexistente por fuente independiente.
- [ ] Se registró decisión y categoría, sin guardar el material probatorio.
- [ ] El factor nuevo quedó enrolado antes de conceder la sesión recuperada.
- [ ] Las demás sesiones quedaron revocadas.
- [ ] Se envió aviso de seguridad sin incluir secretos.
- [ ] El caso no dejó credenciales, códigos ni evidencias en logs/tickets.

## No operar hasta completar

- Mantener la autenticación y `ACCOUNT_RECOVERY_ENABLED` desactivados hasta validar el despliegue, Resend, TOTP/códigos y sus límites.
- Implementar el mecanismo administrativo local al VPS con autorización explícita, confirmación y auditoría mínima; nunca una ruta pública para retirar factores. El formulario de solicitud y el aviso al administrador ya están disponibles detrás del flag, pero no retiran factores.
- Verificar que el PIN solo prueba el buzón, y que no crea sesión ni omite MFA.
- Ensayar PIN vencido/reusado, código incorrecto/reusado, abuso de solicitudes, rechazo por prueba insuficiente, revocación de sesiones, notificación y fallo parcial.
- Probar la restauración del servicio en el VPS y completar su runbook operativo antes de habilitar cuentas externas.
- Para passkeys, definir y ensayar el flujo de recuperación correspondiente antes de habilitarlas.
