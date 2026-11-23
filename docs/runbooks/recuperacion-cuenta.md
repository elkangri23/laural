# Runbook: recuperación de cuenta y factores

- **Estado:** solicitud, revisión local y reenrolamiento restringido implementados; ensayo de Resend y VPS pendiente.
- **Propietario:** administrador del servicio
- **Aprobación de política:** el propietario de Laural
- **Relacionado:** [ADR-0023](../adr/0023-servicio-de-sincronizacion.md), [ADR-0027](../adr/0027-registro-y-verificacion-de-correo.md), [ADR-0028](../adr/0028-login-nativo-pkce.md), [ADR-0036](../adr/0036-gestion-de-sesiones-de-cuenta.md), [ADR-0042](../adr/0042-passkeys-para-cuentas.md), [ADR-0047](../adr/0047-login-con-google-oauth.md), [ADR-0048](../adr/0048-solicitud-segura-de-recuperacion.md), [ADR-0049](../adr/0049-revision-administrativa-local-de-recuperaciones.md), [ADR-0050](../adr/0050-reenrolamiento-seguro-tras-recuperacion.md)

## Alcance y límite actual

Este procedimiento se refiere a la pérdida de TOTP/códigos y a la recuperación de acceso MFA. TOTP, códigos de recuperación, passkeys passwordless, Google OIDC y el flujo de recuperación están implementados localmente detrás de flags; la autenticación permanece desactivada por defecto y no está desplegada. El administrador no modifica factores directamente en PostgreSQL. La recuperación de contraseña es un flujo distinto.

No hay endpoint público ni panel web administrativo para revisar casos o retirar factores. La CLI local lista casos y registra la decisión con `sudo`; la aprobación envía un ticket temporal que solo permite iniciar el enrolamiento de un TOTP nuevo.

## Rutas permitidas

### 1. El usuario conserva un código de recuperación

1. El usuario inicia sesión con correo/contraseña y presenta un código de recuperación cuando el flujo solicita el segundo factor. El código es de un solo uso y se consume atómicamente.
2. Si el login termina correctamente, el usuario obtiene una sesión normal. El código no inicia por sí solo una retirada de MFA ni revoca automáticamente las demás sesiones.
3. Desde una sesión reciente, el usuario puede administrar TOTP y rotar sus códigos en Configuración. Debe guardar y confirmar los códigos nuevos antes de que reemplacen los anteriores. Desactivar TOTP requiere una sesión reciente y envía un aviso de seguridad cuando el servicio de correo está habilitado.

Un PIN válido sin TOTP/código válido **no** completa el login, no crea una sesión y no retira MFA.

### 2. Se han perdido todos los factores y códigos

1. La persona contacta al administrador por el canal de soporte publicado. El correo registrado solo acredita acceso al buzón mediante el PIN; no demuestra por sí solo la titularidad de los factores perdidos.
2. Con el flujo opcional habilitado, la persona solicita revisión desde la página de acceso. La respuesta es genérica. El servicio limita los envíos y guarda solo HMAC del PIN. Al verificar el buzón con un PIN de un solo uso y cinco minutos, marca el caso como verificado y encola el aviso administrativo con reintentos.
3. El administrador localiza el caso con `sudo npm run admin:recovery -- list`. La salida contiene identificador, correo y fechas; no contiene el PIN. La herramienta solo funciona en Linux bajo `sudo` y no abre una ruta de red.
4. El administrador evalúa al menos una prueba de titularidad **preexistente**, obtenida antes de la pérdida y contrastable por una fuente independiente del buzón y de la cuenta Laural. Entre las pruebas que pueden cumplir el criterio están una identidad Google ya vinculada, otro factor MFA aún inscrito o un dispositivo de confianza que conserve una sesión autenticada. La prueba debe corresponder a la cuenta y no depender exclusivamente de información proporcionada dentro del mismo correo o de la cuenta posiblemente comprometida. No copies ni guardes el material probatorio en el servicio.
5. Registra la decisión y solo la categoría de evidencia. Para aprobar, repite el UUID en confirmación: `sudo npm run admin:recovery -- decide <id-caso> approved <google_identity|existing_mfa|trusted_session|other_independent> <id-caso>`. Para denegar por evidencia insuficiente: `sudo npm run admin:recovery -- decide <id-caso> denied insufficient <id-caso>`. La evaluación y la decisión son criterio del administrador; el PIN, la urgencia o el conocimiento de datos sincronizados no sustituyen la prueba independiente.
6. Al aprobar, la CLI registra la decisión y encola un enlace de un solo uso válido 30 minutos. El enlace se envía al correo verificado y no crea una sesión. La persona lo abre, registra un TOTP y confirma un código válido dentro de 15 minutos y cinco intentos. Si el correo falla, el trabajador reintenta hasta ocho veces; si el enlace vence o se consume sin completar el alta, el usuario debe iniciar una solicitud nueva y el administrador revisarla de nuevo.
7. Solo tras verificar el TOTP nuevo, la transacción sustituye el TOTP y los códigos anteriores, elimina las passkeys previas, revoca las sesiones activas, invalida códigos/flujos de login pendientes y registra el caso como completado. Se encolan los códigos nuevos para mostrarlos una sola vez y un aviso de seguridad al correo. No se crea una sesión ni se exponen preferencias.
8. La persona guarda los códigos nuevos e inicia sesión desde la aplicación con su contraseña y el TOTP recién inscrito. La administración no recibe ni conserva el secreto TOTP ni los códigos.
9. Si no existe una prueba independiente suficiente, el administrador **deniega** la solicitud. No se reduce la cuenta a autenticación solo por correo y no se crea un bypass alternativo.

