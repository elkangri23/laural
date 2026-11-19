# Política de seguridad

## Reportar vulnerabilidades

No publiques detalles de una vulnerabilidad sin parchear en un issue público. Usa la función **Report a vulnerability** de la pestaña Security de GitHub si está disponible para el repositorio. Si no está habilitada, contacta con el mantenedor mediante un canal privado y proporciona solo los datos necesarios para reproducirla.

Incluye versión/commit, sistema operativo, impacto, pasos de reproducción y una mitigación posible. No adjuntes claves reales, proyectos privados ni volcados completos de terminal.

## Alcance prioritario

- Ejecución de comandos del agente o bypass de políticas.
- Escrituras fuera de la carpeta de proyecto o pérdida de archivos.
- Exposición de credenciales, prompts o contexto privado.
- Endpoints HTTP remotos, redirecciones o validación insuficiente de URL.
- Vulnerabilidades en actualizador, firma o empaquetado.

## Expectativas

Laural está en desarrollo temprano y no publica una garantía de SLA. El mantenedor confirmará recepción y propondrá una mitigación según disponibilidad. Las versiones estables y correcciones de seguridad se anunciarán en GitHub Releases.

## Uso seguro

No habilites modo automático en proyectos o datos sensibles sin entender que el shell corre con los privilegios de tu usuario. Evita enviar credenciales o datos confidenciales a modelos remotos.
