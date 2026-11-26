# Plan de implementación — ajustes, idiomas y PowerShell

* **Autor:** Antonio Moles
* **Estado:** Fase 1 implementada localmente; pendientes validación visual y de tamaños en Windows. Fase 2: contrato v1/v2 implementado; los health checks y status públicos del VPS respondieron 200 el 2026-11-25, pero falta validar contrato v2 y sincronización autenticada desde el cliente antes de publicar. Fase 3: el ajuste quedó comprobado en proceso PowerShell 7.6.9 bajo ConPTY; falta probar el inicio real desde Laural, fallbacks ausente/incompatible y aislamiento entre shells/sesiones.
* **Fecha:** 2026-11-25
* **Diseño:** [Ajustes, idiomas y sugerencias locales de PowerShell](../designs/ajustes-idiomas-prediccion-terminal.md)

Este documento concentra el inventario de archivos, tareas y pruebas. Las fronteras y decisiones arquitectónicas están en el diseño enlazado.
## Tareas de implementación

### Fases de entrega

Cada fase deja el proyecto compilable y verificable antes de iniciar la siguiente. Los gates se ejecutan sobre el conjunto de archivos modificado en esa fase; no se rebajan las metas 100/80/0 definidas más abajo. Los mismos archivos pueden aparecer en más de una fase porque cada una modifica responsabilidades distintas.

1. **Navegación y controles de agente — implementados localmente; validación visual pendiente.** `SettingsDialog.tsx` pasa 5/5 con 100 % de líneas, ramas y funciones. `AgentSettings.tsx` es Crítico; sus permisos, editor de reglas y avisos ya usan el catálogo bilingüe, con 4/4 pruebas y 100/100. `App.tsx` localiza también el chip de diff Git; sus 47 pruebas pasan y conserva 81,71 % de líneas (Estándar). `ModalShell` requiere un título localizado; sus 2 pruebas focalizadas pasan. `TaskRecipes.tsx` localiza las tres recetas iniciales y el prompt del plan; conserva literalmente las recetas editadas y pasa 23/23 con 99 % de líneas (Estándar). `ConfigurationTransfer.tsx` localiza nombre y tipo de archivo de los selectores nativos; su prueba focalizada pasa 11/11 y mantiene el gate Crítico 100/100. `TerminalPane.tsx` localiza el marcador de línea editada no capturada sin cambiar la entrada ni salida del shell; 36/36 pruebas focalizadas y 100/100. Suite UI completa: 278/278, 92,12 % de líneas; gate por categorías y build pasan. Falta validar visualmente en Windows con teclado y tamaño mínimo 960 × 650 px.
2. **Idioma y formatos v2.** Contrato compartido y servidor implementados: v2 añade únicamente idioma (`es`/`en`) y el backend acepta v1/v2 con validadores cerrados. El módulo `server/src/snapshot-validation.ts` está clasificado Crítico y su gate exige 100 % de líneas y ramas; `app.ts` mantiene las verificaciones integradas de rutas PUT/GET. Suite de servidor de la revisión anterior: 185 pruebas pasan, 11 omitidas; cobertura global 76,50 % de líneas y 75,48 % de ramas; build y gate Crítico pasan. En cliente, el idioma se detecta inicialmente desde `navigator.language`, se persiste en `laural.language.v1`, actualiza el atributo `lang` del documento y usa catálogos TypeScript cotejados. La exportación v2 incluye el idioma y lee v1; un archivo antiguo conserva el idioma local válido. Snapshots locales emiten v2, leen v1/v2 y aplican el fallback local al restaurar un snapshot v1. Si un servidor antiguo rechaza v2, el cliente explica en español que hay que actualizarlo y persiste la sincronización pendiente ante fallos de escritura manual, sin sustituir el estado local. Ya se traducen Ajustes, shell, menús, proveedor, temas, vista previa de contexto, actividad del agente, chat, bloques, paleta, panel Git, ayuda, avisos, recetas, retención de copias, marcador Markdown, Cuenta/sincronización (incluidos sus estados de operación), Importar/exportar, Actualizaciones, controles propios de la terminal, permisos/avisos de agente, encabezados de categorías, estados de carga y estados dinámicos de sync/agente/copias/políticas/proveedor. Se conservan intactos mensajes libres del servicio/backend y del modelo, cifrado, instalación firmada, comandos y salida del shell. `AccountSettings.tsx` mantiene 100 % de líneas, ramas y funciones (322/322, 197/197 y 80/80); `ConfigurationTransfer.tsx` 100 % de líneas y ramas. UI: 278/278, 92,12 % de líneas globales; `App.tsx` 81,71 % (Estándar). **Antes de publicar el cliente, validar en el VPS que el servicio v2 está desplegado.** Sigue pendiente validar la reconexión VPS real.
3. **Predicción PowerShell.** Implementación local: preferencia local en `src/App.tsx`, booleano en `src/components/TerminalPane.tsx`, constructor `src-tauri/src/lib.rs` y lógica probada aislada en `src-tauri/src/terminal_prediction.rs`. En PowerShell 7.6.9 sobre ConPTY se confirmó `PredictionSource=History` y `PredictionViewStyle=InlineView`; con salida redirigida PSReadLine falla por falta de soporte VT. Esta prueba no modifica perfiles. UI: 278/278, 92,12 % de líneas globales. Rust: 166 pasadas y 2 manuales ignoradas. La cobertura Crítica tiene gate CI 100/100; `cargo llvm-cov` en Windows/MSVC no genera perfiles. Pendiente validar el arranque integrado desde Laural, fallbacks con PSReadLine ausente/incompatible y que la opción afecte solo sesiones PowerShell nuevas, no CMD, WSL, Git Bash ni sesiones existentes.