## Registro y privacidad

Conservar únicamente: ID de caso, cuenta interna, categoría de prueba (no su contenido), administrador que decidió, decisión, fecha/hora y estado de finalización. No incluir contraseñas, PIN, ticket, códigos, secretos MFA, contenido de documentos ni copias de evidencias en logs o tickets. El ticket solo se guarda cifrado hasta entrega/consumo/caducidad; el digest permanece hasta la retención del caso. Los registros terminales del outbox se purgan tras 30 días y los casos cerrados tras 90 días.

La app no sincroniza factores MFA ni códigos de recuperación. El operador del VPS puede leer los snapshots permitidos; este procedimiento no cambia esa limitación ni crea copias externas de datos.

## Lista de comprobación antes de cerrar un caso

- [ ] La persona confirmó el buzón mediante un PIN vigente y no reutilizado.
- [ ] Hay código de recuperación válido, o el administrador verificó prueba preexistente por fuente independiente.
- [ ] Se registró decisión y categoría, sin guardar el material probatorio.
- [ ] Se confirmó el TOTP nuevo y se mostraron los códigos de recuperación una sola vez.
- [ ] Las demás sesiones quedaron revocadas.
- [ ] Se invalidaron los códigos de login pendientes y se completó el caso.
- [ ] La persona inició un login normal con contraseña y el nuevo TOTP; no recibió una sesión por el enlace de recuperación.
- [ ] Se envió aviso de seguridad sin incluir secretos.
- [ ] El caso no dejó credenciales, códigos ni evidencias en logs/tickets.

## No operar hasta completar

- Mantener la autenticación y `ACCOUNT_RECOVERY_ENABLED` desactivados hasta validar el despliegue, Resend, TOTP/códigos y sus límites.
- El flujo está implementado localmente, pero antes de habilitarlo: configurar `ACCOUNT_RECOVERY_BASE_URL=https://<dominio>/auth/recovery`, validar HTTPS/cabeceras/cookies/CSP tras Caddy, migrar el schema, probar envío y reintentos de Resend y realizar el ciclo completo con una cuenta de ensayo. No exponer controles administrativos como API pública.
- Verificar que el PIN solo prueba el buzón, y que no crea sesión ni omite MFA.
- Ensayar PIN y ticket vencidos/reusados, TOTP incorrecto/reusado, máximo de intentos, abuso de solicitudes, rechazo por evidencia insuficiente, reintentos/outbox de Resend, revocación de sesiones, invalidación de códigos pendientes y aviso de seguridad.
- Probar la restauración del servicio en el VPS y completar su runbook operativo antes de habilitar cuentas externas.
- El flujo de recuperación invalida passkeys anteriores después de confirmar el TOTP nuevo; ensayar este resultado antes de habilitar passkeys.
