# Plan propuesto: perfiles, exportación y sincronización

- Estado: propuesta; no implementado ni aprobado como cambio de alcance.
- Fecha: 2026-11-21
- Alcance: preferencias de Laural y metadatos de perfiles de proveedor.
- Fuera de alcance: sincronizar claves API, conversaciones, historial de terminal, proyectos o comandos ejecutados.

## Entendimiento del producto

Laural conservará dos formas independientes de mover o compartir configuración:

1. **Perfil local y exportar/importar:** no requiere cuenta ni conexión con un servicio de Laural. La app crea un perfil local llamado **Usuario desconocido**; el nombre es una etiqueta editable, no una identidad verificada. La persona exporta un archivo e importa ese archivo en otro equipo. Puede elegir si incluye claves API.
2. **Cuenta y sincronización:** requiere iniciar sesión y activar la sincronización. La cuenta puede usar nombre, correo y contraseña; también se podrá autenticar con Google, passkeys y un segundo factor. La configuración se sube al servicio de Laural y se recupera en otros equipos. Las claves API nunca forman parte de este flujo.

El nombre **perfil de Laural** designa un conjunto de preferencias y perfiles de proveedor. **Cuenta** designa la identidad autenticada del servicio de sincronización. Un perfil local no crea una cuenta ni transmite datos.

## Alcance de datos

| Dato | Solo local | Exportar/importar | Sincronizar con cuenta |
| --- | --- | --- | --- |
| Tema, modo claro/oscuro y preferencias de interfaz | Sí | Sí | Sí |
| Preferencia de actualización | Sí | Sí | Sí |
| Nombre, tipo, modelo y endpoint de perfiles de proveedor | Sí | Sí | Sí, con confirmación para endpoints personalizados |
| Proveedor activo | Sí | Sí | Sí |
| Claves API de proveedores | Credential Manager | Opcional, solo por acción explícita | **Nunca** |
| Contraseña, tokens de sesión, credenciales de Google y passkeys | Almacén seguro apropiado | **Nunca** | **Nunca como datos de configuración** |
| Modo y reglas del agente | Sí | Sí | Desactivado por defecto; sincronización opcional y separada |
| Historial de chat/terminal, prompts, proyectos, rutas locales y actividad | Sí, cuando exista | **No** | **No** |

Los endpoints pueden incluir nombres de host privados. La interfaz de sincronización mostrará cuáles se van a subir, permitirá excluirlos y explicará que `localhost` se refiere al equipo donde se usa. Para perfiles Ollama y LM Studio se recomienda guardar el tipo y reconstruir el endpoint local predeterminado en el dispositivo receptor; los endpoints personalizados requieren confirmación.

Las reglas y el modo automático del agente pueden ampliar permisos en otro equipo. Por eso, la sincronización general no los activará por defecto: la persona podrá sincronizar esas políticas con una opción separada y una advertencia. En un dispositivo nuevo, el modo inicial será **Confirmar cada comando**.

## Flujo A: perfil local y archivo de exportación

### Exportar

1. La persona elige **Exportar configuración** y ve el resumen de preferencias, perfiles y campos que contendría el archivo.
2. Por defecto, se excluyen las claves API. Una casilla independiente permite incluirlas.
3. Si se incluyen claves, la app recomienda cifrar el archivo con una contraseña de exportación que no se reutiliza automáticamente desde la cuenta.
4. El producto solicitado contempla exportación con y sin contraseña. La opción sin contraseña se marcará claramente como **archivo sin cifrar**, requerirá una confirmación adicional y no se describirá como segura para correo, almacenamiento compartido o repositorios.
5. El formato lleva versión de esquema, límites de tamaño y tipos de dato permitidos. Será un documento de Laural, no un ZIP que extraiga rutas arbitrarias.

Cuando se use contraseña, se derivará la clave de cifrado con Argon2id y sal aleatoria; el contenido se cifrará con un modo autenticado como AES-256-GCM y nonce único. El archivo incluirá los parámetros necesarios para descifrar y verificar integridad, pero no la contraseña. Se usarán bibliotecas mantenidas, aleatoriedad del sistema y pruebas de vectores conocidos; no se diseñará criptografía propia. OWASP recomienda modos autenticados como GCM. Para contraseñas de cuentas, la guía de OWASP propone como mínimo Argon2id con 19 MiB, dos iteraciones y paralelismo 1; se medirá su coste en Windows antes de fijar los parámetros de producción.

### Importar

1. La app detecta la versión, valida el esquema y, si corresponde, pide la contraseña del archivo.
2. Presenta una vista previa con las preferencias, perfiles, endpoints y si hay claves dentro del archivo.
3. Permite **fusionar** o **reemplazar**. La fusión conserva ajustes locales que no estén en la copia; el reemplazo pide confirmación y crea una copia local previa.
4. Si un perfil trae clave, Laural comprueba que el endpoint normalizado coincide con el perfil al que se asociará. La clave se escribe directamente en Windows Credential Manager; nunca en `providers.json`, logs, mensajes de error o telemetría.
5. Los archivos corruptos, alterados, demasiado grandes, con campos desconocidos críticos o con versiones incompatibles se rechazan sin modificar la configuración.

