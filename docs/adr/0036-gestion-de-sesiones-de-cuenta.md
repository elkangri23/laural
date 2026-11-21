# ADR-0036: Consultar y revocar sesiones de la cuenta

- **Estado:** Aceptada; API, cliente y pruebas implementados; validación en VPS pendiente
- **Fecha:** 2026-11-21
- **Decisores:** Antonio Moles

## Contexto

La cuenta puede permanecer iniciada en varios equipos durante 30 días. Cerrar sesión local revoca únicamente el token de ese equipo, por lo que se necesita una forma de detectar y retirar accesos de otros dispositivos.

## Decisión

- La API autenticada lista como máximo las 100 sesiones activas más recientes de la cuenta. Devuelve un UUID opaco, fechas de creación y vencimiento, y un indicador de sesión actual. No devuelve IP, ubicación, nombres de dispositivo ni hashes/tokens.
- La UI denomina las sesiones ajenas «Otro inicio de sesión»: el servidor no tiene telemetría de dispositivo que justifique identificar un equipo concreto.
- La persona puede revocar una sesión individual distinta del bearer actual. El servidor limita la operación a la cuenta autenticada, sesión activa y no expirada; una sesión actual no se puede revocar desde esta ruta.
- La persona también puede revocar en una acción todas las sesiones ajenas, incluso las que queden fuera de la lista. La operación devuelve cuántas revocó y conserva la sesión actual.
- Los endpoints tienen límites persistentes por IP/ruta. La lista usa 20 solicitudes por minuto; la revocación individual, 10 por minuto; la revocación conjunta, 5 por minuto.
- La app usa HTTPS, no sigue redirecciones y conserva el token solo en Credential Manager. La acción requiere confirmación en la UI y refresca la lista tras éxito.

## Consecuencias

- Un dispositivo revocado no podrá volver a sincronizar y tendrá que iniciar sesión otra vez.
- La revocación conjunta permite recuperar control aunque la cuenta tenga más de 100 sesiones.
- La lista informa fechas, no identifica dispositivos ni registra IP/ubicación; esto reduce datos personales y evita una atribución falsa.
- El endpoint y el cliente están implementados, pero su comportamiento detrás de Caddy/VPS y en una instalación Windows aún requiere validación real.

## Evidencia

- [Contrato OpenAPI](../../server/openapi.yaml)
- [API de cuenta](../../server/README.md)
- [ADR-0034: cierre de sesión](0034-revocacion-de-sesion-al-cerrar-sesion.md)