Asignación de documentación por fase: Fase 1, `README.md`, `docs/configuracion.md`, `docs/requirements/README.md`, `docs/use-cases/configuracion-idiomas-y-terminal.md`, `docs/use-cases/README.md`, `docs/ROADMAP.md`, `docs/BACKLOG.md` y `CHANGELOG.md`; Fase 2, `README.md`, `docs/README.md`, `src/README.md`, `docs/configuracion.md`, `docs/development/coverage-policy.md`, `docs/architecture/overview.md`, `docs/adr/0054-configuracion-idiomas-y-formatos-v2.md`, `docs/adr/README.md`, `docs/use-cases/configuracion-idiomas-y-terminal.md`, `docs/use-cases/README.md`, `docs/requirements/README.md`, `docs/ROADMAP.md`, `docs/BACKLOG.md` y `CHANGELOG.md`; Fase 3, `README.md`, `src/README.md`, `docs/configuracion.md`, `docs/security/privacy.md`, `docs/development/coverage-policy.md`, `docs/architecture/overview.md`, `docs/adr/0055-prediccion-local-psreadline.md`, `docs/adr/README.md`, `docs/use-cases/configuracion-idiomas-y-terminal.md`, `docs/use-cases/README.md`, `docs/requirements/README.md`, `docs/ROADMAP.md`, `docs/BACKLOG.md` y `CHANGELOG.md`. Cada fase actualiza solo los documentos relacionados con el comportamiento que incorpora.

La documentación se entrega con la fase que introduce cada comportamiento. No constituye una fase de publicación separada.

### Archivos que se crearán o modificarán

#### Interfaz, preferencias y terminal