La importación de un archivo sin contraseña que contenga claves es compatible con lo pedido, pero la app avisará que cualquiera que lea el archivo podrá leerlas. Tras importarlas, se recomienda borrar el archivo o guardarlo en un medio protegido.

## Flujo B: cuenta y sincronización

### Cuenta y métodos de acceso

- Registro con nombre visible, correo y contraseña; el correo debe verificarse antes de habilitar la sincronización.
- Contraseñas almacenadas solo como hashes Argon2id con sal individual; nunca se recuperan ni se guardan en texto claro. Se aplicarán límites de intentos, protección ante enumeración de cuentas, restablecimiento con token de un solo uso y avisos de seguridad.
- **Google:** inicio mediante OpenID Connect. La app de escritorio abrirá el navegador predeterminado, usará Authorization Code con PKCE y retorno loopback local; el backend validará el ID token. No se pedirá la contraseña de Google dentro de Laural ni se usará el WebView embebido para autenticación. RFC 8252 establece PKCE y navegador externo para clientes nativos públicos.
- **Passkeys:** registro y verificación WebAuthn en el backend, con retos de un solo uso, origen/RP ID fijados y validación de firma. La clave privada se queda en el autenticador; Laural guarda la clave pública y metadatos necesarios.
- **Segundo factor:** TOTP como opción inicial, passkey como autenticador resistente al phishing y códigos de recuperación de un solo uso. Se permitirá registrar más de un método y se protegerán cambios y recuperación con reautenticación y avisos.
- Vincular Google a una cuenta existente requiere verificar ambas identidades y confirmación explícita. No se fusionarán cuentas solo porque los correos parezcan iguales.
- Habrá cierre de sesión, listado y revocación de dispositivos/sesiones, recuperación de cuenta y eliminación de cuenta y datos sincronizados.

OWASP recomienda almacenar contraseñas mediante algoritmos adaptativos como Argon2id. WebAuthn define credenciales de clave pública; la clave privada permanece en el autenticador. Las passkeys no eliminan la necesidad de recuperación segura.

### Primer inicio y conflictos

Al iniciar sesión, Laural no sobrescribirá la configuración silenciosamente:

- Si la cuenta no tiene una copia en la nube, preguntará si se sube el perfil local.
- Si ya hay configuración remota, mostrará diferencias y permitirá **usar la configuración de este equipo**, **descargar la de la cuenta** o **fusionar**.
- Antes de reemplazar datos locales, guardará una copia recuperable.
- La fusión usará IDs estables de perfiles y presentará conflictos por campo; las claves, sesiones y valores locales excluidos nunca se consideran para fusionar.

Después, el usuario podrá activar sincronización automática o dejarla manual. La primera versión automática sincronizará solo cambios de preferencias permitidas, con indicador de última sincronización y botón **Sincronizar ahora**. Los cambios concurrentes usarán revisiones/ETag y provocarán una vista de conflicto; no aplicarán «última escritura gana» sin aviso.

### Qué se envía al servicio

La carga de sincronización tendrá un esquema cerrado que no incluye campos secretos. Incluye preferencias explícitamente elegidas y metadatos de proveedor; no incluye claves API, contraseña, tokens de Laural, secretos OAuth, passkeys, historial, comandos, salida de terminal, archivos ni rutas de proyecto.

La comunicación exige TLS. El servicio aplicará cifrado en reposo, autorización por cuenta, separación entre usuarios, límites de tamaño y frecuencia, registros sin payloads ni secretos, copias de seguridad y política de retención. La primera versión no prometerá cifrado de extremo a extremo: el operador del servicio podría acceder a preferencias y endpoints guardados. Si se exige confidencialidad frente al propio operador, habrá que diseñar y aprobar un ADR aparte de cifrado cliente a cliente, recuperación de claves y alta de dispositivos.

## Arquitectura propuesta

- **Aplicación Tauri:** perfil local, importador/exportador, diálogo de conflictos, cliente HTTP de sincronización y almacenamiento local de la sesión de Laural en Credential Manager.
- **Servicio opcional de Laural:** API de cuenta y API de preferencias versionadas. No tendrá columnas ni endpoints para claves de proveedores.
- **Identidad:** contraseña verificada por el backend, passkeys WebAuthn y Google OIDC. Los clientes de escritorio son públicos; no llevan un secreto compartido de OAuth dentro del ejecutable.
- **Almacenamiento:** preferencias versionadas por cuenta; `account_id`, revisión, fecha y payload permitido. Cifrado en reposo administrado por el servicio y backups protegidos.
- **Despliegue:** servicio y manifiestos de infraestructura en el repositorio público si se mantiene el objetivo de código abierto. Secretos de despliegue y credenciales de correo/OAuth permanecen fuera del repositorio.

