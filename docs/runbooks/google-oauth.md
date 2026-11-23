# Runbook: habilitar el acceso con Google

- **Estado:** código local y pruebas PostgreSQL completos; aún no hay credenciales ni despliegue en VPS.
- **Responsable:** administrador de Google Cloud y del VPS.
- **Relacionado:** [ADR-0047](../adr/0047-login-con-google-oauth.md), [UC-28](../use-cases/google-oauth.md), [README del servicio](../../server/README.md).

## Antes de empezar

- Confirma que el servicio y su dominio HTTPS están desplegados y que `/auth/google/callback` llega a Fastify a través de Caddy.
- Configura y valida primero Resend y las variables exigidas por `EMAIL_AUTH_ENABLED=true`. Google depende de la autenticación de cuentas por correo habilitada.
- Aplica las migraciones del servidor hasta `011_google_oauth.sql` con el procedimiento de despliegue y verifica que `schema_migrations` registra la 011.
- Decide el nombre y correo de soporte que aparecerán en la pantalla de consentimiento. No uses datos de prueba en producción.

## Crear las credenciales

1. En Google Cloud Console, selecciona o crea el proyecto de identidad de Laural y configura la pantalla de consentimiento para el público previsto. Para las primeras comprobaciones, mantenla en modo de prueba y añade solo las cuentas de prueba necesarias.
2. Crea un cliente OAuth de tipo **Aplicación web**.
3. Registra como URI de redirección autorizada exactamente:

   `https://sync.laurafernandezenfermeria.com/auth/google/callback`

   El esquema, host, ruta y barra final deben coincidir exactamente con `GOOGLE_OAUTH_REDIRECT_URI`; Google rechaza un URI distinto.
4. No habilites APIs de Google ni añadas scopes de perfil, Drive u otros datos. Laural solicita únicamente `openid email`.
5. Guarda el ID y el secreto del cliente en el gestor de secretos del VPS o en el archivo de entorno privado que use el servicio, con permisos de lectura solo para su usuario de sistema. No los pegues en Git, issues, registros, capturas ni este chat.

## Configurar y activar

Configura en el entorno privado del servicio:

```dotenv
GOOGLE_OAUTH_CLIENT_ID=<id-del-cliente-web>
GOOGLE_OAUTH_CLIENT_SECRET=<secreto-del-cliente-web>
GOOGLE_OAUTH_REDIRECT_URI=https://sync.laurafernandezenfermeria.com/auth/google/callback
GOOGLE_OAUTH_ENABLED=false
```

1. Compila el servicio y ejecuta `npm run migrate` contra la base PostgreSQL de destino.
2. Reinicia el servicio con `GOOGLE_OAUTH_ENABLED=false` y comprueba `/health/ready`, el login actual por email y la página `/status`.
3. Habilita el flag, reinicia el servicio y verifica que la página de acceso de Laural ofrece «Continuar con Google».
4. No habilites el registro externo general hasta que el flujo real haya pasado la lista siguiente y el operador haya actualizado el status público.

## Pruebas de aceptación

- [ ] Una cuenta Google de prueba puede crear una cuenta Laural y volver a la aplicación por el callback loopback existente.
- [ ] En un segundo flujo, el mismo `sub` vuelve a la misma cuenta sin crear identidades duplicadas.
- [ ] Un correo Google verificado que coincide con una cuenta Laural existente la vincula; una cuenta Laural con correo sin verificar no se vincula.
- [ ] Una cuenta con TOTP sigue solicitando el segundo factor tras el login Google.
- [ ] Cancelar el consentimiento, usar un `state` repetido o alterado, presentar un correo sin verificar y enviar un callback vencido no crean sesión.
- [ ] La sesión se canjea con el flujo PKCE de Laural y se guarda en Credential Manager; no aparecen tokens de Google en PostgreSQL, logs ni cliente.
- [ ] El proxy no guarda query strings del callback; la aplicación no registra códigos OAuth ni tokens.
- [ ] Los avisos de Resend llegan al buzón de prueba y los límites del servicio se comparten por IP.

## Reversión

Ante un error, fija `GOOGLE_OAUTH_ENABLED=false` y reinicia el servicio. Los usuarios podrán seguir usando los métodos existentes. No borres `account_identities` ni la migración: el flag oculta el botón y detiene el flujo sin eliminar las cuentas vinculadas. Si el secreto se expone, revócalo y crea un cliente nuevo en Google Cloud antes de reactivar.

## Referencias oficiales

- [OAuth 2.0 para aplicaciones web de servidor](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Verificación de aplicaciones OAuth](https://support.google.com/cloud/answer/13461325)
- [Audiencia y modo de prueba](https://support.google.com/cloud/answer/15549945)
