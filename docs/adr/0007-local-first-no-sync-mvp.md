# ADR-0007: Sin cuentas ni sincronización en el MVP

- Estado: Aceptada
- Fecha: 2026-11-19
- Decisores: Laural contributors

## Contexto

Laural debe funcionar en local sin registro ni servicio propio. La sincronización de configuración y perfiles se ha pedido como posibilidad futura, no como requisito de la primera entrega.

## Decisión

La primera versión guarda perfiles y políticas localmente. No implementa login, backend, telemetría ni sincronización entre equipos.

## Alternativas consideradas

- Añadir backend de usuario y sincronización en el MVP: aumenta coste operativo y desplaza el esfuerzo de terminal, chat y agente.
- Sincronizar JSON mediante almacenamiento de terceros: no ofrece resolución de conflictos, control de acceso ni protección apropiada de secretos sin diseño adicional.

## Consecuencias

- No hay recuperación remota si el usuario pierde la configuración local.
- La sincronización futura requerirá definir conflictos, cifrado, exportación, revocación, dispositivos y manejo de claves.
- Las credenciales permanecen solo en el almacén protegido del dispositivo.