| Archivo | Acción | Cambio y motivo |
| --- | --- | --- |
| `src/i18n.tsx` | Crear | Proveedor React, idioma persistido, detección inicial, selección manual y función de traducción con claves tipadas e interpolación. |
| `src/locales/es.ts` | Crear | Catálogo completo en español y fuente de claves de interfaz. Datos declarativos; sin tests propios. |
| `src/locales/en.ts` | Crear | Traducción completa de las mismas claves. `satisfies`/tipos deben impedir que falten o sobren claves respecto a español. Datos declarativos; sin tests propios. |
| `src/main.tsx` | Modificar | Envolver la app en el proveedor de idioma para que todos los componentes compartan el mismo estado. |
| `index.html` | Modificar | Idioma y título iniciales coherentes con el fallback en español antes de iniciar React. |
| `src/App.tsx` | Modificar | Mantener la categoría seleccionada, abrir los paneles correspondientes, coordinar el retorno desde los diálogos, integrar el idioma en snapshot/transferencia y pasar la preferencia PowerShell al terminal. No añadir reglas de ejecución nuevas. |
| `src/components/ModalShell.tsx` | Crear | Extraer el cascarón modal compartido actual con cierre, foco y semántica accesible para que los flujos independientes no hereden la navegación de Ajustes. Interfaz: Estándar, al menos 80 % de líneas. |
| `src/components/SettingsDialog.tsx` | Modificar | Usar `ModalShell` y añadir navegación accesible por cinco categorías, con foco visible, teclado, región etiquetada y panel desplazable/adaptable. Solo es la entrada principal de Ajustes. |
| `src/components/AgentSettings.tsx` | Crear | Extraer solo los controles de permiso/reglas y retención a la categoría Agente y terminal. `App` conserva su estado y persistencia; el componente separa la vista sensible para probar sus límites. |
| `src/components/AccountSettings.tsx` | Modificar | Usar `ModalShell`, traducir etiquetas y estados de cuenta; transportar idioma como preferencia normal sin incluirlo en campos de credenciales o factores. |
| `src/components/AgentActivity.tsx` | Modificar | Traducir la interfaz de actividad; mantener locales los registros y no añadir envío remoto. |
| `src/components/AssistantMarkdown.tsx` | Modificar | Traducir controles y textos de ayuda del renderizador; conservar literalmente el contenido del modelo. |
| `src/components/BackupRetentionControl.tsx` | Modificar | Traducir opciones y avisos sin cambiar límites ni borrado de copias. |
| `src/components/ChatMessageItem.tsx` | Modificar | Traducir botones, rótulos accesibles y estados; no traducir mensajes del usuario/modelo. |
| `src/components/CommandBlockItem.tsx` | Modificar | Traducir controles y estados visibles; conservar comando y salida exactos. |
| `src/components/CommandPalette.tsx` | Modificar | Traducir búsqueda, grupos, instrucciones de teclado y estado vacío; conservar el texto del comando. |
| `src/components/ConfigurationTransfer.tsx` | Modificar | Usar `ModalShell`, mostrar vista previa de idioma; leer v1 sin campo y exportar v2; mantener contraseña/clave bajo los contratos cifrados existentes. |
| `src/components/GitPanel.tsx` | Modificar | Traducir controles, estados y mensajes propios; tratar nombres, ramas, rutas y diff como datos sin traducir. |
| `src/components/HelpDialog.tsx` | Modificar | Traducir guía, atajos y enlaces de navegación. |
| `src/components/NotificationCenter.tsx` | Modificar | Traducir controles y estados propios; conservar intacto el texto de avisos suministrado por servicio/usuario. |
| `src/components/TaskRecipes.tsx` | Modificar | Traducir formularios y validaciones; no reescribir recetas guardadas por el usuario. |
| `src/components/TerminalPane.tsx` | Modificar | Traducir rótulos/errores propios y pasar la opción de predicción al crear sesión; no modificar la entrada ni la salida del shell. |
| `src/components/UpdateManager.tsx` | Modificar | Usar `ModalShell` en su flujo de ajustes, traducir estados y errores seguros; mantener intacta verificación de firma e instalación. |
| `src/themes.ts` | Modificar | Mantener IDs y colores estables; obtener nombres visibles de tema mediante claves traducibles sin cambiar los 12 identificadores persistidos. |
| `src/App.css` | Modificar | Añadir estilos de navegación lateral, selector compacto, foco, estados y scroll; respetar variables de tema y contraste. |
| `src/sync/contracts.ts` | Modificar | Usar el tipo compartido unión v1/v2 y conservar el tipado de estados de conflicto y snapshot. |

#### Contratos compartidos y persistencia Rust

