# ADR-0013 — Configuración local unificada

Estado aceptado.

Los ajustes se encontraban repartidos entre la barra lateral, el asistente y el selector de modelo. Configuración reúne todos los ajustes persistentes y la acción de borrar el historial. Los accesos de contexto utilizan los mismos formularios y las mismas operaciones de guardado.

Esta decisión evita duplicar validaciones, credenciales o reglas de autorización. La selección de una terminal o de archivos para una pregunta sigue ligada a la sesión. La navegación y persistencia tras reinicio requieren validación en Windows.
