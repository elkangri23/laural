// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AgentActivity } from "../src/components/AgentActivity";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "get_agent_activity") return [{ timestampMs: 1_793_000_000_000, action: "comando", outcome: "completado" }];
    return undefined;
  });
  host = document.createElement("div");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

test("muestra solo metadatos y confirma antes de borrar el historial", async () => {
  root = createRoot(host);
  await act(async () => root!.render(<AgentActivity />));

  expect(host.textContent).toContain("Comando del agente");
  expect(host.textContent).toContain("completado");
  expect(host.textContent).not.toContain("D:/privado");
  expect(host.querySelectorAll("li")).toHaveLength(1);
  expect(mocks.invoke).toHaveBeenCalledWith("get_agent_activity");
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Actualizar")!.click());
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "get_agent_activity")).toHaveLength(2);

  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Borrar historial")!.click());
  expect(host.textContent).toContain("¿Borrar el historial de actividad?");
  expect(mocks.invoke).not.toHaveBeenCalledWith("clear_agent_activity");

  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Cancelar")!.click());
  expect(host.textContent).not.toContain("¿Borrar el historial de actividad?");

  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Borrar historial")!.click());
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Sí, borrar")!.click());
  expect(mocks.invoke).toHaveBeenCalledWith("clear_agent_activity");
  expect(host.querySelectorAll("li")).toHaveLength(0);
});

test("informa si no puede consultar la actividad", async () => {
  mocks.invoke.mockRejectedValue(new Error("fallo de prueba"));
  root = createRoot(host);
  await act(async () => root!.render(<AgentActivity />));
  expect(host.textContent).toContain("No se pudo cargar el historial local.");
  const clearButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "Borrar historial")!;
  expect(clearButton.disabled).toBe(false);
  await act(async () => clearButton.click());
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Sí, borrar")!.click());
  expect(host.textContent).toContain("No se pudo borrar el historial local.");
});