| Archivo | Acción | Cambio y motivo |
| --- | --- | --- |
| `shared/preference-snapshot-v2.d.ts` | Crear | Tipo TypeScript cerrado de snapshot v2 con `language: "es" | "en"`. |
| `shared/preference-snapshot-v2-enums.ts` | Crear | Enumeraciones v2 compartidas; no duplicar valores en cliente y servidor. |
| `shared/preference-snapshot-v2.schema.json` | Crear | JSON Schema cerrado para validar v2, sin secretos ni campos de terminal/agente. |
| `shared/preference-snapshot.d.ts` | Crear | Unión TypeScript discriminada de v1 y v2 para lectores que deben aceptar ambos. |
| `shared/fixtures/preference-snapshot-v2.json` | Crear | Fixture válida sin claves para comprobar que TypeScript, Rust y servidor comparten el mismo contrato. Fixture declarativa; sin test aislado. |
| `src-tauri/src/preferences/snapshot.rs` | Modificar | Decodificar v1/v2, validar idioma, producir v2 y preservar comportamiento estricto ante campos, enums y versiones inválidos. Crítico: 100 % de líneas y ramas. |
| `src-tauri/src/configuration_transfer.rs` | Modificar | Exportar versión 2, importar versiones 1 y 2, derivar idioma determinista cuando falte y conservar cifrado autenticado de claves. Crítico: 100 % de líneas y ramas. |
| `src-tauri/src/providers.rs` | Modificar | Adaptar construcción/aplicación de preferencias en transferencia y sync; ningún cambio al almacenamiento de claves ni a perfiles permitidos. Crítico: 100 % de líneas y ramas del archivo antes de cerrar; la línea base documentada está por debajo del objetivo y debe cerrarse, no ocultarse. |
| `src-tauri/src/sync.rs` | Modificar | Transportar v1/v2, bloquear escrituras sobre snapshots de versión no soportada y devolver un estado traducible de actualización requerida sin perder cambios locales. Crítico: 100 % de líneas y ramas del archivo antes de cerrar. |
| `src-tauri/src/lib.rs` | Modificar | Añadir el booleano tipado a `create_terminal`. Solo si es verdadero y el shell es PowerShell, añadir en el `shell_command` existente el bloque fijo que obtiene `Set-PSReadLineOption`, comprueba que expone `PredictionSource` y `PredictionViewStyle`, y solicita `History` e `InlineView` con `-ErrorAction Stop` dentro de `try/catch` silencioso. Si falta el cmdlet/parámetro o el valor no es compatible, omitir la predicción y continuar con el prompt sin mostrar el error. Con falso o cualquier otro shell, conservar exactamente el comando de inicio actual. Afectar solo sesiones nuevas; actualizar las llamadas y fixtures de tests Rust que usan la firma nueva. Ejecución de comandos: Crítico, 100 % de líneas y ramas del archivo. |
| `src-tauri/src/terminal_prediction.rs` | Crear | Encapsular el prefijo fijo de PSReadLine y devolver el comando original si está desactivado o es otra shell. Pruebas unitarias de los casos; gate CI exige 100 % de líneas y ramas. Crítico por configurar la shell. |

#### Servicio de sincronización

| Archivo | Acción | Cambio y motivo |
| --- | --- | --- |
| `server/src/app.ts` | Modificar | Aceptar schemas cerrados v1 y v2; rechazar snapshot inválido o futuro sin tratarlo como vacío ni cambiar la revisión. Integridad de sync: Crítico, 100 % de líneas y ramas aplicables. |
| `server/src/contracts.ts` | Modificar | Tipar snapshots como unión v1/v2 para rutas, almacenamiento e historial sin perder el discriminante. |
| `server/tests/snapshot-contract.test.ts` | Modificar | Probar v1/v2 válidos, rechazo de idiomas/campos/versiones inválidos y ausencia de secretos. Crítico: cubrir 100 % de líneas y ramas de la lógica de contrato. |
| `server/tests/app.test.ts` | Modificar | Probar lectura/escritura v1/v2, conflicto de revisión y que una versión no compatible no sustituye datos. Crítico: 100 % de líneas y ramas de los nuevos caminos. |
| `server/tests/public-status.test.ts` | Modificar | Verificar que los avisos públicos rechazan mensajes vacíos o mayores de 600 caracteres y que la respuesta de reserva no expone errores internos. El requisito de redactar avisos en español y sin datos personales o secretos es editorial/operativo, no una prueba automática de idioma. Servicio de estado: Estándar, al menos 80 % de líneas. |

#### Pruebas automatizadas de interfaz y Rust

