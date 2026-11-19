# Sistema visual de Laural

## Principios

- Jerarquía clara entre navegación, espacio de trabajo, salida de terminal y asistente.
- Tipografía legible; tamaños pequeños se reservan para metadatos, nunca para instrucciones o contenido principal.
- Controles con estados visibles de foco, hover, selección, desactivación y error.
- La terminal mantiene contraste propio y conserva su sesión al personalizar la apariencia.
- Color de acento configurable, sin cambiar los significados de éxito, aviso y error.

## Modos

- **Oscuro:** modo inicial, superficies oscuras, texto claro y acento de tema.
- **Claro:** superficies claras, texto oscuro y el mismo acento con contraste adaptado.
- La elección se aplica a UI, campos, diálogos y terminal, y se conserva localmente.

## Paletas

| ID | Nombre | Acento en oscuro | Acento en claro |
| --- | --- | --- | --- |
| `laurel` | Laural | `#b9f27c` | `#416b24` |
| `ocean` | Océano | `#67d5ff` | `#006d91` |
| `indigo` | Índigo | `#9ca8ff` | `#4857b4` |
| `lavender` | Lavanda | `#c4a1ff` | `#7042a6` |
| `rose` | Rosa | `#ff9bb5` | `#ad3f62` |
| `coral` | Coral | `#ffae8a` | `#aa4e2a` |
| `amber` | Ámbar | `#f5cc73` | `#82600e` |
| `teal` | Verde azulado | `#65d7c4` | `#087b6d` |
| `sky` | Cielo | `#73c8f6` | `#176b9a` |
| `ruby` | Rubí | `#ff8294` | `#ac3348` |
| `graphite` | Grafito | `#d0d3da` | `#505561` |
| `sand` | Arena | `#e0bc8e` | `#805b2c` |

## Implementación

El catálogo vive en `src/themes.ts`. El frontend asigna tokens CSS a `document.documentElement` y mantiene `data-theme`/`data-mode`. Los tokens de superficies, texto y bordes tienen valores para cada modo; los acentos se derivan de la paleta activa. Las preferencias van a `localStorage` con las claves `laural.theme` y `laural.appearance`.

La terminal xterm.js comparte acento, selección y contraste del modo actual. No desmontar ni volver a crear la terminal al cambiar un token: el estado PTY y scrollback deben permanecer intactos.

## Revisión visual para nuevos componentes

1. Usa tokens de superficie, texto, borde y acento; evita hexadecimales locales en componentes.
2. Comprueba legibilidad en los dos modos y en los doce acentos.
3. No uses solo color para representar estado; añade texto, forma o icono.
4. Mantén foco de teclado perceptible y etiquetas/estados accesibles.
5. Comprueba ventanas estrechas y escalado de texto antes de cerrar un cambio visual.
