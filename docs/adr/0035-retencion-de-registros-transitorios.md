# ADR-0035: Retención de registros transitorios del servicio

- **Estado:** Aceptada; limpieza transaccional implementada, validación VPS pendiente
- **Fecha:** 2026-11-21
- **Decisores:** Antonio Moles

## Contexto

Los PINs, flows/códigos PKCE, sesiones revocadas y entradas de idempotencia contienen datos temporales que se acumulaban sin límite en PostgreSQL. Retenerlos indefinidamente aumenta el riesgo de privacidad y el crecimiento de tablas. La limpieza debe conservar durante su ventana los datos necesarios para límites antiabuso, canje PKCE y reintentos seguros de sincronización.

## Decisión

- El servicio ejecuta una limpieza dentro de una transacción al arrancar y después cada hora. Un fallo revierte toda la pasada, registra un mensaje genérico sin datos de usuario y se reintenta en el siguiente intervalo.
- Los PINs/verificadores se borran 15 minutos después de crearse. La ventana preserva el conteo de registros/reenvíos por cuenta, aunque el PIN caduque a los cinco minutos.
- Los flows y códigos PKCE se borran a las 24 horas. El código continúa canjeable solo durante sus dos minutos originales.
- Las sesiones se borran cuando vencen o tienen `revoked_at`; la autenticación las rechaza en cuanto vencen o se revocan, antes de la limpieza física.
- Las claves de idempotencia y su snapshot asociado se borran a los 30 días. Es el máximo de vida de una sesión; una repetición posterior se resolverá mediante revisión/conflicto.
- Cuentas y snapshots de preferencias no se borran en esta tarea.

## Consecuencias

- La base conserva menos datos de autenticación y copias de payload idempotente, con una carga de limpieza acotada y horaria.
- Reintentar una operación idempotente pasados 30 días ya no reproduce su resultado; el cliente debe comparar la revisión y resolver cualquier conflicto.
- La limpieza no es un backup ni protege ante pérdida del VPS. La verificación detrás de Caddy y el tamaño real de tablas quedan pendientes de operación.

## Evidencia

- [Guía del servicio](../../server/README.md)
- [Código de limpieza transaccional](../../server/src/retention.ts)
- Prueba PostgreSQL temporal de limpieza y conservación de registros aún dentro de su ventana, ejecutada por CI.
