# ADR-0032 — Página pública de estado del servicio

- **Estado:** Aceptada.
- **Fecha:** 2026-11-21.
- **Contexto:** Las personas necesitan consultar si la sincronización está operativa y leer avisos de incidencias/mantenimiento. El propietario ha elegido servir la página en el mismo VPS que el servicio.

## Decisión

- Caddy sirve `/status`, `/status.css`, `/status.js` y `/status.json` sin autenticación, desde archivos estáticos separados del proceso API. El resto de las rutas se reenvía a Fastify.
- El documento JSON tiene schema cerrado, máximo 16 KiB, estado limitado a cuatro valores, resumen acotado y hasta ocho avisos con tipo/título/mensaje/fecha. El frontend muestra estado desconocido si no puede leer/interpretar el documento y no expone errores internos.
- La administración se hace por SSH y usa `npm run status:publish -- <archivo-status.json>` en Linux. El comando valida el schema allowlist y el límite de tamaño, escribe un temporal en el mismo directorio, sincroniza el contenido y lo reemplaza atómicamente en `/var/lib/laural/status/status.json`; no existe escritura HTTP ni panel administrativo.
- La interfaz renderiza texto con `textContent`, usa assets del mismo origen, CSP local, respuesta `no-store` y consulta cada minuto.
- No se publican telemetría, número de usuarios, logs, IPs, rutas privadas, secretos ni diagnósticos internos.
- La página, servicio y snapshots viven en el mismo VPS. La caída completa del host también deja inaccesible el estado; no se añade proveedor externo ni copia de desastre.

## Consecuencias

- La implementación local no prueba la disponibilidad real del VPS ni la del proveedor de correo.
- Durante despliegue debe configurarse el documento fuera del directorio de releases, con permisos de solo lectura para Caddy y escritura administrativa.
- El publicador fija el archivo con modo público de solo lectura (`0644`); el directorio debe reservar la escritura al administrador y permitir lectura/travesía a Caddy.
- `unknown` es el estado por defecto hasta que el administrador publique información actualizada; no se afirma disponibilidad sin confirmación.

## Alternativas descartadas

- Alojar la página en un proveedor separado: el propietario pidió el mismo VPS.
- Administrar avisos por una ruta web: ampliaría la superficie de ataque y requeriría autenticación/roles; SSH es suficiente para esta primera fase.
- Mostrar métricas técnicas detalladas: puede revelar información operativa y no es necesaria para comunicar estado general.
