# Runbook: recuperación de cuenta y factores

- **Estado:** procedimiento diseñado; no ejecutar en producción todavía
- **Propietario:** administrador del servicio
- **Aprobación de política:** el propietario de Laural
- **Relacionado:** [ADR-0023](../adr/0023-servicio-de-sincronizacion.md), [ADR-0027](../adr/0027-registro-y-verificacion-de-correo.md), [ADR-0028](../adr/0028-login-nativo-pkce.md), [ADR-0036](../adr/0036-gestion-de-sesiones-de-cuenta.md)

## Alcance y límite actual

Este procedimiento se refiere a la pérdida de TOTP/passkeys y a la recuperación de acceso MFA. Actualmente Laural no ofrece TOTP, passkeys ni códigos de recuperación; el runbook **no autoriza** a retirar factores ni a manipular cuentas con los flujos actuales. La recuperación de contraseña es un flujo distinto y no queda implementada por este documento.

No hay endpoint público ni panel web administrativo para retirar factores. La acción, cuando esté implementada, se ejecutará desde un canal administrativo autenticado en el VPS. No se debe hacer una excepción informal a los criterios de este procedimiento.

## Rutas permitidas

### 1. El usuario conserva un código de recuperación

1. El usuario inicia la recuperación desde el flujo oficial y verifica el correo registrado con un PIN de seis dígitos, de un solo uso y cinco minutos de vigencia.
2. El usuario presenta un código de recuperación que Laural emitió al activar MFA. El código también es de un solo uso.
3. El servicio consume el código atómicamente, inicia la reconfiguración de factores y revoca las demás sesiones. El dispositivo usado para recuperar debe completar el nuevo enrolamiento antes de obtener una sesión autenticada.
4. La app confirma el resultado y envía un aviso de seguridad al correo verificado. No incluye códigos, tokens ni factores en el correo.

Un PIN válido sin un código de recuperación **no** completa esta ruta ni retira MFA.

### 2. Se han perdido todos los factores y códigos

1. La persona contacta al administrador por el canal de soporte publicado. El correo registrado solo acredita acceso al buzón mediante el PIN; no demuestra por sí solo la titularidad de los factores perdidos.
2. El administrador abre un caso con identificador aleatorio y registra únicamente categoría, fecha y estado. No solicita ni guarda contraseñas, claves API, códigos de recuperación, semillas TOTP o claves privadas de passkeys.
3. El usuario verifica el correo registrado con el PIN de un solo uso y cinco minutos.
4. El administrador evalúa al menos una prueba de titularidad **preexistente**, obtenida antes de la pérdida y contrastable por una fuente independiente del buzón y de la cuenta Laural. Entre las pruebas que pueden cumplir el criterio están una identidad Google ya vinculada, otro factor MFA aún inscrito o un dispositivo de confianza que conserve una sesión autenticada. La prueba debe corresponder a la cuenta y no depender exclusivamente de información proporcionada dentro del mismo correo o de la cuenta posiblemente comprometida.
5. El administrador decide y registra el resultado. La evaluación y la decisión son criterio del administrador; el PIN, la urgencia o el conocimiento de datos sincronizados no sustituyen la prueba independiente.
6. Solo si la prueba es suficiente, el administrador realiza manualmente la retirada/restablecimiento de los factores desde el VPS por el procedimiento privilegiado que se implemente. La acción revoca todas las sesiones, obliga a configurar factores nuevos y envía un aviso de seguridad al correo verificado.
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

- Implementar TOTP/passkeys, emisión/consumo atómico de códigos, rate limits y flujos de recuperación.
- Implementar el mecanismo administrativo local al VPS con autorización explícita, confirmación y auditoría mínima; nunca una ruta pública para retirar factores.
- Verificar que el PIN solo prueba el buzón, y que no crea sesión ni omite MFA.
- Ensayar PIN vencido/reusado, código incorrecto/reusado, abuso de solicitudes, rechazo por prueba insuficiente, revocación de sesiones, notificación y fallo parcial.
- Probar la restauración del servicio en el VPS y completar su runbook operativo antes de habilitar cuentas externas.
