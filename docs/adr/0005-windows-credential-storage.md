# ADR-0005: Credential Manager de Windows para claves

- Estado: Aceptada
- Fecha: 2026-11-19
- Decisores: Laural contributors

## Contexto

Los perfiles pueden incluir API keys. JSON local facilita migración y soporte, pero no debe contener secretos en texto plano.

## Decisión

Guardar las claves mediante la API de keyring del sistema operativo, usando Windows Credential Manager. Almacenar en el archivo del perfil solo la referencia del proveedor y sus datos no secretos.

## Alternativas consideradas

- Guardar clave en JSON cifrado por Laural: requiere gestión de claves, recuperación y políticas criptográficas propias.
- Guardar la clave en texto plano: se rechaza porque expone secretos a backups, copias del proyecto y herramientas de diagnóstico.
- Pedir clave en cada solicitud y no persistirla: reduce almacenamiento, pero impide usar perfiles configurados con comodidad.

## Consecuencias

- Los secretos dependen del almacén de credenciales del sistema y del perfil de usuario de Windows.
- Exportar/importar perfiles no debe exportar credenciales automáticamente.
- La sincronización futura requiere un diseño explícito de cifrado y consentimiento.
- La aplicación debe evitar incluir cabeceras, claves o mensajes completos en logs de diagnóstico.
