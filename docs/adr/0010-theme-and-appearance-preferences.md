# ADR-0010: Doce paletas y apariencia clara/oscura

- Estado: Aceptada
- Fecha: 2026-11-19
- Decisores: Laural contributors

## Contexto

La interfaz debe permitir personalización visual sin cuentas ni sincronización. El usuario pidió doce temas disponibles y modo oscuro; la elección de paleta y el contraste claro/oscuro son necesidades distintas.

## Decisión

Ofrecer doce paletas de acento. Cada paleta funciona en modo claro y oscuro; el modo inicial es oscuro. Guardar ambos valores en el `localStorage` del WebView. Cambiar apariencia actualiza también la paleta xterm.js sin recrear la sesión PTY.

## Alternativas consideradas

- Doce combinaciones fijas donde cada entrada ya determina claro u oscuro: se rechaza porque no permite elegir contraste de forma independiente.
- Solo selector de color libre: no garantiza combinaciones revisadas ni una lista simple y reconocible de temas.
- Sin persistencia: obliga a repetir la elección tras cada inicio.

## Consecuencias

- La UI mantiene tokens CSS para superficies, texto, bordes y acentos; cada modo debe conservar legibilidad.
- El emulador de terminal usa el mismo color de acento y superficies adecuadas para claro u oscuro.
- La preferencia no se exporta ni sincroniza en la primera versión.
- Añadir o retirar un tema requiere actualizar catálogo, contraste, vista previa y documentación.
