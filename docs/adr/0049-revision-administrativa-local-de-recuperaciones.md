# ADR-0049: Revisión administrativa local de recuperaciones

- Estado: aceptada; consulta y registro de decisión implementados; ejecución del restablecimiento de factores pendiente.
- Fecha: 2026-11-23

## Contexto

La solicitud verificada por email necesita una revisión humana. No debe exponerse una consola web ni una ruta pública con privilegios para ver casos o retirar MFA. El administrador eligió ser quien toma la decisión y la evidencia debe ser independiente del buzón.

## Decisión

- Añadir una herramienta CLI de solo gestión local, disponible en Linux y ejecutable como root mediante `sudo`; registra como operador el usuario que lanzó `sudo`.
- `list` muestra como máximo 100 casos con buzón verificado y aún sin decisión. Escapa caracteres de control al imprimir correo en terminal.
- `decide` exige repetir el UUID del caso para confirmar. Solo opera en casos verificados no revisados y compara/actualiza en una sola sentencia SQL, evitando decisiones duplicadas.
- Registrar únicamente resultado, categoría de evidencia, usuario operador y hora UTC. No almacenar el material de prueba, PIN, secretos MFA ni texto libre.
- Una aprobación requiere categoría de evidencia independiente (`google_identity`, `existing_mfa`, `trusted_session` u `other_independent`). Una denegación puede registrar `insufficient`.
- La decisión no borra factores, crea sesiones, altera contraseña ni habilita login. El mecanismo de sustitución segura de factores y reautenticación queda pendiente; no se habilita recuperación de cuentas externas.

## Consecuencias y límites

- `sudo` y el acceso al VPS son el límite de autorización. La herramienta no añade una credencial administrativa de aplicación ni abre un puerto.
- Los registros se guardan en el mismo caso PostgreSQL, en campos acotados y sin evidencia. Se eliminan al borrar la cuenta o tras el periodo de retención del caso.
- La etiqueta de evidencia es una declaración del administrador, no una comprobación automática. La evaluación sigue siendo criterio del administrador conforme al runbook.
- La aprobación no ejecuta la recuperación: hace falta diseñar, implementar y ensayar el flujo de sustitución de factor sin conceder acceso a preferencias/sincronización antes de completar el alta.

## Verificación

- Integración PostgreSQL verifica cola pendiente, aprobación con evidencia independiente, rechazo de aprobación con `insufficient`, decisión de un solo uso e invariancia de sesiones y factores. CLI: 93,33 % de líneas; capa de decisión: 100 % de líneas. Suite de servicio: 173/173 pruebas, 89,88 % de líneas y 80,21 % de ramas.
- La CLI debe probarse en el VPS bajo `sudo` antes de habilitar solicitudes de usuarios.

## Referencias

- [ADR-0048: solicitud de revisión](0048-solicitud-segura-de-recuperacion.md)
- [Runbook de recuperación](../runbooks/recuperacion-cuenta.md)
