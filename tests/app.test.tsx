// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../src/App";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../src/components/TerminalPane", () => ({ default: () => <div data-testid="terminal-pane" /> }));
vi.mock("../src/components/UpdateManager", () => ({ UpdateManager: () => null }));
vi.mock("../src/components/AgentActivity", () => ({ AgentActivity: () => null }));
vi.mock("../src/components/BackupRetentionControl", () => ({ BackupRetentionControl: () => null }));
vi.mock("../src/components/SettingsDialog", () => ({
  SettingsDialog: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => (
    <div role="dialog" aria-label="Configuración">
      <button aria-label="Cerrar configuración" onClick={onClose}>Cerrar</button>
      {children}
    </div>
  ),
}));

let root: Root | undefined;
let host: HTMLDivElement;

function buttonIncluding(text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`No se encontró el botón: ${text}`);
  return button;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "get_provider") return null;
    if (command === "get_providers") return [];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: ["git status", "git diff"], backupRetention: null };
    return undefined;
  });
  mocks.open.mockReset();
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

test("recupera y guarda el tema y el modo desde Configuración", async () => {
  localStorage.setItem("laural.theme", "ocean");
  localStorage.setItem("laural.appearance", "light");
  await act(async () => root!.render(<App />));

  expect(document.documentElement.dataset.theme).toBe("ocean");
  expect(document.documentElement.dataset.mode).toBe("light");
  expect(host.querySelectorAll('[data-testid="terminal-pane"]')).toHaveLength(1);

  await act(async () => buttonIncluding("Configuración").click());
  await act(async () => buttonIncluding("Apariencia").click());

  expect(host.querySelectorAll(".theme-choice")).toHaveLength(12);
  await act(async () => buttonIncluding("Rubí").click());
  await act(async () => buttonIncluding("Oscuro").click());

  expect(localStorage.getItem("laural.theme")).toBe("ruby");
  expect(localStorage.getItem("laural.appearance")).toBe("dark");
  expect(document.documentElement.dataset.theme).toBe("ruby");
  expect(document.documentElement.dataset.mode).toBe("dark");
});

test("crea una pestaña del shell elegido y alterna la división de terminal", async () => {
  await act(async () => root!.render(<App />));

  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Nueva terminal"]')!.click());
  await act(async () => buttonIncluding("Command Prompt").click());
  expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("PowerShell"), expect.stringContaining("Command Prompt")]));
  expect(host.querySelectorAll('[data-testid="terminal-pane"]')).toHaveLength(2);

  const split = host.querySelector<HTMLButtonElement>('[aria-label="Dividir panel"]')!;
  await act(async () => split.click());
  expect(host.querySelector<HTMLButtonElement>('[aria-label^="División vertical"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label^="División vertical"]')!.click());
  expect(host.querySelector<HTMLButtonElement>('[aria-label^="División horizontal"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label^="División horizontal"]')!.click());
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Dividir panel"]')).not.toBeNull();
});
