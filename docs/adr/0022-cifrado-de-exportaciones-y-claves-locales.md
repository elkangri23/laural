# ADR-0022: Cifrado obligatorio para exportar claves

## Estado

Decisión aceptada; aplicada en la implementación inicial de exportación/importación local. Pruebas de integración de fallos del almacén y ensayo de recuperación en Windows siguen pendientes.

## Contexto

Se quiere transferir configuración entre equipos y, opcionalmente, incluir claves API. Un archivo exportado puede copiarse a correo, nube, USB o repositorios. Credential Manager protege las credenciales locales, pero no debe confundirse con protección frente a código que ya se ejecuta con la cuenta de Windows.

## Decisión

- Las claves quedan en Windows Credential Manager mediante `keyring` con `windows-native`; `providers.json` contiene solo metadatos.
- Al exportar, las claves se excluyen por defecto. Incluirlas requiere acción explícita y contraseña obligatoria. No existe exportación de claves en texto plano.
- Exportar sin contraseña solo puede producir un archivo sin claves.
- El formato que contenga claves derivará una clave con Argon2id, sal criptográficamente aleatoria y parámetros versionados y acotados. El contenido se cifrará con un modo autenticado mantenido, inicialmente AES-256-GCM con nonce único. Se usarán bibliotecas mantenidas y vectores de prueba; Laural no implementará algoritmos criptográficos propios.
- Importar descifra en memoria y escribe las credenciales directamente en Credential Manager. No crea temporales en claro, no registra secretos y no aplica parcialmente una importación fallida.
- La clave puede estar temporalmente en la memoria del proceso para atender una petición. Se minimiza su vida útil, pero no se promete protección contra malware con acceso a la cuenta, proceso comprometido, administrador local o captura de memoria.

## Consecuencias y pruebas requeridas

- Perder la contraseña de exportación significa perder acceso a las claves del archivo; no habrá recuperación ni puerta trasera.
- El cifrado del archivo no elimina la necesidad de elegir una contraseña resistente. La UI debe indicar que el archivo cifrado sigue siendo sensible.
- Rechazar contraseña incorrecta, alteración, versión desconocida, tamaños excesivos y parámetros KDF fuera de límites antes de gastar recursos.
- Probar ida y vuelta, ausencia de secretos en exportación sin claves, rollback cuando falla la importación y ausencia de temporales/logs con claves en claro.
- Medir parámetros KDF en hardware Windows objetivo antes de fijar valores de producción; no aceptar parámetros arbitrarios del archivo sin límites.

## Referencias

- [ADR-0005: Credential Manager de Windows](0005-windows-credential-storage.md)
- [Plan de perfiles y sincronización](../plans/sincronizacion-preferencias.md)
- [Microsoft: uso de Credential Manager y DPAPI](https://learn.microsoft.com/en-us/windows/win32/SecBP/handling-passwords)
- [OWASP: almacenamiento criptográfico](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
