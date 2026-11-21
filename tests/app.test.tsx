// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../src/App";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), terminalPaneRenderCount: 0 }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../src/components/TerminalPane", async () => {
  const { memo } = await import("react");
  const MockTerminalPane = (props: { terminalId: string; onTextOutput: (id: string, text: string) => void; onCommandSubmit: (id: string, command: string) => void; onCommandFinish: (id: string, code: number) => void }) => {
    mocks.terminalPaneRenderCount += 1;
    return <div data-testid="terminal-pane">
      <button data-testid="begin-command" onClick={() => props.onCommandSubmit(props.terminalId, "git status")}>Iniciar comando</button>
      <button data-testid="output-one" onClick={() => props.onTextOutput(props.terminalId, "primera ")}>Salida uno</button>
      <button data-testid="output-two" onClick={() => props.onTextOutput(props.terminalId, "segunda")}>Salida dos</button>
      <button data-testid="output-final" onClick={() => props.onTextOutput(props.terminalId, " final")}>Salida final</button>
      <button data-testid="finish-command" onClick={() => props.onCommandFinish(props.terminalId, 0)}>Terminar comando</button>
    </div>;
  };
  return { default: memo(MockTerminalPane) };
});
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
  mocks.terminalPaneRenderCount = 0;
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
  expect(host.textContent).toContain("Los filtros no aíslan el shell.");
  await act(async () => buttonIncluding("Apariencia").click());

  expect(host.querySelectorAll(".theme-choice")).toHaveLength(12);
  await act(async () => buttonIncluding("Rubí").click());
  await act(async () => buttonIncluding("Oscuro").click());

  expect(localStorage.getItem("laural.theme")).toBe("ruby");
  expect(localStorage.getItem("laural.appearance")).toBe("dark");
  expect(document.documentElement.dataset.theme).toBe("ruby");
  expect(document.documentElement.dataset.mode).toBe("dark");

  await act(async () => root!.unmount());
  root = createRoot(host);
  await act(async () => root!.render(<App />));

  expect(document.documentElement.dataset.theme).toBe("ruby");
  expect(document.documentElement.dataset.mode).toBe("dark");
});

test("cambiar de proveedor descarta la clave en memoria del perfil anterior", async () => {
  const first = { id: "profile-a", name: "Proveedor A", baseUrl: "https://a.example/v1", model: "modelo-a", hasApiKey: true };
  const second = { id: "profile-b", name: "Proveedor B", baseUrl: "https://b.example/v1", model: "modelo-b", hasApiKey: true };
  let activeProvider = first;
  mocks.invoke.mockImplementation(async (command: string, args?: { providerId?: string }) => {
    if (command === "get_provider") return activeProvider;
    if (command === "get_providers") return [first, second];
    if (command === "select_provider") {
      activeProvider = args?.providerId === second.id ? second : first;
      return activeProvider;
    }
    if (command === "test_provider") return ["modelo-b"];
    if (command === "save_provider") {
      activeProvider = second;
      return second;
    }
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: ["git status", "git diff"], backupRetention: null };
    return undefined;
  });
  await act(async () => root!.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>(".toolbar-chip")!.click());

  const keyInput = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(keyInput, "clave-del-perfil-a");
    keyInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(keyInput.value).toBe("clave-del-perfil-a");

  const profileSelect = host.querySelector<HTMLSelectElement>(".provider-dialog select")!;
  const setSelectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  await act(async () => {
    setSelectValue.call(profileSelect, second.id);
    profileSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });

  expect(keyInput.value).toBe("");
  expect((host.querySelector<HTMLInputElement>('input[type="password"]')!).placeholder).toContain("Clave guardada");
  await act(async () => buttonIncluding("Probar conexión y modelos").click());
  const testCall = mocks.invoke.mock.calls.find(([command]) => command === "test_provider");
  expect(testCall?.[1]).toEqual({
    input: { id: second.id, name: second.name, baseUrl: second.baseUrl, model: second.model, apiKey: null },
  });

  await act(async () => buttonIncluding("Guardar proveedor").click());
  const saveCall = mocks.invoke.mock.calls.find(([command]) => command === "save_provider");
  expect(saveCall?.[1]).toEqual({
    input: { id: second.id, name: second.name, baseUrl: second.baseUrl, model: second.model, apiKey: null },
  });

  await act(async () => root!.unmount());
  root = createRoot(host);
  await act(async () => root!.render(<App />));
  expect(host.querySelector(".toolbar-chip")?.textContent).toContain("Proveedor B · modelo-b");
  await act(async () => host.querySelector<HTMLButtonElement>(".toolbar-chip")!.click());
  expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
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

test("agrupa fragmentos de salida y vacía el último lote al cerrar el bloque", async () => {
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Bloques").click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="begin-command"]')!.click());
  const rendersAfterCommandStart = mocks.terminalPaneRenderCount;

  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="output-one"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="output-two"]')!.click());
  expect(mocks.terminalPaneRenderCount).toBe(rendersAfterCommandStart);

  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 50)));
  expect(mocks.terminalPaneRenderCount).toBe(rendersAfterCommandStart);
  expect(host.querySelector(".command-block pre")?.textContent).toBe("primera segunda");

  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="output-final"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="finish-command"]')!.click());
  expect(host.querySelector(".command-block pre")?.textContent).toBe("primera segunda final");
  expect(host.querySelector(".block-exit")?.textContent).toBe("Salida 0");
  expect(mocks.terminalPaneRenderCount).toBe(rendersAfterCommandStart);
});

test("abre la paleta con Ctrl+K y copia un comando de la sesión sin ejecutarlo", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await act(async () => root!.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="begin-command"]')!.click());
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })));

  expect(host.querySelector('[role="dialog"][aria-labelledby="palette-title"]')).not.toBeNull();
  expect(host.textContent).toContain("Solo en esta sesión");
  await act(async () => buttonIncluding("git status").click());
  expect(writeText).toHaveBeenCalledWith("git status");
  expect(host.textContent).toContain("Comando copiado");
  expect(mocks.invoke).not.toHaveBeenCalledWith("run_command", expect.anything());
});

test("la paleta permite ir a una pestaña y cerrar con Escape", async () => {
  await act(async () => root!.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Nueva terminal"]')!.click());
  await act(async () => buttonIncluding("Command Prompt").click());
  await act(async () => buttonIncluding("Buscar comandos y sesiones").click());
  await act(async () => buttonIncluding("Ir a PowerShell").click());

  expect(host.querySelector('[role="dialog"][aria-labelledby="palette-title"]')).toBeNull();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("PowerShell");
  await act(async () => host.querySelector<HTMLButtonElement>(".search-button")!.click());
  await act(async () => host.querySelector(".command-palette")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector('[role="dialog"][aria-labelledby="palette-title"]')).toBeNull();
});

test("si el portapapeles no está disponible muestra el comando para copiarlo manualmente", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denegado")) } });
  await act(async () => root!.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="begin-command"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>(".search-button")!.click());
  await act(async () => buttonIncluding("git status").click());

  expect(host.textContent).toContain("copia el comando manualmente");
  expect(host.querySelector(".palette-fallback-command")?.textContent).toBe("git status");
});
