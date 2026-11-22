// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TaskRecipes } from "../src/components/TaskRecipes";

let root: Root | undefined;
let host: HTMLDivElement;
const onClose = vi.fn();
const onUse = vi.fn();

function button(text: string): HTMLButtonElement {
  const result = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  if (!(result instanceof HTMLButtonElement)) throw new Error(`No se encontró el botón: ${text}`);
  return result;
}

async function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  onClose.mockReset();
  onUse.mockReset();
  vi.stubGlobal("confirm", vi.fn(() => true));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("previsualiza una receta y prepara un prompt sin ejecutarlo", async () => {
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  expect(host.textContent).toContain("Revisar un proyecto");
  await act(async () => button("Usar receta").click());
  expect(onUse).toHaveBeenCalledOnce();
  expect(onUse.mock.calls[0][0]).toContain("1. Identifica la estructura y tecnologías principales.");
  expect(onUse.mock.calls[0][0]).toContain("espera la aprobación de cada acción");
  expect(onClose).toHaveBeenCalledOnce();
});

test("crea recetas locales y las conserva en el almacenamiento del equipo", async () => {
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  await act(async () => button("Crear receta").click());
  const fields = host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".recipe-editor input, .recipe-editor textarea");
  await setValue(fields[0], "Revisión de dependencias");
  await setValue(fields[1], "Comprueba dependencias vulnerables sin cambiarlas.");
  await setValue(fields[2], "Revisa manifiestos y lockfiles.\nResume versiones con avisos.");
  await act(async () => button("Guardar receta").click());

  const stored = JSON.parse(localStorage.getItem("laural.task-recipes.v1") ?? "{}");
  const saved = stored.recipes.find((recipe: { name: string }) => recipe.name === "Revisión de dependencias");
  expect(saved.steps).toHaveLength(2);
  expect(host.textContent).toContain("Revisión de dependencias");
});

test("conserva una receta creada al cerrar y volver a abrir el panel", async () => {
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  await act(async () => button("Crear receta").click());
  const fields = host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".recipe-editor input, .recipe-editor textarea");
  await setValue(fields[0], "Verificar licencias");
  await setValue(fields[1], "Revisa las licencias declaradas en el proyecto.");
  await setValue(fields[2], "Localiza manifiestos de dependencias.\nResume las licencias encontradas.");
  await act(async () => button("Guardar receta").click());
  await act(async () => root!.unmount());
  root = createRoot(host);

  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  await act(async () => button("Verificar licencias").click());
  expect(host.querySelector(".recipe-preview h3")?.textContent).toBe("Verificar licencias");
  expect(host.querySelector(".recipe-preview")?.textContent).toContain("Resume las licencias encontradas.");
});

test("descarta entradas inválidas guardadas y limita el contenido a texto", async () => {
  localStorage.setItem("laural.task-recipes.v1", JSON.stringify({ version: 1, recipes: [{ id: "x", name: "", objective: "", steps: [] }] }));
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  expect(host.textContent).toContain("Revisar un proyecto");
  expect(host.querySelector("script")).toBeNull();
});

test("valida la receta antes de guardarla", async () => {
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  await act(async () => button("Crear receta").click());
  await act(async () => button("Guardar receta").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Completa nombre, objetivo");
  expect(localStorage.getItem("laural.task-recipes.v1")).toBeNull();
});

test("anuncia la receta seleccionada y los límites de edición", async () => {
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  const recipes = host.querySelectorAll<HTMLButtonElement>(".recipes-list button:not(.recipes-add)");
  expect(recipes[0].getAttribute("aria-pressed")).toBe("true");
  expect(recipes[1].getAttribute("aria-pressed")).toBe("false");
  await act(async () => recipes[1].click());
  expect(recipes[0].getAttribute("aria-pressed")).toBe("false");
  expect(recipes[1].getAttribute("aria-pressed")).toBe("true");

  await act(async () => button("Crear receta").click());
  const fields = host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".recipe-editor input, .recipe-editor textarea");
  expect(fields[0].getAttribute("aria-describedby")).toBe("recipe-name-limit");
  expect(host.querySelector("#recipe-name-limit")?.textContent).toContain("60 caracteres");
  expect(fields[1].getAttribute("aria-describedby")).toBe("recipe-objective-limit");
  expect(host.querySelector("#recipe-objective-limit")?.textContent).toContain("1.200 caracteres");
  expect(fields[2].getAttribute("aria-describedby")).toBe("recipe-steps-limit");
  expect(host.querySelector("#recipe-steps-limit")?.textContent).toContain("240 caracteres por paso");
});

