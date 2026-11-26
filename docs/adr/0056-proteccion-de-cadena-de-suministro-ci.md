# ADR 0056: Protección de la cadena de suministro de CI

- Estado: Aceptada
- Fecha: 2026-11-26
- Decisores: Laural contributors

## Contexto

Los workflows de CI y publicación ejecutaban acciones externas mediante tags móviles. El workflow de publicación genera instaladores firmados y necesita permiso para escribir releases y actualizar el manifiesto; un cambio de una acción o un tag no autorizado podía poner en riesgo la clave privada de firma o el canal de actualización.

## Decisión

- Fijar cada acción de GitHub a un SHA completo y dejar su versión legible como comentario.
- Denegar permisos del token por defecto y conceder `contents: write` solo al job de publicación.
- Antes de firmar, comprobar que el commit del tag publicado ya esté integrado en `main`.
- Proteger en GitHub la creación, actualización y eliminación de tags `v*`; solo la cuenta administradora puede saltarse la regla.

## Alternativas consideradas

- Conservar tags de acción móviles: se descarta porque el contenido ejecutado podría cambiar sin modificar este repositorio.
- Dar permisos de escritura a todo el workflow: se descarta por ampliar innecesariamente el impacto de cada paso.
- Restringir los pushes directos a `main` como parte de este cambio: se difiere porque cambiaría el flujo habitual de contribución; se registra como riesgo residual.

## Consecuencias

- Cambiar una acción requiere revisar el nuevo commit y actualizar explícitamente su SHA.
- Colaboradores sin rol de administrador no pueden crear, mover ni borrar tags de versión.
- El administrador, `main` y la clave privada de firma siguen siendo puntos de confianza.
- La protección de tags es una regla externa del repositorio y debe mantenerse junto con la configuración de GitHub.

## Evidencia / enlaces

- [GitHub REST API: reglas y reglasets del repositorio](https://docs.github.com/en/rest/repos/rules?apiVersion=2026-03-10)
- [Modelo de amenazas](../security/threat-model.md)
- [Informe de auditoría](../security/audit-report.md)