La autenticación y sincronización exigen servicio alojado, dominio, correo transaccional, base de datos, monitorización de abuso, respuesta a incidentes, política de privacidad y proceso para borrar cuentas. Mantener las funciones locales sin cuenta será obligatorio; sincronizar será optativo.

## Fases de entrega

### F0 — Decisión y contratos

- Aceptar o revisar ADR-0020.
- Definir JSON versionado para preferencias y perfiles, datos sincronizables y migración.
- Decidir límites de tamaño, endpoint personalizado, política de retención, alojamiento y privacidad.
- Registrar amenazas y casos de uso antes de abrir cuentas.

### F1 — Portabilidad sin cuenta

- Crear y renombrar el perfil local **Usuario desconocido**.
- Exportar/importar sin secretos por defecto.
- Añadir inclusión opcional de claves y exportación cifrada con contraseña o sin contraseña, con avisos explícitos.
- Añadir vista previa, fusión/reemplazo, copia de seguridad y escritura atómica.
- Cerrar pruebas de ida y vuelta, corrupción, archivo alterado, contraseña equivocada, migración de versión y separación entre claves y JSON local.

### F2 — Identidad y servicio

- Desplegar backend mínimo y correo de verificación/restablecimiento.
- Añadir registro y acceso con email/contraseña, limitación de intentos, sesiones revocables y eliminación de cuenta.
- Añadir login Google OIDC con PKCE y navegador externo.
- Añadir passkeys WebAuthn, TOTP, códigos de recuperación y flujos de pérdida de dispositivo.
- Revisar el modelo de amenazas, pruebas de autorización entre cuentas y auditoría de dependencias.

### F3 — Sincronización manual y conflictos

- Sincronizar preferencias permitidas, nunca claves.
- Añadir vista previa de primera carga/descarga, fusión y resolución de conflictos.
- Añadir exclusión de endpoints personalizados y opt-in separado para políticas del agente.
- Probar modo offline, cambios concurrentes, revocación, borrado de cuenta y recuperación.

### F4 — Sincronización automática y operación

- Añadir sincronización automática optativa, estado visible y reintentos limitados.
- Añadir monitorización operacional sin registrar contenido de configuración.
- Probar migraciones, restauración de backups y borrado verificable.
- Publicar guía de privacidad, términos de servicio, disponibilidad y estado del servicio.

## Casos de uso y criterios de aceptación

- Una persona nueva usa Laural como **Usuario desconocido**, sin red ni cuenta.
- Puede mover la configuración básica a otro equipo sin incluir secretos.
- Puede incluir claves solo después de elegirlo; la exportación cifrada rechaza contraseña incorrecta y cualquier alteración. La exportación sin contraseña se identifica como no cifrada.
- La importación no escribe claves en archivos ni las asocia a un endpoint distinto.
- Al iniciar sesión en otro equipo puede comparar y elegir cómo combinar los ajustes; ninguna opción envía claves API.
- Una prueba de contrato confirma que el backend rechaza cualquier campo `apiKey`, token de proveedor, password, OAuth credential o passkey en payload de sincronización.
- Otra cuenta no puede leer, reemplazar ni borrar la configuración de la cuenta actual.
- La persona puede revocar dispositivo/sesión, recuperar acceso y borrar la cuenta y la copia remota.
- Si no hay servicio, todos los flujos locales siguen disponibles y los cambios locales no se pierden.

## Decisiones que aún requieren aceptación

1. Alojamiento oficial operado por el proyecto o servicio autoalojable mantenido por la persona.
2. Sincronizar endpoints personalizados por defecto o exigir selección por perfil.
3. Política de sincronización de modo/reglas del agente; propuesta: no sincronizarlos salvo consentimiento separado y usar modo de revisión en dispositivos nuevos.
4. Cifrado servidor en reposo en F3 frente a cifrado de extremo a extremo. Propuesta inicial: no afirmar E2EE; diseñarlo en un ADR posterior si es requisito.
5. Disponibilidad, costes de operación, retención de datos y procedimiento de soporte/borrado.

## Referencias de seguridad

- [RFC 8252 — OAuth 2.0 para aplicaciones nativas](https://www.rfc-editor.org/rfc/rfc8252.html)
- [RFC 9700 — buenas prácticas actuales de seguridad OAuth 2.0](https://www.rfc-editor.org/rfc/rfc9700.html)
- [Google — OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [W3C — Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)
- [OWASP — Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP — Passkey Security](https://cheatsheetseries.owasp.org/cheatsheets/Passkey_Security_Cheat_Sheet.html)
- [OWASP — Multifactor Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)
- [OWASP — Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