| Archivo | Acción | Cambio y motivo |
| --- | --- | --- |
| `tests/i18n.test.tsx` | Crear | Probar detección inicial, fallback, persistencia, elección manual, interpolación y catálogo completo. Lógica de interfaz: Estándar, al menos 80 % de líneas. |
| `tests/settings-dialog.test.tsx` | Modificar | Probar navegación por teclado, cambio de categoría, foco/ARIA, Escape, tamaño compacto y retorno consistente. Interfaz: Estándar, al menos 80 % de líneas. |
| `tests/modal-shell.test.tsx` | Crear | Probar cierre, foco y semántica modal compartidos, además de verificar que los flujos de Cuenta, Transferencia y Actualizaciones no muestran la navegación por categorías. Interfaz: Estándar, al menos 80 % de líneas. |
| `tests/app.test.tsx` | Modificar | Probar selección inicial, acceso a las cinco categorías, retorno de diálogos y propagación de idioma sin romper tema ni apariencia; comprobar que códigos de error conocidos se muestran con textos locales y que no se presentan excepciones crudas. Orquestación UI: Estándar, al menos 80 % de líneas. |
| `tests/agent-settings.test.tsx` | Crear | Cubrir permisos actuales, guardado de reglas, retención y manejo de errores; sin autorizar ejecuciones adicionales. La política cambia acciones de agente: Crítico, 100 % de líneas y ramas. |
| `tests/terminal-pane.test.tsx` | Modificar | Comprobar que la interfaz pasa el booleano solo a sesiones PowerShell nuevas y que xterm no intercepta Tab/Enter. La construcción del comando y las ramas de shell se prueban en Rust. Interfaz de terminal: Crítico, 100 % de líneas y ramas del archivo. |
| `tests/configuration-transfer.test.tsx` | Modificar | Probar exportación v2 e importación v1/v2, fallback de idioma, preservación de preferencias y errores sin exponer claves. Transferencia de configuración: Crítico, 100 % de líneas y ramas. |
| `tests/backup-retention-control.test.tsx` | Modificar | Comprobar límites de retención, elección y manejo de errores del control sensible a borrado de copias. Crítico, 100 % de líneas y ramas. |
| `tests/account-settings.test.tsx` | Modificar | Verificar que la preferencia de idioma llega al snapshot sin alterar MFA, passkeys, sesión ni campos secretos; los mensajes estáticos de estado permanecen en español y los errores crudos no se muestran. Cuenta/sync: Crítico, 100 % de líneas y ramas del archivo. |
| `tests/update-manager.test.tsx` | Modificar | Mantener cobertura de errores y estados de descarga/instalación al sustituir textos por traducciones. Actualizador firmado: Crítico, 100 % de líneas y ramas del archivo. |
| `tests/sync-contract.test.ts` | Modificar | Verificar el discriminante v1/v2 y que el idioma no altera los campos excluidos. Integridad de sync: Crítico, 100 % de líneas y ramas de la lógica contractual. |

Clasificación previa por responsabilidad: `SettingsDialog.tsx`, `ModalShell.tsx`, `App.tsx`, `i18n.tsx` y componentes de presentación ordinaria son Estándar (80 % de líneas); `AccountSettings.tsx`, `AgentSettings.tsx`, `BackupRetentionControl.tsx`, `ConfigurationTransfer.tsx`, `UpdateManager.tsx`, `TerminalPane.tsx` y validación/transferencia/sync Rust y servidor son Críticos (100 % de líneas y ramas). Los JSON Schema, tipos/DTO, catálogos y fixtures declarativos son Triviales (0 % y fuera del denominador); sus reglas se ejercitan desde los tests del validador Crítico. Antes de crear o revisar cada test se comunicará su clasificación concreta. No se rebajará el nivel de `providers.rs` ni `sync.rs`: ambos deben llegar a 100 % de líneas y ramas si se modifican. La línea base global del proyecto se informará separada y no se declarará conforme mientras sus gates por categoría sigan incompletos.

#### Documentación y seguimiento

