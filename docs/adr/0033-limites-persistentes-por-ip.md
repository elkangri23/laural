# ADR-0033: Límites persistentes por IP y ruta

- Estado: Aceptada
- Fecha: 2026-11-21
- Decisores: Propietario del proyecto

## Contexto

El servicio expone endpoints de autenticación y snapshots que pueden consumir CPU, correo y consultas de base de datos. Los límites existentes por cuenta y por flujo no protegen los endpoints anónimos ante muchas solicitudes desde una misma red, y un contador en memoria se reiniciaría y divergiría entre instancias.

## Decisión

- Mantener contadores de ventana en PostgreSQL, identificados por ruta y HMAC de IP. La base recibe el pepper desde `RATE_LIMIT_PEPPER`; no se persiste la IP sin procesar.
- Incrementar y reiniciar cada contador con un único `INSERT … ON CONFLICT` atómico para compartir el límite entre procesos.
- Restringir la confianza de Fastify en `X-Forwarded-For` a conexiones desde loopback, donde el Caddy aprobado reenvía tráfico.
- Rechazar el exceso con HTTP 429 y `Retry-After`; si no se puede consultar el contador persistente, no procesar la operación.
- Aplicar límites distintos a login/inicio de flujo, alta y verificación de correo, lectura y escritura de snapshots. Los límites de correo y de intentos por cuenta siguen aplicándose además de estos.
- CI ejecuta las cuatro migraciones y prueba concurrencia entre instancias en PostgreSQL real. El despliegue de cuentas permanece bloqueado hasta validar la IP reenviada y los umbrales detrás de Caddy en el VPS.

## Límites iniciales

| Ruta | Máximo |
| --- | --- |
| Iniciar flujo o login | 10 por minuto y por IP |
| Registrar o reenviar verificación | 3 cada 15 minutos y por IP |
| Verificar PIN o canjear código | 10 por minuto y por IP |
| Leer snapshots | 120 por minuto y por IP |
| Escribir snapshots | 30 por minuto y por IP |

Estos umbrales son valores iniciales a calibrar con telemetría operacional sin IP, correo ni contenido.

## Alternativas consideradas

- **Memoria del proceso:** descartada porque pierde el límite al reiniciar y no coordina varias instancias.
- **Solo límites por cuenta/email:** insuficiente para abuso anónimo, y permite rotar direcciones o crear flujos nuevos.
- **IP reenviada sin restringir proxies confiables:** descartada porque clientes podrían falsificar `X-Forwarded-For`.
- **Servicio Redis externo:** no elegido para la primera versión; PostgreSQL ya forma parte del servicio y ofrece el contador atómico requerido.

## Consecuencias

- El servicio requiere `RATE_LIMIT_PEPPER` (32–256 bytes) y la migración `004_request_rate_limits.sql`.
- Los límites sobreviven reinicios y se comparten entre instancias que usan la misma base de datos.
- El rate limit no evita ataques distribuidos con muchas IP, ni sustituye límites del proveedor de correo, protección DDoS o reglas del VPS.
- Los contadores expirados se depuran periódicamente; hay que vigilar tamaño de tabla y revisar la limpieza en PostgreSQL real.
- No se guardan IP en claro, pero una huella HMAC sigue siendo un identificador pseudónimo sujeto a política de retención.

## Evidencia / enlaces

- [API del servicio](../../server/README.md)
- [Migración de contadores](../../server/migrations/004_request_rate_limits.sql)
- [Hoja de ruta M11](../ROADMAP.md)
- [Auditoría de seguridad](../security/audit-report.md)
