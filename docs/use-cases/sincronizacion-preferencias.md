# Casos de uso: portabilidad y sincronización

- **Estado:** UC-17/18 tienen una implementación inicial; login Tauri, revocación de sesiones y cliente manual/automático están implementados. Pendientes pruebas de reconexión, sondeo real y VPS. TOTP, challenge, códigos y cola transaccional de avisos están integrados localmente; UC-21 conserva pendiente la recuperación administrativa tras perder todos los factores. UC-22 tiene sitio y contrato local estático, con operación VPS pendiente. UC-25 implementa restablecimiento de contraseña con PIN, aún sin despliegue VPS/Resend.
- **Especificación:** [plan de sincronización](../plans/sincronizacion-preferencias.md).
- **Diseño técnico:** [diseño formal](../designs/sincronizacion-preferencias-y-portabilidad.md).

## UC-17 — Exportar/importar perfil sin cuenta

**Actor:** usuario de Laural.

**Precondición:** Laural tiene configuración local; no se requiere red ni cuenta.

**Flujo:** la persona exporta preferencias/perfiles sin claves, importa el archivo en otro equipo, revisa la vista previa y elige fusionar o reemplazar.

**Aceptación:** el formato versionado se valida antes de escribir; las copias se crean antes de reemplazar; errores/corrupción no dejan una importación parcial; las claves siguen en Credential Manager.

## UC-18 — Transferir claves con un archivo protegido

**Actor:** usuario de Laural.

**Precondición:** existe una clave guardada para un perfil.

**Flujo:** la persona activa **Incluir claves**, establece contraseña, exporta y luego introduce la contraseña al importar el archivo.

**Aceptación:** sin contraseña no hay claves en el archivo; cifrado autenticado con parámetros acotados; claves descifradas solo en memoria y escritas directamente a Credential Manager; el reemplazo de varias credenciales se revierte si falla.

## UC-19 — Iniciar sesión y preparar la cuenta

**Actor:** usuario con una cuenta.

**Precondición:** cuenta verificada, servicio publicado/habilitado y preferencias locales.

**Flujo:** desde Configuración → Cuenta y sincronización, Laural abre el navegador externo. Tras autenticarse, el navegador redirige al listener local de un solo uso; Rust valida `state`, canjea el código con PKCE y guarda el token en Credential Manager. El panel no recibe el token.

**Aceptación:** redirect limitado a loopback, código de un solo uso, `state` validado, canje HTTPS y PKCE; token ausente del WebView y guardado en Credential Manager. Al quitar la cuenta, Laural intenta revocar la sesión actual y borra siempre el token local; si no obtiene confirmación, avisa que la sesión remota podría seguir válida hasta caducar. Ningún secreto de proveedor se envía.

## UC-20 — Sincronizar, desconectarse y resolver conflicto

**Actor:** usuario con sync habilitado en uno o más dispositivos.

**Flujo implementado inicialmente:** la persona pulsa **Sincronizar ahora** para la primera carga/comparación. Tras fijar una línea base, los cambios guardados intentan subir en segundo plano; Laural revisa al abrir/iniciar sesión y cada tres horas. El cliente persiste la línea base/revisión y un indicador pendiente. Sin conexión conserva cambios locales y reintenta; si la revisión remota avanzó, detiene la escritura y presenta la elección sin diff. Al aplicar nube Rust vuelve a validar la revisión y crea antes una copia `.laural` sin claves.

**Pendiente:** ensayar desconexión/reconexión, suspensión/reanudación, conflicto concurrente y despliegue real del VPS en Windows.

**Aceptación:** escritura condicional e idempotente; no hay «última escritura gana» silenciosa; no se muestran diferencias por campo; la copia recuperable se crea antes de reemplazar; un schema futuro/corrupto no se trata como nube vacía.

## UC-21 — Recuperar cuenta tras perder factores

**Actor:** titular de cuenta y administrador del servicio.

**Flujo:** al activar MFA, Laural ofrece códigos de recuperación de un solo uso. Si se pierden los factores, el titular usa una recuperación disponible o solicita revisión administrativa. El PIN de correo de seis dígitos, un solo uso y cinco minutos demuestra control del buzón; no autentica ni elimina MFA.

**Aceptación:** el administrador requiere el PIN y una prueba independiente preexistente: código de recuperación válido, otro factor inscrito, identidad Google vinculada o dispositivo que mantenga sesión autenticada. Si no queda ninguna, se deniega la retirada y se indica crear una cuenta nueva. Al aprobar se revocan sesiones, se retiran solo los factores perdidos, se avisa al correo registrado y se guarda la categoría de evidencia/decisión, nunca su contenido. El PIN solo jamás inicia sesión ni retira MFA.

## UC-22 — Consultar estado público

**Actor:** visitante sin cuenta.

**Flujo:** abre `https://sync.laurafernandezenfermeria.com/status` para consultar salud general, incidentes, acciones en curso y ventanas de mantenimiento.

**Aceptación:** no requiere autenticación; no muestra usuarios, logs, IPs, claves ni diagnósticos internos; si no puede verificar disponibilidad muestra estado desconocido/último chequeo. La página estática sobrevive a una caída de API/DB, pero no a una caída completa del VPS/red.

## UC-25 — Restablecer contraseña mediante PIN

**Actor:** titular de una cuenta verificada.

**Flujo:** solicita el restablecimiento con su correo; Laural responde igual exista o no la cuenta. Si existe, recibe un PIN de seis dígitos válido cinco minutos. Introduce el PIN y una contraseña nueva de 12 a 128 caracteres.

**Aceptación:** el PIN tiene HMAC separado por propósito, cinco intentos, un solo uso y límites por cuenta/IP. PIN incorrecto o cuenta inexistente no inicia sesión. Al cambiar la contraseña se revocan todas las sesiones activas; no se crea sesión ni se retiran/cambian factores MFA. Resend y PostgreSQL reales requieren despliegue/validación antes de habilitar la ruta públicamente.

## UC-26 — Recibir aviso al cambiar un factor de seguridad

**Actor:** titular de una cuenta verificada con TOTP.

**Flujo:** tras confirmar la activación o desactivación de TOTP, o confirmar la rotación de códigos de recuperación, el servicio guarda el evento en PostgreSQL junto al cambio. Un trabajador lo entrega al correo verificado mediante Resend; ante fallos temporales, reintenta con una clave idempotente.

**Aceptación:** no se envía antes de confirmar la operación; el mensaje no contiene códigos de recuperación, IP, ubicación ni datos del dispositivo. Tras ocho fallos el evento queda abandonado y los resultados terminales se eliminan tras 30 días. Entrega y alertas reales en VPS siguen pendientes.
