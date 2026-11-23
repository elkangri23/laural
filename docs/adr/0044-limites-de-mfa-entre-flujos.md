# ADR-0044: Límites de intentos MFA compartidos por cuenta

- Estado: aceptada; integración local implementada, despliegue VPS pendiente.
- Fecha: 2026-11-23.

## Contexto

El límite de cinco intentos por flujo no frena intentos distribuidos entre varios flujos de autenticación. Limitar por el correo enviado en el formulario permitiría consumir el contador de una víctima sin demostrar que se conoce su contraseña o passkey.

## Decisión

- Resolver el identificador de cuenta desde el flujo MFA vigente, vinculado a la contraseña o passkey ya verificada, y comprobar que el correo enviado coincide con la cuenta almacenada.
- Compartir un máximo de diez envíos MFA por cuenta durante cinco minutos mediante el limitador PostgreSQL existente. El control cubre TOTP y códigos de recuperación y conserva el límite por IP y los cinco intentos por flujo.
- Consumir el contador antes de verificar cada prueba, después de validar CSRF y la asociación del flujo. Un exceso devuelve `429` y `Retry-After: 300`.
- Guardar únicamente la huella HMAC del identificador de cuenta en el contador; no almacenar el UUID ni aceptar el identificador desde el cliente.

## Alternativas consideradas

- Usar el email del formulario como clave: rechazado porque cualquier persona podría agotar el contador de otra cuenta sin haber superado el primer factor.
- Mantener solo el límite por flujo/IP: rechazado porque abrir flujos nuevos desde distintas IP permite repartir intentos.
- Crear una tabla o contador especializado: no elegido; el limitador PostgreSQL existente ya ofrece contadores atómicos compartidos y huellas HMAC.

## Consecuencias

- El límite distribuido solo se aplica después de demostrar el primer factor y se comparte entre instancias del servicio.
- También cuentan los intentos MFA correctos; una cuenta puede quedar temporalmente limitada si realiza diez desafíos en cinco minutos. El umbral evita llamadas ilimitadas y deberá calibrarse con telemetría operativa sin registrar pruebas ni credenciales.
- El límite no sustituye la validación de IP/proxy detrás de Caddy ni las alertas de producción.

## Referencias

- [ADR-0033: límites persistentes por IP](0033-limites-persistentes-por-ip.md)
- [ADR-0038: fundamentos MFA TOTP](0038-fundamentos-de-mfa-totp.md)
- [Informe de seguridad](../security/audit-report.md)
