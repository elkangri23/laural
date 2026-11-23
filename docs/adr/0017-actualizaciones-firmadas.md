# ADR-0017 — Actualizaciones firmadas desde GitHub

**Estado:** Aceptada  
**Fecha:** 20 de noviembre de 2026

## Contexto

Laural publica instaladores de Windows desde GitHub. El usuario necesita detectar actualizaciones desde la aplicación, elegir entre instalación manual y automática, y verificar que el paquete instalado procede de quien posee la clave privada de publicación.

## Decisión

Usar el plugin oficial `tauri-plugin-updater` de Tauri 2. La app consulta un manifiesto JSON servido desde la rama `main`; cada release de GitHub publica un instalador NSIS x64 y su firma. El workflow copia el manifiesto generado por la acción oficial de Tauri a `updates/latest.json`. El cliente fija únicamente la clave pública. La clave privada se conserva fuera del repositorio y se entrega a GitHub Actions como secreto.

La primera ejecución solicita preferencia: avisar y esperar confirmación, o descargar e instalar automáticamente. La opción manual es la predeterminada si se cierra el diálogo. La app consulta al abrir y cada seis horas. La instalación Windows reinicia Laural. La versión se muestra en **Configuración → Actualizaciones**.

La acción **Buscar ahora** aplica la misma preferencia guardada: el modo automático instala después de descargar; el modo manual deja el paquete preparado y espera la acción **Instalar y reiniciar**.

## Consecuencias

- Las actualizaciones se descargan solo desde URLs HTTPS y la firma criptográfica del paquete se valida antes de instalar.
- La clave privada y su recuperación son críticas. Si se pierde, será necesario distribuir manualmente una nueva versión con otra clave pública.
- Las versiones anteriores a alpha.14 no contienen el plugin updater y deben instalar alpha.14 manualmente una vez.
- El modo automático puede cerrar terminales y procesos abiertos. No hay sincronización ni servidor propio; GitHub sirve los manifiestos e instaladores.
- El updater no reemplaza la firma de código Authenticode ni la validación manual de la cadena de publicación.

## Alternativas consideradas

- Descarga manual desde Releases: no ofrece notificación integrada ni instalación desde la app.
- Instalar paquetes sin firma del updater: no permite comprobar su autenticidad antes de ejecutar el instalador.
- Backend propio: añade cuentas, infraestructura y coste sin aportar valor al flujo local-first de este MVP.
