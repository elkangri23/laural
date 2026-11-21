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
  localStorage.clear();
  onClose.mockReset();
  onUse.mockReset();
  vi.stubGlobal("confirm", vi.fn(() => true));
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
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
