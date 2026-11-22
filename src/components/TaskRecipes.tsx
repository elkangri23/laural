import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type TaskRecipe = { id: string; name: string; objective: string; steps: string[] };

const STORAGE_KEY = "laural.task-recipes.v1";
const MAX_RECIPES = 30;
const DEFAULT_RECIPES: TaskRecipe[] = [
  { id: "review-project", name: "Revisar un proyecto", objective: "Revisa el proyecto y señala problemas concretos con impacto y ubicación.", steps: ["Identifica la estructura y tecnologías principales.", "Busca errores, riesgos de seguridad y deuda técnica relevante.", "Resume hallazgos con referencias y propone cambios pequeños."] },
  { id: "add-tests", name: "Añadir pruebas", objective: "Mejora la cobertura del comportamiento solicitado sin alterar funciones ajenas.", steps: ["Localiza el código y las pruebas relacionadas.", "Define casos normales, límites y errores.", "Propón pruebas y cambios mínimos para hacerlas pasar."] },
  { id: "update-docs", name: "Actualizar documentación", objective: "Actualiza la documentación para reflejar el comportamiento real del proyecto.", steps: ["Localiza los documentos y el código fuente relevante.", "Corrige contradicciones y añade instrucciones verificables.", "Enumera los archivos que cambiarías y resume cada cambio."] },
];

function validRecipe(value: unknown): value is TaskRecipe {
  if (!value || typeof value !== "object") return false;
  const recipe = value as Partial<TaskRecipe>;
  return typeof recipe.id === "string" && recipe.id.trim().length > 0 && recipe.id.length <= 80
    && typeof recipe.name === "string" && recipe.name.trim().length > 0 && recipe.name.length <= 60
    && typeof recipe.objective === "string" && recipe.objective.trim().length > 0 && recipe.objective.length <= 1200
    && Array.isArray(recipe.steps) && recipe.steps.length >= 1 && recipe.steps.length <= 12
    && recipe.steps.every((step) => typeof step === "string" && step.trim().length > 0 && step.length <= 240);
}

function loadRecipes(): TaskRecipe[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? "null";
    if (raw.length > 256_000) return DEFAULT_RECIPES;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1 || !Array.isArray((parsed as { recipes?: unknown }).recipes)) return DEFAULT_RECIPES;
    const uniqueIds = new Set<string>();
    const recipes = (parsed as { recipes: unknown[] }).recipes.filter((recipe): recipe is TaskRecipe => {
      if (!validRecipe(recipe) || uniqueIds.has(recipe.id)) return false;
      uniqueIds.add(recipe.id);
      return true;
    }).slice(0, MAX_RECIPES).map(({ id, name, objective, steps }) => ({ id, name, objective, steps: [...steps] }));
    return recipes.length ? recipes : DEFAULT_RECIPES;
  } catch {
    return DEFAULT_RECIPES;
  }
}

