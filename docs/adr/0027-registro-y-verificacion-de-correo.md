# ADR-0027: Registro y verificación por correo

- **Estado:** Aceptada; primera fase implementada
- **Fecha:** 2026-11-21
- **Decisores:** Antonio Moles

## Contexto

F3 necesita permitir crear cuentas verificables y usar el proveedor Resend aprobado, sin convertir el PIN de correo en un método de inicio de sesión. El inicio de sesión de escritorio debe continuar por la página HTTPS externa y un código loopback de un solo uso (ADR-0023).

## Decisión

- El primer flujo del servicio permite crear cuenta con nombre, email y contraseña, reenviar PIN y verificar el correo. No emite sesiones y no inicia sesión.
- Se normaliza el email a minúsculas; contraseñas de 12 a 128 caracteres se guardan solo como Argon2id (64 MiB, tres iteraciones, paralelismo 1 y sal aleatoria de 16 bytes).
- El PIN tiene seis dígitos aleatorios, caduca en cinco minutos, permite cinco intentos y se almacena como HMAC-SHA-256 con una clave privada del servidor. Un reenvío consume el PIN anterior.
- Solo se permite un envío por cuenta cada minuto y tres envíos en quince minutos. La existencia de la cuenta o el resultado del PIN no se revela en las respuestas HTTP.
- Resend se consume mediante HTTPS en el backend; API key, remitente y pepper vienen del entorno y nunca se guardan en Git ni en Laural.
- Las rutas de email auth no se registran salvo que `EMAIL_AUTH_ENABLED=true` y los tres secretos requeridos sean válidos. La bandera queda apagada por defecto.

## Consecuencias

- El PIN de email no puede iniciar sesión ni retirar MFA. Un propósito independiente permite cambiar la contraseña y revoca las sesiones activas, sin crear sesión ni alterar factores; el verificador usa un HMAC con separación de propósito. Confirmar el correo tampoco devuelve token ni crea sesión; el login por navegador y el canje PKCE se decidieron después en ADR-0028. Véase ADR-0037.
- Una falla de entrega no revela el estado de cuenta; la persona puede solicitar un reenvío sujeto al límite por cuenta.
- El registro no debe exponerse públicamente aún: los límites persistentes por IP/ruta ya están en el servicio y se prueban en PostgreSQL temporal de CI; faltan validarlos detrás de Caddy, protección anti-abuso coordinado y operación del dominio/remitente Resend.
- Rotar el pepper invalida los PIN pendientes. Los PIN y sus verificadores se conservan como máximo 15 minutos, para mantener la ventana del límite por cuenta, y se eliminan en el barrido horario.

## Evidencia

- [Servicio de sincronización](../../server/README.md)
- [Diseño de sincronización](../designs/sincronizacion-preferencias-y-portabilidad.md)
- [ADR-0023: servicio y autenticación nativa](0023-servicio-de-sincronizacion.md)