| Archivo | Acción | Cambio y motivo |
| --- | --- | --- |
| `README.md` | Modificar | Presentar ajustes por categorías, español/inglés y sugerencias locales de PowerShell con su estado real de disponibilidad. |
| `docs/README.md` | Modificar | Añadir enlaces a los casos de uso, decisiones y guía de idioma/ajustes. |
| `src/README.md` | Modificar | Describir catálogos, proveedor de idioma, componentes de configuración y límites entre UI y preferencias. |
| `docs/configuracion.md` | Modificar | Documentar categorías, idioma inicial/manual, exportación/sync v1/v2 y el carácter local de predicción. |
| `docs/security/privacy.md` | Modificar | Documentar que el historial local de PowerShell puede ser sensible, la predicción apagada por defecto y sus exclusiones de exportación, sync, IA y telemetría. |
| `docs/development/coverage-policy.md` | Modificar | Clasificar los nuevos módulos y pruebas por 100/80/0; actualizar resultados medidos sin declarar cumplimiento global falso. |
| `docs/architecture/overview.md` | Modificar | Actualizar el flujo de idioma, transferencia/snapshot v2 y frontera de creación de terminal PowerShell. |
| `docs/adr/0054-configuracion-idiomas-y-formatos-v2.md` | Crear | Registrar navegación, idioma, persistencia, evolución de formatos y compatibilidad como decisión aceptada. |
| `docs/adr/0055-prediccion-local-psreadline.md` | Crear | Registrar el uso optativo y por sesión de PSReadLine, privacidad del historial y fallback. |
| `docs/adr/README.md` | Modificar | Incluir ADR-0054 y ADR-0055 en el índice con su estado de implementación. |
| `docs/use-cases/configuracion-idiomas-y-terminal.md` | Crear | Describir navegación, cambio de idioma, importación/sync compatible y activación de predicción PowerShell. |
| `docs/use-cases/README.md` | Modificar | Añadir el nuevo caso de uso al índice. |
| `docs/requirements/README.md` | Modificar | Registrar requisitos de idioma, accesibilidad, transferencia y privacidad de terminal. |
| `docs/ROADMAP.md` | Modificar | Marcar alcance, entregas hechas y validaciones Windows/servicio que queden pendientes. |
| `docs/BACKLOG.md` | Modificar | Cerrar tareas completadas y dejar únicamente bloqueos verificables de despliegue o compatibilidad. |
| `CHANGELOG.md` | Modificar | Añadir la reorganización, selector de idioma, formatos compatibles y ajuste de PowerShell a la versión correspondiente. |

### Verificación de entrega

- `npm run build` debe compilar TypeScript, comprobar que los catálogos comparten claves, generar la interfaz y respetar el presupuesto de bundles.
- `npm test -- --coverage` debe pasar las suites de interfaz; informar líneas y ramas por categoría con los archivos triviales excluidos.
- Ejecutar el gate de cobertura Rust y el de servidor con bases de datos de prueba aisladas cuando aplique. Para cada archivo Crítico modificado, exigir 100 % de líneas y ramas; para Estándar, al menos 80 % de líneas y flujos/errores principales; Trivial, sin pruebas propias.
- Añadir pruebas unitarias Rust para (a) PowerShell activado, que incluye solo el bloque fijo protegido; (b) PowerShell desactivado, que conserva exactamente el comando anterior; y (c) opción activada con CMD, WSL o Git Bash, cuyos comandos permanecen intactos. Comprobar que las llamadas y fixtures Rust existentes usan la firma nueva. La cobertura de la lógica modificada en `lib.rs` debe alcanzar 100 % de líneas y ramas.
- Validar manualmente en Windows: primer inicio con idioma Windows español/inglés/no soportado; cambio manual después de reiniciar; importación antigua; sync v1/v2 con cliente compatible y no compatible; navegación de ajustes con teclado; y PSReadLine ausente, compatible e incompatible. En los tres casos de PSReadLine confirmar que el prompt sigue funcionando y que no aparece error de configuración; verificar que Tab completa, Enter ejecuta y activar/desactivar el ajuste no cambia terminales ya abiertas.
- Revisar instalador y diálogos en español e inglés, nombres largos, ventana al ancho mínimo, foco visible y lector de pantalla básico. Confirmar que no aparece ninguna clave, historial, ruta del proyecto o comando sugerido en exportación, snapshot, logs o solicitudes al modelo.