function recipePrompt(recipe: TaskRecipe): string {
  const steps = recipe.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  return `Usa esta receta como guía para preparar un plan de trabajo.\n\nObjetivo: ${recipe.objective}\n\nPasos a considerar:\n${steps}\n\nAnaliza el proyecto antes de proponer cambios. Presenta acciones pequeñas, con su motivo, y espera la aprobación de cada acción según los permisos configurados en Laural. No apliques cambios de archivo ni ejecutes operaciones con efectos sin aprobación.`;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `recipe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function TaskRecipes({ onClose, onUse }: { onClose: () => void; onUse: (prompt: string) => void }) {
  const [recipes, setRecipes] = useState(loadRecipes);
  const [selectedId, setSelectedId] = useState(recipes[0]?.id ?? "");
  const [editing, setEditing] = useState<TaskRecipe | null>(null);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const isEditing = editing !== null;
  const selected = useMemo(() => recipes.find((recipe) => recipe.id === selectedId) ?? recipes[0], [recipes, selectedId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isEditing) dialog.querySelector<HTMLInputElement>(".recipe-editor input")?.focus();
    else (dialog.querySelector<HTMLButtonElement>(".recipes-list button.selected") ?? dialog.querySelector<HTMLButtonElement>(".recipes-add"))?.focus();
  }, [isEditing, recipes.length, selectedId]);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const focusIsInside = document.activeElement instanceof Node && dialog.contains(document.activeElement);
    if (event.shiftKey && (!focusIsInside || document.activeElement === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!focusIsInside || document.activeElement === last)) {
      event.preventDefault();
      first.focus();
    }
  }

  function persist(next: TaskRecipe[]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, recipes: next }));
      setRecipes(next);
      setError("");
      return true;
    } catch {
      setError("No se pudo guardar la receta en este equipo. Comprueba el espacio disponible.");
      return false;
    }
  }

  function saveRecipe() {
    if (!editing) return;
    const name = editing.name.trim();
    const objective = editing.objective.trim();
    const steps = editing.steps.map((step) => step.trim()).filter(Boolean);
    if (!name || name.length > 60 || !objective || objective.length > 1200 || steps.length < 1 || steps.length > 12 || steps.some((step) => step.length > 240)) {
      setError("Completa nombre, objetivo y entre 1 y 12 pasos. Respeta los límites indicados.");
      return;
    }
    const nextRecipe = { ...editing, name, objective, steps };
    const next = recipes.some((recipe) => recipe.id === nextRecipe.id)
      ? recipes.map((recipe) => recipe.id === nextRecipe.id ? nextRecipe : recipe)
      : [...recipes, nextRecipe];
    if (next.length > MAX_RECIPES) {
      setError(`Puedes guardar hasta ${MAX_RECIPES} recetas.`);
      return;
    }
    if (persist(next)) {
      setSelectedId(nextRecipe.id);
      setEditing(null);
    }
  }

  function deleteRecipe() {
    if (!selected || !window.confirm(`¿Eliminar la receta «${selected.name}» de este equipo?`)) return;
    const next = recipes.filter((recipe) => recipe.id !== selected.id);
    if (persist(next)) setSelectedId(next[0]?.id ?? "");
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="recipes-dialog" role="dialog" aria-modal="true" aria-labelledby="recipes-title" tabIndex={-1} onKeyDown={handleDialogKeyDown}>
      <button className="dialog-close" onClick={onClose} aria-label="Cerrar recetas">×</button>
      <p className="eyebrow">AGENTE · SOLO EN ESTE EQUIPO</p><h2 id="recipes-title">Recetas de tareas</h2>
      <p className="dialog-copy">Plantillas para preparar planes repetibles. La receta no ejecuta acciones; cada cambio sigue sujeto a los permisos del agente.</p>
      <div className="recipes-layout">
        <nav className="recipes-list" aria-label="Recetas guardadas">
          {recipes.map((recipe) => <button aria-pressed={recipe.id === selected?.id} className={recipe.id === selected?.id ? "selected" : ""} key={recipe.id} onClick={() => { setSelectedId(recipe.id); setEditing(null); setError(""); }}>{recipe.name}</button>)}
          <button className="recipes-add" onClick={() => { setEditing({ id: newId(), name: "", objective: "", steps: [""] }); setError(""); }}>＋ Crear receta</button>
        </nav>
        {editing ? <div className="recipe-editor">
          <label className="form-label">Nombre <span id="recipe-name-limit" className="optional-label">máximo 60 caracteres</span><input aria-describedby="recipe-name-limit" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.currentTarget.value })} /></label>
          <label className="form-label">Objetivo <span id="recipe-objective-limit" className="optional-label">máximo 1.200 caracteres</span><textarea aria-describedby="recipe-objective-limit" rows={3} value={editing.objective} onChange={(event) => setEditing({ ...editing, objective: event.currentTarget.value })} /></label>
          <label className="form-label">Pasos <span id="recipe-steps-limit" className="optional-label">uno por línea, hasta 12 pasos y 240 caracteres por paso</span><textarea aria-describedby="recipe-steps-limit" rows={7} value={editing.steps.join("\n")} onChange={(event) => setEditing({ ...editing, steps: event.currentTarget.value.split("\n") })} /></label>
          <div className="recipes-actions"><button className="secondary-button" onClick={() => { setEditing(null); setError(""); }}>Cancelar</button><button className="primary-button" onClick={saveRecipe}>Guardar receta</button></div>
        </div> : selected ? <div className="recipe-preview">
          <h3>{selected.name}</h3><p>{selected.objective}</p><ol>{selected.steps.map((step, index) => <li key={`${selected.id}-${index}`}>{step}</li>)}</ol>
          <div className="recipe-preview-warning"><strong>Revisión obligatoria</strong><span>Laural mostrará el plan antes de aplicar archivos o ejecutar operaciones con efectos.</span></div>
          <div className="recipes-actions"><button className="secondary-button" onClick={deleteRecipe}>Eliminar</button><button className="secondary-button" onClick={() => setEditing({ ...selected })}>Editar</button><button className="primary-button" onClick={() => { onUse(recipePrompt(selected)); onClose(); }}>Usar receta</button></div>
        </div> : <p className="git-empty">No hay recetas guardadas. Crea una para empezar.</p>}
      </div>
      {error && <p className="recipes-error" role="alert">{error}</p>}
      <p className="recipes-privacy">Las recetas se guardan en este equipo. No se exportan ni se sincronizan.</p>
    </section>
  </div>;
}