test("acepta todos los límites máximos documentados", async () => {
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  await act(async () => button("Crear receta").click());
  const fields = host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".recipe-editor input, .recipe-editor textarea");
  const steps = Array.from({ length: 12 }, () => "p".repeat(240)).join("\n");
  await setValue(fields[0], "n".repeat(60));
  await setValue(fields[1], "o".repeat(1200));
  await setValue(fields[2], steps);
  await act(async () => button("Guardar receta").click());

  const saved = JSON.parse(localStorage.getItem("laural.task-recipes.v1") ?? "{}").recipes.at(-1);
  expect(saved.name).toHaveLength(60);
  expect(saved.objective).toHaveLength(1200);
  expect(saved.steps).toHaveLength(12);
  expect(saved.steps[11]).toHaveLength(240);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

test("rechaza pasos que superan el límite de caracteres", async () => {
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  await act(async () => button("Crear receta").click());
  const fields = host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".recipe-editor input, .recipe-editor textarea");
  await setValue(fields[0], "Paso demasiado largo");
  await setValue(fields[1], "Objetivo de prueba.");
  await setValue(fields[2], "p".repeat(241));
  await act(async () => button("Guardar receta").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("entre 1 y 12 pasos");
  expect(localStorage.getItem("laural.task-recipes.v1")).toBeNull();
});

test("conserva pasos pegados por encima del límite y no guarda hasta corregirlos", async () => {
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  await act(async () => button("Crear receta").click());
  const fields = host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".recipe-editor input, .recipe-editor textarea");
  await setValue(fields[0], "Receta con pasos pegados");
  await setValue(fields[1], "Objetivo de prueba.");
  const pastedSteps = Array.from({ length: 13 }, (_, index) => `Paso ${index + 1}`).join("\n");
  await setValue(fields[2], pastedSteps);
  await act(async () => button("Guardar receta").click());

  expect(fields[2].value.split("\n")).toHaveLength(13);
  expect(fields[2].value).toContain("Paso 13");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("entre 1 y 12 pasos");
  expect(localStorage.getItem("laural.task-recipes.v1")).toBeNull();

  await setValue(fields[2], pastedSteps.split("\n").slice(0, 12).join("\n"));
  await act(async () => button("Guardar receta").click());
  expect(JSON.parse(localStorage.getItem("laural.task-recipes.v1") ?? "{}").recipes.at(-1).steps).toHaveLength(12);
});

test("conserva campos pegados por encima de sus límites y bloquea el guardado", async () => {
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  await act(async () => button("Crear receta").click());
  const fields = host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".recipe-editor input, .recipe-editor textarea");
  const longName = "n".repeat(61);
  const longObjective = "o".repeat(1201);
  const longStep = "p".repeat(241);
  await setValue(fields[0], longName);
  await setValue(fields[1], longObjective);
  await setValue(fields[2], longStep);
  await act(async () => button("Guardar receta").click());

  expect(fields[0].value).toBe(longName);
  expect(fields[1].value).toBe(longObjective);
  expect(fields[2].value).toBe(longStep);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Respeta los límites indicados");
  expect(localStorage.getItem("laural.task-recipes.v1")).toBeNull();

  await setValue(fields[0], longName.slice(0, 60));
  await setValue(fields[1], longObjective.slice(0, 1200));
  await setValue(fields[2], longStep.slice(0, 240));
  await act(async () => button("Guardar receta").click());
  const saved = JSON.parse(localStorage.getItem("laural.task-recipes.v1") ?? "{}").recipes.at(-1);
  expect(saved.name).toHaveLength(60);
  expect(saved.objective).toHaveLength(1200);
  expect(saved.steps[0]).toHaveLength(240);
});

