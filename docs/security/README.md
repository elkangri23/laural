# Seguridad y privacidad

Laural recibe instrucciones de usuario y salida de terminal/proyecto, y puede escribir archivos o iniciar comandos. Mantén el modelo de amenazas actualizado cuando cambien las capacidades del agente.

- [Modelo de amenazas](threat-model.md): activos, actores, superficies y mitigaciones.
- [Privacidad y manejo de datos](privacy.md): qué se guarda y cuándo sale del equipo.
- [Reportar vulnerabilidades](../../SECURITY.md).

## Resumen de postura actual

- Las API keys se guardan en el almacén protegido de Windows; perfiles JSON contienen solo metadatos.
- HTTP solo se permite para endpoints de loopback; endpoints remotos requieren HTTPS.
- El usuario decide qué contexto enviar y debe revisar las propuestas del agente.
- Las ediciones de archivo requieren aprobación y se limitan a rutas canónicas dentro del proyecto.
- El agente ejecuta shells con los permisos de la cuenta actual; no existe sandbox.
- Los filtros de riesgo son heurísticos; no deben describirse como una barrera de seguridad completa.
- Los workflows fijan acciones externas a SHA y limitan los tags `v*` a la cuenta administradora; la rama `main` aún no requiere PR ni revisión obligatoria.

## Revisión OWASP por superficie

Usamos el [OWASP Top 10](https://owasp.org/www-project-top-ten/) para orientar la revisión. En Laural se debe revisar el control de acceso en las operaciones Tauri y las rutas del proyecto, la inyección al interpretar comandos, la protección de secretos y transporte al conectar proveedores, y la cadena de suministro al actualizar dependencias o empaquetar. El [modelo de amenazas](threat-model.md) describe los controles y riesgos residuales. El seguimiento de validaciones está en el [backlog](../BACKLOG.md).
