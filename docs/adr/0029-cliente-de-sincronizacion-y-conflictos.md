# ADR-0029: Cliente de sincronización y resolución de conflictos

- **Estado:** Aceptada
- **Fecha:** 2026-11-21
- **Contexto:** La API privada de snapshots ya ofrece revisiones `ETag`/`If-Match`, idempotencia y un schema de allowlist. La app necesita usarla sin entregar el token de cuenta ni claves de proveedor al WebView.

## Decisión

- La capa Rust lee el token de Credential Manager y realiza llamadas HTTPS al origen fijo del servicio. El frontend recibe solo el snapshot permitido y mensajes de resultado.
- La interfaz inicia una comparación explícita. Si no existe snapshot remoto, ofrece subir la configuración local. Si difieren, presenta únicamente la elección entre conservar este equipo o la nube, sin mostrar un diff por campo.
- Las escrituras usan la revisión que se acaba de leer y una clave aleatoria de idempotencia. Un `412` detiene el reemplazo y requiere volver a comparar.
- Antes de aplicar la nube se guarda la configuración local en un `.laural` dentro de la carpeta de copias existente. Este respaldo del flujo de sync no contiene API keys. La configuración de proveedor se sustituye mediante escritura temporal y atómica.
- Las claves permanecen en Credential Manager. Si un ID remoto apuntaría a un endpoint distinto del local, se genera otro ID para que la clave local no se envíe a un destino nuevo. Aplicar un endpoint compartido desactiva en ese dispositivo el consentimiento para volver a compartirlo.
- Tras una decisión inicial válida, la app intenta enviar después de guardar tema, apariencia, modo de actualización, proveedor o selección activa; también al abrir/iniciar sesión y cada tres horas mientras está abierta.
- Un archivo local atómico guarda solo los últimos snapshots allowlist local y cloud, revisión y bandera pendiente. Se requieren ambas bases porque el consentimiento local para compartir un endpoint puede diferir de que ese endpoint haya sido aceptado desde la nube. Offline conserva el estado pendiente y vuelve a intentar con la configuración local actual.
- El cliente compara la revisión y snapshot cloud con la última línea base aceptada. Solo escribe si no han cambiado; si la nube avanzó, detiene auto-escritura y pide comparar/escoger. No aplica silenciosamente una configuración remota distinta.
- Si el snapshot aceptado de nube contiene un endpoint que este dispositivo no autorizó a compartir, el cliente lo conserva en la base cloud local y lo omite del snapshot propio. Al subir otro cambio, preserva ese endpoint remoto solo para el mismo perfil; no incluye ni propaga un endpoint distinto sin consentimiento explícito.

## Consecuencias

- La sesión nunca cruza IPC al WebView. Al cerrar sesión, el cliente intenta revocarla remotamente y elimina la credencial local incluso si el servidor no responde; la UI comunica el resultado.
- Una elección reemplaza el snapshot completo. No existe fusión por campo ni política de última escritura gana.
- Los IDs de credenciales que dejan de estar en perfiles pueden quedar como credenciales huérfanas en el almacén seguro; esta entrega no las borra ni las sincroniza.
- El cliente requiere que el contrato del API siga respondiendo el snapshot y revisión documentados. El despliegue del VPS y las pruebas reales de reconexión todavía no se han realizado.

## Alternativas descartadas

- Enviar el token o las claves desde React: ampliaría la superficie de exposición y permitiría que el WebView inspeccionara secretos.
- Aplicar automáticamente la copia más reciente: podría descartar cambios del otro equipo sin aviso.
- Fusionar perfiles/campos: los conflictos y la interpretación de endpoints serían ambiguos; se conserva la elección explícita de snapshot completo.