test("edita y elimina una receta con confirmación", async () => {
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  await act(async () => button("Editar").click());
  const fields = host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".recipe-editor input, .recipe-editor textarea");
  await setValue(fields[0], "Revisión de proyecto actualizada");
  await setValue(fields[1], "Busca errores en el código seleccionado.");
  await setValue(fields[2], "Localiza módulos relevantes.");
  await act(async () => button("Guardar receta").click());
  expect(host.textContent).toContain("Revisión de proyecto actualizada");

  vi.stubGlobal("confirm", vi.fn(() => false));
  await act(async () => button("Eliminar").click());
  expect(host.textContent).toContain("Revisión de proyecto actualizada");
  vi.stubGlobal("confirm", vi.fn(() => true));
  await act(async () => button("Eliminar").click());
  expect(host.textContent).not.toContain("Revisión de proyecto actualizada");
});

test("devuelve el foco a crear receta al eliminar la última receta", async () => {
  localStorage.setItem("laural.task-recipes.v1", JSON.stringify({
    version: 1,
    recipes: [{ id: "only", name: "Única", objective: "Objetivo.", steps: ["Paso."] }],
  }));
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  await act(async () => button("Eliminar").click());
  expect(host.textContent).toContain("No hay recetas guardadas");
  expect(document.activeElement).toBe(button("Crear receta"));
});

test("restaura las recetas iniciales ante JSON corrupto o demasiado grande", async () => {
  localStorage.setItem("laural.task-recipes.v1", "{");
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  expect(host.textContent).toContain("Revisar un proyecto");
  await act(async () => root!.unmount());
  root = createRoot(host);
  localStorage.setItem("laural.task-recipes.v1", "x".repeat(256_001));
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  expect(host.textContent).toContain("Revisar un proyecto");
});

test("avisa si no puede guardar cambios en el almacenamiento local", async () => {
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  await act(async () => button("Crear receta").click());
  const fields = host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".recipe-editor input, .recipe-editor textarea");
  await setValue(fields[0], "Receta temporal");
  await setValue(fields[1], "Objetivo de prueba.");
  await setValue(fields[2], "Un paso.");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("cuota"); });
  await act(async () => button("Guardar receta").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("No se pudo guardar la receta");
});

test("no supera el límite de treinta recetas", async () => {
  const recipes = Array.from({ length: 30 }, (_, index) => ({ id: `recipe-${index}`, name: `Receta ${index}`, objective: "Objetivo.", steps: ["Paso."] }));
  localStorage.setItem("laural.task-recipes.v1", JSON.stringify({ version: 1, recipes }));
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  await act(async () => button("Crear receta").click());
  const fields = host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".recipe-editor input, .recipe-editor textarea");
  await setValue(fields[0], "Receta extra");
  await setValue(fields[1], "Objetivo adicional.");
  await setValue(fields[2], "Un paso.");
  await act(async () => button("Guardar receta").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("hasta 30 recetas");
  expect(JSON.parse(localStorage.getItem("laural.task-recipes.v1") ?? "{}").recipes).toHaveLength(30);
});

test("cierra el diálogo con Escape o al pulsar fuera", async () => {
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  await act(async () => host.querySelector(".recipes-dialog")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => host.querySelector(".dialog-backdrop")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("mantiene el foco dentro del diálogo y enfoca el formulario al editar", async () => {
  await act(async () => root!.render(<TaskRecipes onClose={onClose} onUse={onUse} />));
  const dialog = host.querySelector<HTMLElement>(".recipes-dialog")!;
  const first = dialog.querySelector<HTMLButtonElement>(".dialog-close")!;
  const buttons = dialog.querySelectorAll<HTMLButtonElement>("button");
  const last = buttons[buttons.length - 1];
  expect(document.activeElement).toBe(host.querySelector(".recipes-list button.selected"));

  await act(async () => first.focus());
  await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
  expect(document.activeElement).toBe(last);
  await act(async () => last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
  expect(document.activeElement).toBe(first);

  await act(async () => button("Editar").click());
  expect(document.activeElement).toBe(host.querySelector(".recipe-editor input"));
});
