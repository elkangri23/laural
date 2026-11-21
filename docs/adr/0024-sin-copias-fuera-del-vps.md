# ADR-0024: No mantener copias de sincronización fuera del VPS

- **Estado:** Aceptada
- **Fecha:** 2026-11-21
- **Decisor:** Antonio Moles

## Contexto

El servicio opcional de sincronización guardará cuentas y snapshots de preferencias en el VPS del proyecto. Una copia externa mejoraría la recuperación ante la pérdida del host, pero añade coste, infraestructura, credenciales, mantenimiento y otra ubicación con datos de usuario. El propietario ha decidido no mantener copias fuera del VPS.

## Decisión

- No enviar backups de la base de datos ni copias de los snapshots a almacenamiento fuera del VPS.
- No prometer recuperación si el VPS, sus discos o el acceso a la cuenta del proveedor se pierden por completo.
- Mantener la app local-first y la sincronización opcional. La configuración local sigue disponible aunque el servicio falle.
- Antes de habilitar sincronización, explicar en la interfaz que un fallo total del VPS puede causar la pérdida permanente de cuentas y preferencias cloud.
- La posible creación de una copia de PostgreSQL dentro del mismo VPS queda por decidir. Si se implementa, documentar su propósito y retención; no describirla como protección ante pérdida del host.

## Alternativas consideradas

- **Copia cifrada en almacenamiento externo:** ofrece recuperación ante fallo del host, pero requiere otra ubicación, claves, tareas de mantenimiento y controles de borrado. Rechazada por el propietario.
- **Ninguna copia en absoluto:** no añade recuperación ante errores lógicos u operativos. No se decide aquí; el propietario solo ha descartado ubicaciones fuera del VPS.

## Consecuencias

- Una avería o compromiso total del VPS puede destruir permanentemente los datos de sync y las cuentas.
- El servicio tiene disponibilidad y recuperación de datos limitadas; la página `/status` alojada en el mismo VPS tampoco estará disponible durante una caída completa.
- Los clientes deben conservar una copia local de su configuración; la sync no puede convertirse en su única copia. Exportar/importar localmente seguirá siendo una función aparte, todavía pendiente.
- No se crea un objetivo de RPO/RTO ni se afirma que haya un procedimiento de restauración tras desastre.

## Referencias

- [ADR-0023: arquitectura del servicio de preferencias](0023-servicio-de-sincronizacion.md)
- [Diseño de sincronización y portabilidad](../designs/sincronizacion-preferencias-y-portabilidad.md)
