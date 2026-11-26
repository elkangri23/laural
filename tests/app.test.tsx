// @vitest-environment jsdom
import { act, Profiler, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../src/App";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), listen: vi.fn(), deferTerminalPaneImport: false, resolveTerminalPaneImport: null as (() => void) | null, terminalPaneRenderCount: 0, terminalRequests: [] as Array<{ terminalId: string; copySequence: number; copyTarget: string; clearSequence: number; clearTarget: string; powerShellPredictionEnabled: boolean }>, agentFinishCallbacks: [] as Array<(terminalId: string, token: string, exitCode: number | null) => void> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../src/components/TerminalPane", async () => {
  if (mocks.deferTerminalPaneImport) {
    await new Promise<void>((resolve) => { mocks.resolveTerminalPaneImport = resolve; });
  }
  const { memo } = await import("react");
  const MockTerminalPane = (props: { terminalId: string; copyRequest: { sequence: number; terminalId: string }; clearRequest: { sequence: number; terminalId: string }; powerShellPredictionEnabled: boolean; onTextOutput: (id: string, text: string) => void; onCommandSubmit: (id: string, command: string) => void; onCommandFinish: (id: string, code: number | null) => void; onAgentCommandFinish: (id: string, token: string, code: number | null) => void }) => {
    mocks.terminalPaneRenderCount += 1;
    mocks.agentFinishCallbacks.push(props.onAgentCommandFinish);
    mocks.terminalRequests.push({ terminalId: props.terminalId, copySequence: props.copyRequest.sequence, copyTarget: props.copyRequest.terminalId, clearSequence: props.clearRequest.sequence, clearTarget: props.clearRequest.terminalId, powerShellPredictionEnabled: props.powerShellPredictionEnabled });
    return <div data-testid="terminal-pane">
      <button data-testid="begin-command" onClick={() => props.onCommandSubmit(props.terminalId, "git status")}>Iniciar comando</button>
      <button data-testid="output-one" onClick={() => props.onTextOutput(props.terminalId, "primera ")}>Salida uno</button>
      <button data-testid="output-two" onClick={() => props.onTextOutput(props.terminalId, "segunda")}>Salida dos</button>
      <button data-testid="output-final" onClick={() => props.onTextOutput(props.terminalId, " final")}>Salida final</button>
      <button data-testid="finish-command" onClick={() => props.onCommandFinish(props.terminalId, 0)}>Terminar comando</button>
      <button data-testid="finish-command-unknown" onClick={() => props.onCommandFinish(props.terminalId, null)}>Finalizar sin código</button>
    </div>;
  };
  return { default: memo(MockTerminalPane) };
});
vi.mock("../src/components/UpdateManager", () => ({
  UpdateManager: ({ settingsOpen, onSettingsClose }: { settingsOpen: boolean; onSettingsClose: () => void }) => settingsOpen
    ? <div role="dialog" aria-label="Actualizaciones"><button aria-label="Cerrar actualizaciones" onClick={onSettingsClose}>Cerrar</button></div>
    : null,
}));
vi.mock("../src/components/AgentActivity", () => ({ AgentActivity: () => null }));
vi.mock("../src/components/BackupRetentionControl", () => ({ BackupRetentionControl: () => null }));
vi.mock("../src/components/ModalShell", () => ({
  ModalShell: ({ children, onClose, title = "Configuración" }: { children: ReactNode; onClose: () => void; title?: string }) => <div role="dialog" aria-label={title}><button aria-label={`Cerrar ${title.toLowerCase()}`} onClick={onClose}>Cerrar</button>{children}</div>,
}));
vi.mock("../src/components/SettingsDialog", () => ({
  SettingsDialog: ({ sections, activeCategory, onClose, onCategoryChange }: { sections: Record<string, ReactNode>; activeCategory: string; onClose: () => void; onCategoryChange: (category: string) => void }) => (
    <div role="dialog" aria-label="Configuración">
      <button aria-label="Cerrar configuración" onClick={onClose}>Cerrar</button>
      <nav aria-label="Categorías de configuración">{Object.keys(sections).map((category) => <button key={category} onClick={() => onCategoryChange(category)}>{category}</button>)}</nav>
      {sections[activeCategory]}
    </div>
  ),
}));

let root: Root | undefined;
let host: HTMLDivElement;

function buttonIncluding(text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) {
    const available = [...host.querySelectorAll("button")].map((candidate) => candidate.textContent?.trim()).filter(Boolean).join(" | ");
    throw new Error(`No se encontró el botón: ${text}. Botones: ${available}. Texto: ${host.textContent?.trim()}`);
  }
  return button;
}

async function waitForLazyUi(): Promise<void> {
  await act(async () => {
    await Promise.all([
      import("../src/components/AccountSettings"),
      import("../src/components/AgentSettings"),
      import("../src/components/AgentActivity"),
      import("../src/components/AssistantMarkdown"),
      import("../src/components/BackupRetentionControl"),
      import("../src/components/CommandPalette"),
      import("../src/components/ConfigurationTransfer"),
      import("../src/components/GitPanel"),
      import("../src/components/TaskRecipes"),
      import("../src/components/TerminalPane"),
    ]);
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("laural.language.v1", "es");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "get_provider") return null;
    if (command === "get_providers") return [];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: ["git status", "git diff"], backupRetention: null };
    return undefined;
  });
  mocks.open.mockReset();
  mocks.listen.mockReset().mockImplementation(async () => () => undefined);
  mocks.deferTerminalPaneImport = false;
  mocks.resolveTerminalPaneImport = null;
  mocks.terminalPaneRenderCount = 0;
  mocks.terminalRequests.length = 0;
  mocks.agentFinishCallbacks.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("localiza el estado accesible mientras se carga la terminal en inglés", async () => {
  localStorage.setItem("laural.language.v1", "en");
  mocks.deferTerminalPaneImport = true;
  await act(async () => {
    root!.render(<App />);
    await Promise.resolve();
  });

  try {
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Starting terminal…");
  } finally {
    await act(async () => {
      mocks.resolveTerminalPaneImport?.();
      await Promise.resolve();
    });
    mocks.deferTerminalPaneImport = false;
  }
  await act(async () => { await import("../src/components/TerminalPane"); });
  expect(host.querySelector('[data-testid="terminal-pane"]')).not.toBeNull();
});

test("recupera y guarda el tema desde la categoría Personalización", async () => {
  localStorage.setItem("laural.theme", "ocean");
  localStorage.setItem("laural.appearance", "light");
  await act(async () => root!.render(<App />));

  expect(document.documentElement.dataset.theme).toBe("ocean");
  expect(document.documentElement.dataset.mode).toBe("light");
  expect(host.querySelectorAll('[data-testid="terminal-pane"]')).toHaveLength(1);

  await act(async () => buttonIncluding("Personalización").click());
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

test("detecta la preferencia local de idioma y permite cambiarla desde Personalización", async () => {
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Personalización").click());

  const languageSelect = host.querySelector<HTMLSelectElement>('select[aria-label="Idioma de la interfaz"]')!;
  expect(languageSelect.value).toBe("es");
  await act(async () => {
    languageSelect.value = "en";
    languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });

  expect(localStorage.getItem("laural.language.v1")).toBe("en");
  expect(host.textContent).toContain("Interface language");
  expect(host.textContent).toContain("Personalization");
});

test("localiza el shell, el diálogo de proveedor y la selección de temas", async () => {
  localStorage.setItem("laural.language.v1", "en");
  await act(async () => root!.render(<App />));

  expect(host.textContent).toContain("Personal workspace");
  expect(host.textContent).toContain("AI assistant");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')!.click());
  expect(host.textContent).toContain("Open project folder");
  await act(async () => buttonIncluding("Configure AI provider").click());
  expect(host.textContent).toContain("Connect your provider");
  expect(host.textContent).toContain("The key is never written to the configuration file.");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());

  await act(async () => buttonIncluding("Personalization").click());
  await act(async () => buttonIncluding("Appearance").click());
  expect(host.textContent).toContain("Themes");
  expect(host.querySelectorAll(".theme-choice")).toHaveLength(12);
  expect(host.textContent).toContain("Ocean");
});

test("al cerrar Cuenta vuelve a la categoría Datos desde la que se abrió", async () => {
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Personalización").click());
  await act(async () => buttonIncluding("data").click());
  await act(async () => buttonIncluding("Cuenta y sincronización").click());
  await act(async () => import("../src/components/AccountSettings"));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Cerrar cuenta y sincronización"]')!.click());
  expect(host.querySelector('[aria-label="Configuración"]')).not.toBeNull();
  expect(host.textContent).toContain("Importar y exportar");
});

test("navega por IA, Agente y Aplicación y conserva la categoría al volver", async () => {
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Personalización").click());
  await act(async () => buttonIncluding("ai").click());
  expect(host.textContent).toContain("Inteligencia artificial");
  await act(async () => buttonIncluding("Proveedores y modelos").click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Cerrar"]')!.click());
  expect(host.textContent).toContain("Proveedores y modelos");

  await act(async () => buttonIncluding("agent").click());
  await act(async () => import("../src/components/AgentSettings"));
  expect(host.querySelector(".agent-policy-panel")).not.toBeNull();
  const prediction = host.querySelector<HTMLInputElement>(".powershell-prediction-setting input")!;
  expect(prediction.checked).toBe(false);
  expect(mocks.terminalRequests.at(-1)?.powerShellPredictionEnabled).toBe(false);
  await act(async () => prediction.click());
  expect(localStorage.getItem("laural.powershell-prediction.v1")).toBe("true");
  expect(mocks.terminalRequests.at(-1)?.powerShellPredictionEnabled).toBe(true);
  await act(async () => buttonIncluding("application").click());
  await act(async () => buttonIncluding("Actualizaciones").click());
  expect(host.querySelector('[aria-label="Actualizaciones"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Cerrar actualizaciones"]')!.click());
  expect(host.querySelector('[aria-label="Configuración"]')).not.toBeNull();
  expect(host.textContent).toContain("Actualizaciones");
});

test("traduce el encabezado de permisos del agente al inglés", async () => {
  localStorage.setItem("laural.language.v1", "en");
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Personalization").click());
  await act(async () => buttonIncluding("agent").click());
  await act(async () => import("../src/components/AgentSettings"));

  expect(host.querySelector("#settings-agent-title")?.textContent).toBe("Agent and terminal");
});

test("la tarjeta lateral refleja el proveedor activo", async () => {
  const provider = { id: "freellm", providerKind: "freellmapi", name: "FreeLLMAPI", baseUrl: "http://127.0.0.1:31415/v1", model: "auto", hasApiKey: true, shareCustomEndpoint: false };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return provider;
    if (command === "get_providers") return [provider];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: ["git status", "git diff"], backupRetention: null };
    return undefined;
  });
  await act(async () => root!.render(<App />));
  await act(async () => { await Promise.resolve(); });

  expect(host.querySelector(".plan-card strong")?.textContent).toBe("FreeLLMAPI");
  expect(host.querySelector(".plan-card p")?.textContent).toBe("Modelo: auto");
  expect(host.textContent).not.toContain("Conecta tu modelo");
});

test("fuerza el guardado del historial del chat antes de ocultar la ventana", async () => {
  const history = [{ role: "user", content: "mensaje pendiente" }];
  localStorage.setItem("laural.chat.v1", JSON.stringify(history));
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  await act(async () => root!.render(<App />));

  expect(setItem.mock.calls.filter(([key]) => key === "laural.chat.v1")).toHaveLength(0);
  await act(async () => window.dispatchEvent(new Event("pagehide")));

  expect(setItem).toHaveBeenCalledWith("laural.chat.v1", JSON.stringify(history));
});

test("no inicia sincronización automática sin aceptar el riesgo del VPS", async () => {
  await act(async () => root!.render(<App />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1_600)); });

  expect(mocks.invoke).not.toHaveBeenCalledWith("get_preference_snapshot", expect.anything());
  expect(mocks.invoke).not.toHaveBeenCalledWith("sync_local_preferences", expect.anything());
});

test("reanuda la comprobación pendiente al recuperar la red", async () => {
  localStorage.setItem("laural.sync-risk-ack.v1", "true");
  await act(async () => root!.render(<App />));
  mocks.invoke.mockClear();

  await act(async () => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  expect(mocks.invoke).toHaveBeenCalledWith("get_preference_snapshot", expect.anything());
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "get_preference_snapshot")).toHaveLength(1);
  expect(mocks.invoke).toHaveBeenCalledWith("sync_local_preferences", expect.anything());
});

test("muestra estados de sincronización pendiente, conflicto y error", async () => {
  localStorage.setItem("laural.sync-risk-ack.v1", "true");
  let syncAttempt = 0;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return null;
    if (command === "get_providers") return [];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: null };
    if (command === "get_preference_snapshot") return { schemaVersion: 1, preferences: { themeId: "laurel", appearance: "dark", updateMode: "manual" }, activeProviderId: null, providers: [] };
    if (command === "sync_local_preferences") {
      syncAttempt += 1;
      if (syncAttempt === 1) return { status: "pending" };
      if (syncAttempt === 2) return { status: "conflict" };
      throw new Error("sync unavailable");
    }
    return undefined;
  });
  await act(async () => root!.render(<App />));
  const sync = async () => act(async () => {
    window.dispatchEvent(new Event("laural:account-connected"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  await sync();
  expect(host.textContent).toContain("Cambios locales guardados");
  await sync();
  expect(host.textContent).toContain("han cambiado");
  await sync();
  expect(host.textContent).toContain("No se pudo comprobar la sincronización");
  await act(async () => window.dispatchEvent(new Event("laural:account-disconnected")));
});

test("detiene una planificación del agente pendiente antes de preparar el plan", async () => {
  let resolvePlan: ((plan: { summary: string; actions: [] }) => void) | undefined;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return { id: "local", name: "Local", model: "test" };
    if (command === "get_providers") return [{ id: "local", name: "Local", model: "test" }];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: null };
    if (command === "plan_agent") return new Promise((resolve) => { resolvePlan = resolve; });
    if (command === "cancel_agent_plan") return undefined;
    return undefined;
  });
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Agente").click());
  const composer = host.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(composer, "revisa este entorno");
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLFormElement>(".composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => buttonIncluding("Detener agente").click());
  expect(mocks.invoke).toHaveBeenCalledWith("cancel_agent_plan", expect.objectContaining({ requestId: expect.any(String) }));
  await act(async () => resolvePlan?.({ summary: "tarea cancelada", actions: [] }));
  expect(host.textContent).not.toContain("tarea cancelada");
});

test("detiene una respuesta de chat y cancela su solicitud activa", async () => {
  let finishRequest: (() => void) | undefined;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return { id: "local", name: "Local", model: "test" };
    if (command === "get_providers") return [{ id: "local", name: "Local", model: "test" }];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: null };
    if (command === "send_chat_stream") return new Promise<void>((resolve) => { finishRequest = resolve; });
    if (command === "cancel_chat_stream") return undefined;
    return undefined;
  });
  await act(async () => root!.render(<App />));
  const composer = host.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(composer, "resume una tarea");
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLFormElement>(".composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const request = mocks.invoke.mock.calls.find(([command]) => command === "send_chat_stream")?.[1];
  await act(async () => buttonIncluding("Detener").click());
  expect(mocks.invoke).toHaveBeenCalledWith("cancel_chat_stream", { requestId: request?.requestId });
  await act(async () => finishRequest?.());
});

test("el menú general gestiona el foco, las flechas y Escape", async () => {
  await act(async () => root!.render(<App />));

  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Abrir menú"]')!.click());
  expect(host.querySelector('[role="menu"][aria-label="Menú de Laural"]')).not.toBeNull();
  const menuItems = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].slice(0, 6);
  expect(document.activeElement).toBe(menuItems[0]);

  await act(async () => menuItems[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement).toBe(menuItems[1]);
  await act(async () => menuItems[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(document.activeElement).toBe(menuItems[5]);
  await act(async () => menuItems[5].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  expect(document.activeElement).toBe(menuItems[0]);

  await act(async () => buttonIncluding("Configurar proveedor de IA").click());
  expect(host.querySelector(".provider-dialog h2")?.textContent).toBe("Conecta tu proveedor");
  expect(host.querySelector('[role="menu"][aria-label="Menú de Laural"]')).toBeNull();

  await act(async () => host.querySelector<HTMLButtonElement>('.provider-dialog [aria-label="Cerrar"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Abrir menú"]')!.click());
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector('[role="menu"][aria-label="Menú de Laural"]')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('[aria-label="Abrir menú"]'));
});

test("el diff Git requiere selección explícita y aparece en la vista previa del contexto", async () => {
  const diff = "diff --git a/README.md b/README.md\n+contenido de ejemplo";
  mocks.open.mockResolvedValue("C:/proyecto");
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return null;
    if (command === "get_providers") return [];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: ["git status", "git diff"], backupRetention: null };
    if (command === "get_git_status") return { root: "C:/proyecto", branch: "main", changes: [] };
    if (command === "get_git_diff") return { content: diff, truncated: false };
    if (command === "preview_context") return { terminal: "", project: "", selectedFiles: "", gitDiff: diff, totalCharacters: diff.length };
    return undefined;
  });
  await act(async () => root!.render(<App />));

  await act(async () => host.querySelector<HTMLButtonElement>(".git-toolbar-button")!.click());
  await waitForLazyUi();
  await act(async () => buttonIncluding("Abrir proyecto").click());
  await waitForLazyUi();
  await act(async () => host.querySelector<HTMLButtonElement>(".git-toolbar-button")!.click());
  await waitForLazyUi();
  expect(mocks.invoke).not.toHaveBeenCalledWith("preview_context", expect.anything());
  await act(async () => (host.querySelector<HTMLButtonElement>(".git-include-diff")!).click());
  expect(host.textContent).toContain("Diff Git");

  await act(async () => buttonIncluding("Revisar contexto").click());
  const previewCall = mocks.invoke.mock.calls.find(([command]) => command === "preview_context");
  expect(previewCall?.[1]).toMatchObject({ gitDiffContext: diff });
  expect(host.textContent).toContain("Diff Git seleccionado");
  expect(host.textContent).toContain(diff);
});

test("localiza en inglés la etiqueta del diff Git añadido al contexto", async () => {
  localStorage.setItem("laural.language.v1", "en");
  const diff = "diff --git a/README.md b/README.md\n+example content";
  mocks.open.mockResolvedValue("C:/project");
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return null;
    if (command === "get_providers") return [];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: ["git status", "git diff"], backupRetention: null };
    if (command === "get_git_status") return { root: "C:/project", branch: "main", changes: [] };
    if (command === "get_git_diff") return { content: diff, truncated: false };
    return undefined;
  });
  await act(async () => root!.render(<App />));

  await act(async () => host.querySelector<HTMLButtonElement>(".git-toolbar-button")!.click());
  await waitForLazyUi();
  await act(async () => buttonIncluding("Open project").click());
  await waitForLazyUi();
  await act(async () => host.querySelector<HTMLButtonElement>(".git-toolbar-button")!.click());
  await waitForLazyUi();
  await act(async () => host.querySelector<HTMLButtonElement>(".git-include-diff")!.click());

  expect(host.textContent).toContain("Selected Git diff");
});

test("usar una receta activa el modo Agente y prepara el compositor sin enviarlo", async () => {
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Agente").click());
  await act(async () => buttonIncluding("Recetas").click());
  await waitForLazyUi();
  await act(async () => buttonIncluding("Usar receta").click());

  const composer = host.querySelector<HTMLTextAreaElement>(".composer textarea");
  expect(composer?.value).toContain("Objetivo: Revisa el proyecto");
  expect(composer?.value).toContain("espera la aprobación de cada acción");
  expect(host.querySelector('[aria-label="Modo de IA"] [role="tab"][aria-selected="true"]')?.textContent).toContain("Agente");
  expect(mocks.invoke).not.toHaveBeenCalledWith("plan_agent", expect.anything());
});

test("prepara un plan desde la terminal activa y completa el comando aprobado", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return { id: "local", name: "Local", model: "test" };
    if (command === "get_providers") return [{ id: "local", name: "Local", model: "test" }];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: null };
    if (command === "plan_agent") return { summary: "Revisar el estado", actions: [{ type: "run_command", command: "git status", reason: "Consultar cambios" }] };
    if (command === "run_agent_command") return undefined;
    return undefined;
  });
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Agente").click());

  const composer = host.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(composer, "revisa el estado del repositorio");
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLFormElement>(".composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  expect(mocks.invoke).toHaveBeenCalledWith("plan_agent", expect.objectContaining({ task: "revisa el estado del repositorio", projectPath: null, shell: "powershell" }));
  expect(host.textContent).toContain("Revisar el estado");
  await act(async () => buttonIncluding("Aprobar y ejecutar").click());
  const commandCall = mocks.invoke.mock.calls.find(([name]) => name === "run_agent_command");
  expect(commandCall?.[1]).toMatchObject({ command: "git status", approved: true });
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="finish-command"]')!.click());
  expect(host.querySelector(".agent-action")?.classList.contains("running")).toBe(true);
  await act(async () => mocks.agentFinishCallbacks.at(-1)?.(commandCall?.[1]?.terminalId as string, commandCall?.[1]?.completionToken as string, 0));
  expect(host.textContent).toContain("COMPLETADO");
  expect(host.textContent).toContain("El comando terminó correctamente.");
});

test("pide aclaración ante una petición ambigua y conserva el objetivo en la respuesta", async () => {
  let planCount = 0;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return { id: "local", name: "Local", model: "test" };
    if (command === "get_providers") return [{ id: "local", name: "Local", model: "test" }];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: null };
    if (command === "plan_agent") {
      planCount += 1;
      if (planCount === 1) return { summary: "Aclarar el destino", clarifyingQuestion: "¿Qué carpeta quieres revisar?", actions: [] };
      return { summary: "Listar imágenes de Descargas", actions: [{ type: "run_command", command: 'Get-ChildItem "$HOME\\Downloads" -File', reason: "Revisar la carpeta solicitada" }] };
    }
    return undefined;
  });
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Agente").click());
  const composer = host.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  const submit = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(composer, value);
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => host.querySelector<HTMLFormElement>(".composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  };

  await submit("busca las imágenes de la carpeta que tengo en mente");
  expect(host.textContent).toContain("¿Qué carpeta quieres revisar?");
  expect(host.querySelector(".agent-plan-count")).toBeNull();
  expect(mocks.invoke).not.toHaveBeenCalledWith("run_agent_command", expect.anything());

  await submit("Descargas del usuario");
  const planCalls = mocks.invoke.mock.calls.filter(([name]) => name === "plan_agent");
  expect(planCalls[1]?.[1]?.task).toContain("Tarea original: busca las imágenes de la carpeta que tengo en mente");
  expect(planCalls[1]?.[1]?.task).toContain("Aclaración solicitada: ¿Qué carpeta quieres revisar?");
  expect(planCalls[1]?.[1]?.task).toContain("Respuesta del usuario: Descargas del usuario");
  expect(host.textContent).toContain('Get-ChildItem "$HOME\\Downloads" -File');
});

test("en CMD el agente espera el código de salida real antes de continuar", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return { id: "local", name: "Local", model: "test" };
    if (command === "get_providers") return [{ id: "local", name: "Local", model: "test" }];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: null };
    if (command === "plan_agent") return { summary: "Comprobar el directorio", actions: [{ type: "run_command", command: "dir", reason: "Listar archivos" }] };
    if (command === "run_agent_command") return undefined;
    return undefined;
  });
  await act(async () => root!.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Nueva terminal"]')!.click());
  await act(async () => buttonIncluding("Command Prompt").click());
  await act(async () => buttonIncluding("Agente").click());

  const composer = host.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(composer, "lista los archivos");
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLFormElement>(".composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await act(async () => buttonIncluding("Aprobar y ejecutar").click());
  const commandCall = mocks.invoke.mock.calls.find(([name]) => name === "run_agent_command");
  const completionToken = commandCall?.[1]?.completionToken as string;
  expect(completionToken).toMatch(/^[0-9a-f-]{36}$/i);

  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[data-testid="finish-command-unknown"]')].at(-1)!.click());
  expect(host.querySelector(".agent-action")?.classList.contains("running")).toBe(true);
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[data-testid="finish-command"]')].at(-1)!.click());
  expect(host.querySelector(".agent-action")?.classList.contains("running")).toBe(true);
  await act(async () => mocks.agentFinishCallbacks.at(-1)?.("terminal-cmd", "550e8400-e29b-41d4-a716-446655440001", 0));
  expect(host.querySelector(".agent-action")?.classList.contains("running")).toBe(true);

  const terminalId = commandCall?.[1]?.terminalId as string;
  await act(async () => mocks.agentFinishCallbacks.at(-1)?.(terminalId, completionToken, 0));
  expect(host.querySelector(".agent-action")?.classList.contains("completed")).toBe(true);
  expect(host.textContent).toContain("El comando terminó correctamente.");
});

test("traduce los mensajes de estado del agente al idioma seleccionado", async () => {
  localStorage.setItem("laural.language.v1", "en");
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return { id: "local", name: "Local", model: "test" };
    if (command === "get_providers") return [{ id: "local", name: "Local", model: "test" }];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: null };
    if (command === "plan_agent") return { summary: "Plan", actions: [] };
    return undefined;
  });
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Agent").click());

  const composer = host.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(composer, "check the current state");
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLFormElement>(".composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(host.textContent).toContain("Plan prepared with 0 actions.");
});

test("abre un proyecto y gestiona la aplicación y las copias de un cambio de archivo", async () => {
  mocks.open.mockResolvedValue("C:/repos/laural");
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return { id: "local", name: "Local", model: "test" };
    if (command === "get_providers") return [{ id: "local", name: "Local", model: "test" }];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: 5 };
    if (command === "plan_agent") return { summary: "Actualizar documentación", actions: [{ type: "write_file", path: "README.md", content: "# Laural", reason: "Documentar cambios" }] };
    if (command === "apply_agent_file") return "Archivo aplicado con copia de seguridad.";
    if (command === "list_agent_backups") return ["v2", "v1"];
    if (command === "restore_agent_backup") return "Versión restaurada.";
    if (command === "clear_agent_backups") return 2;
    return undefined;
  });
  vi.stubGlobal("confirm", vi.fn(() => true));
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Abrir un proyecto").click());
  expect(mocks.open).toHaveBeenCalledWith({ directory: true, multiple: false });
  expect(host.querySelector(".project-item")?.textContent).toContain("laural");
  await act(async () => buttonIncluding("Agente").click());

  const composer = host.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(composer, "actualiza el README");
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLFormElement>(".composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await act(async () => buttonIncluding("Aplicar cambio").click());
  expect(host.textContent).toContain("Archivo aplicado con copia de seguridad");

  await act(async () => buttonIncluding("Copias de seguridad").click());
  expect(host.querySelector(".backup-controls select")?.value).toBe("v2");
  await act(async () => buttonIncluding("Restaurar copia").click());
  expect(host.textContent).toContain("Versión restaurada");
  await act(async () => buttonIncluding("Eliminar copias").click());
  expect(host.textContent).toContain("Copias eliminadas: 2");
  expect(mocks.invoke).toHaveBeenCalledWith("restore_agent_backup", expect.objectContaining({ projectPath: "C:/repos/laural", relativePath: "README.md", version: "v2", approved: true }));
  expect(mocks.invoke).toHaveBeenCalledWith("clear_agent_backups", expect.objectContaining({ projectPath: "C:/repos/laural", relativePath: "README.md", approved: true }));
});

test("mantiene varios proyectos abiertos y conserva la raíz del plan del agente", async () => {
  mocks.open.mockResolvedValueOnce("C:/repos/laural").mockResolvedValueOnce("C:/repos/meridiano");
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return { id: "local", name: "Local", model: "test" };
    if (command === "get_providers") return [{ id: "local", name: "Local", model: "test" }];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: null };
    if (command === "plan_agent") return { summary: "Actualizar documentación", actions: [{ type: "write_file", path: "README.md", content: "# Laural", reason: "Documentar cambios" }] };
    if (command === "apply_agent_file") return "Archivo aplicado.";
    return undefined;
  });
  await act(async () => root!.render(<App />));

  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Añadir proyecto"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>(".add-project")!.click());
  expect(host.querySelectorAll(".project-item")).toHaveLength(2);
  expect(host.querySelectorAll(".terminal-tab")).toHaveLength(3);
  expect(JSON.parse(localStorage.getItem("laural.projects.v1")!).paths).toEqual(["C:/repos/laural", "C:/repos/meridiano"]);

  await act(async () => host.querySelectorAll<HTMLButtonElement>(".project-select")[0].click());
  expect(host.querySelectorAll(".terminal-tab").length).toBe(3);
  expect(host.querySelectorAll(".project-item.active .project-name")[0].textContent).toBe("laural");

  await act(async () => buttonIncluding("Agente").click());
  const composer = host.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(composer, "actualiza el README");
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLFormElement>(".composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  await act(async () => host.querySelectorAll<HTMLButtonElement>(".project-select")[1].click());
  await act(async () => buttonIncluding("Aplicar cambio").click());
  expect(mocks.invoke).toHaveBeenCalledWith("apply_agent_file", expect.objectContaining({ projectPath: "C:/repos/laural", relativePath: "README.md" }));
  expect(host.querySelectorAll(".project-item.active .project-name")[0].textContent).toBe("meridiano");

  await act(async () => host.querySelectorAll<HTMLButtonElement>(".project-remove")[1].click());
  expect(host.querySelectorAll(".project-item")).toHaveLength(1);
  expect(host.querySelector(".project-item.active .project-name")?.textContent).toBe("laural");
  expect(host.querySelectorAll(".terminal-tab")).toHaveLength(3);
});

test("informa errores al preparar la vista previa del contexto", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return { id: "local", name: "Local", model: "test" };
    if (command === "get_providers") return [{ id: "local", name: "Local", model: "test" }];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: null };
    if (command === "preview_context") throw new Error("context unavailable");
    return undefined;
  });
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Revisar contexto").click());
  expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain("context unavailable");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Cerrar"]')?.click());
  expect(host.querySelector('[role="alertdialog"]')).toBeNull();
});

test("maneja fallos de selección, prueba y guardado de perfiles de proveedor", async () => {
  const saved = { id: "saved", name: "Local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen", providerKind: "ollama", hasApiKey: false };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return null;
    if (command === "get_providers") return [saved];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: null };
    if (command === "select_provider") throw new Error("profile unavailable");
    if (command === "test_provider") throw new Error("endpoint unavailable");
    if (command === "save_provider") throw new Error("credential store unavailable");
    return undefined;
  });
  await act(async () => root!.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>(".toolbar-chip")!.click());
  const profileSelect = host.querySelector<HTMLSelectElement>(".provider-dialog select")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(profileSelect, saved.id);
    profileSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.querySelector(".provider-dialog .form-message.error")?.textContent).toContain("profile unavailable");

  await act(async () => buttonIncluding("Nuevo").click());
  const kindSelect = host.querySelectorAll<HTMLSelectElement>(".provider-dialog select")[1];
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(kindSelect, "ollama");
    kindSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.querySelector<HTMLInputElement>('.provider-dialog input[placeholder="http://127.0.0.1:1234/v1"]')?.value).toBe("http://127.0.0.1:11434/v1");
  const modelInput = [...host.querySelectorAll<HTMLInputElement>(".provider-dialog input")].find((input) => input.getAttribute("list") === "provider-model-list")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(modelInput, "llama3");
    modelInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => buttonIncluding("Probar conexión y modelos").click());
  expect(host.querySelector(".provider-dialog .form-message.error")?.textContent).toContain("endpoint unavailable");
  await act(async () => buttonIncluding("Guardar proveedor").click());
  expect(host.querySelector(".provider-dialog .form-message.error")?.textContent).toContain("credential store unavailable");
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
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  await act(async () => buttonIncluding("Probar conexión y modelos").click());
  const testCall = mocks.invoke.mock.calls.find(([command]) => command === "test_provider");
  expect(testCall?.[1]).toEqual({
    input: { id: second.id, providerKind: "custom", name: second.name, baseUrl: second.baseUrl, model: second.model, apiKey: null, shareCustomEndpoint: false },
  });

  const consentCheckbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => consentCheckbox.click());
  await act(async () => buttonIncluding("Guardar proveedor").click());
  const saveCall = mocks.invoke.mock.calls.find(([command]) => command === "save_provider");
  expect(saveCall?.[1]).toEqual({
    input: { id: second.id, providerKind: "custom", name: second.name, baseUrl: second.baseUrl, model: second.model, apiKey: null, shareCustomEndpoint: true },
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

test("limita a 16 las terminales abiertas", async () => {
  await act(async () => root!.render(<App />));
  for (let index = 1; index < 16; index += 1) {
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Nueva terminal"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".shell-menu button")!.click());
  }
  expect(host.querySelectorAll('[aria-label="Sesiones de terminal"] [role="tab"]')).toHaveLength(16);

  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Nueva terminal"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>(".shell-menu button")!.click());
  expect(host.querySelectorAll('[aria-label="Sesiones de terminal"] [role="tab"]')).toHaveLength(16);
  expect(host.querySelector(".terminal-action-notice")?.textContent).toContain("16");
});

test("agrupa deltas del chat y conserva el contenido final", async () => {
  vi.useFakeTimers();
  let appCommits = 0;
  let finishRequest: (() => void) | undefined;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return { id: "local", name: "Local", model: "test" };
    if (command === "get_providers") return [{ id: "local", name: "Local", model: "test" }];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: ["git status", "git diff"], backupRetention: null };
    if (command === "send_chat_stream") return new Promise<void>((resolve) => { finishRequest = resolve; });
    return undefined;
  });
  let onDelta: ((event: { payload: { requestId: string; delta: string } }) => void) | undefined;
  mocks.listen.mockImplementation(async (_topic: string, callback: typeof onDelta) => {
    onDelta = callback;
    return () => undefined;
  });
  await act(async () => root!.render(<Profiler id="chat-stream" onRender={() => { appCommits += 1; }}><App /></Profiler>));
  const composer = host.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(composer, "Hola");
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLButtonElement>(".send-button")!.click());
  await act(async () => Promise.resolve());
  const requestId = mocks.invoke.mock.calls.find(([command]) => command === "send_chat_stream")?.[1]?.requestId as string;
  expect(onDelta).toBeTypeOf("function");
  await act(async () => onDelta?.({ payload: { requestId, delta: "Hola mundo" } }));
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  const assistantMessages = host.querySelectorAll(".chat-message.assistant");
  expect(assistantMessages[assistantMessages.length - 1]?.textContent).toContain("Hola mundo");
  await act(async () => onDelta?.({ payload: { requestId, delta: " y más" } }));
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(assistantMessages[assistantMessages.length - 1]?.textContent).toContain("Hola mundo");
  await act(async () => { await vi.advanceTimersByTimeAsync(99); });
  expect(assistantMessages[assistantMessages.length - 1]?.textContent).toContain("Hola mundo");
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(assistantMessages[assistantMessages.length - 1]?.textContent).toContain("Hola mundo y más");
  appCommits = 0;
  for (let index = 0; index < 20; index += 1) {
    await act(async () => onDelta?.({ payload: { requestId, delta: "x" } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(appCommits).toBeLessThanOrEqual(7);
  expect(assistantMessages[assistantMessages.length - 1]?.textContent).toContain("x".repeat(20));
  await act(async () => { finishRequest?.(); await Promise.resolve(); });
  expect(host.querySelectorAll(".chat-message.assistant").item(0)?.textContent).toContain(`Hola mundo y más${"x".repeat(20)}`);
});

test("conserva los deltas pendientes cuando falla el streaming", async () => {
  vi.useFakeTimers();
  let rejectRequest: ((error: Error) => void) | undefined;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return { id: "local", name: "Local", model: "test" };
    if (command === "get_providers") return [{ id: "local", name: "Local", model: "test" }];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: ["git status", "git diff"], backupRetention: null };
    if (command === "send_chat_stream") return new Promise<void>((_resolve, reject) => { rejectRequest = reject; });
    return undefined;
  });
  let onDelta: ((event: { payload: { requestId: string; delta: string } }) => void) | undefined;
  mocks.listen.mockImplementation(async (_topic: string, callback: typeof onDelta) => {
    onDelta = callback;
    return () => undefined;
  });
  await act(async () => root!.render(<App />));
  const composer = host.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(composer, "Pregunta");
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLButtonElement>(".send-button")!.click());
  await act(async () => Promise.resolve());
  const requestId = mocks.invoke.mock.calls.find(([command]) => command === "send_chat_stream")?.[1]?.requestId as string;
  await act(async () => onDelta?.({ payload: { requestId, delta: "respuesta visible" } }));
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  await act(async () => onDelta?.({ payload: { requestId, delta: " pendiente" } }));
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });

  await act(async () => { rejectRequest?.(new Error("fallo de red")); await Promise.resolve(); });
  const message = host.querySelector(".chat-message.assistant")?.textContent ?? "";
  expect(message).toContain("respuesta visible pendiente");
  expect(message).toContain("fallo de red");
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(host.querySelector(".chat-message.assistant")?.textContent).toContain("respuesta visible pendiente");
});

test("agrupa fragmentos de salida y vacía el último lote al cerrar el bloque", async () => {
  vi.useFakeTimers();
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Bloques").click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="begin-command"]')!.click());
  const rendersAfterCommandStart = mocks.terminalPaneRenderCount;

  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="output-one"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="output-two"]')!.click());
  expect(mocks.terminalPaneRenderCount).toBe(rendersAfterCommandStart);

  await act(async () => { await vi.advanceTimersByTimeAsync(49); });
  expect(host.querySelector(".command-block pre")?.textContent).toBe("Sin salida capturada.");
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
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
  await waitForLazyUi();

  expect(host.querySelector('[role="dialog"][aria-labelledby="palette-title"]')).not.toBeNull();
  expect(host.textContent).toContain("Solo en esta sesión");
  await act(async () => buttonIncluding("git status").click());
  expect(writeText).toHaveBeenCalledWith("git status");
  expect(host.textContent).toContain("Comando copiado");
  expect(mocks.invoke).not.toHaveBeenCalledWith("run_command", expect.anything());
});

test("la paleta permite abrir paneles Git y recetas", async () => {
  await act(async () => root!.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>(".search-button")!.click());
  const search = host.querySelector<HTMLInputElement>(".palette-search input")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(search, "Abrir panel Git");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => buttonIncluding("Abrir panel Git").click());
  expect(host.querySelector(".git-panel-dialog")).not.toBeNull();

  await act(async () => host.querySelector<HTMLButtonElement>(".search-button")!.click());
  const nextSearch = host.querySelector<HTMLInputElement>(".palette-search input")!;
  await act(async () => {
    setValue.call(nextSearch, "Abrir recetas de tareas");
    nextSearch.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => buttonIncluding("Abrir recetas de tareas").click());
  expect(host.querySelector('[role="dialog"][aria-labelledby="recipes-title"]')).not.toBeNull();
});

test("la paleta recorre acciones con flechas y abre la selección con Enter", async () => {
  await act(async () => root!.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>(".search-button")!.click());
  const input = host.querySelector<HTMLInputElement>(".palette-search input")!;
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(host.querySelector<HTMLButtonElement>("#palette-result-2")?.dataset.selected).toBe("true");
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(host.querySelector(".git-panel-dialog")).not.toBeNull();
});

test("Enter en un comando reciente lo copia y nunca lo ejecuta", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await act(async () => root!.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="begin-command"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>(".search-button")!.click());
  const input = host.querySelector<HTMLInputElement>(".palette-search input")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, "git status");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(writeText).toHaveBeenCalledWith("git status");
  expect(mocks.invoke).not.toHaveBeenCalledWith("run_command", expect.anything());
  expect(host.querySelector('[role="dialog"][aria-labelledby="palette-title"]')).not.toBeNull();
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

test("Ayuda abre el centro y sus acciones llevan a funciones reales", async () => {
  await act(async () => root!.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Ayuda"]')!.click());
  expect(host.querySelector('[role="dialog"][aria-labelledby="help-title"]')).not.toBeNull();
  expect(host.textContent).toContain("Ctrl + K");
  await act(async () => buttonIncluding("Conectar un modelo").click());
  expect(host.querySelector(".provider-dialog h2")?.textContent).toBe("Conecta tu proveedor");
});

test("Ayuda permite abrir configuración o la paleta", async () => {
  await act(async () => root!.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Ayuda"]')!.click());
  await act(async () => buttonIncluding("Abrir configuración").click());
  expect(host.querySelector('[role="dialog"][aria-label="Configuración"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Cerrar configuración"]')!.click());

  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Ayuda"]')!.click());
  await act(async () => buttonIncluding("Buscar acciones").click());
  expect(host.querySelector('[role="dialog"][aria-labelledby="palette-title"]')).not.toBeNull();
});

test("la campana muestra notificaciones y abre la sección de actualizaciones", async () => {
  await act(async () => root!.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Notificaciones"]')!.click());
  expect(host.querySelector('[role="dialog"][aria-labelledby="notifications-title"]')).not.toBeNull();
  expect(host.textContent).toContain("No tienes avisos nuevos.");
  await act(async () => buttonIncluding("Ver actualizaciones y versión").click());
  expect(host.querySelector('[aria-labelledby="notifications-title"]')).toBeNull();
});

test("la campana lleva los avisos de sincronización a Cuenta", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return null;
    if (command === "get_providers") return [];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: null };
    if (command === "get_preference_sync_status") return { pending: true };
    return undefined;
  });
  await act(async () => root!.render(<App />));
  await act(async () => Promise.resolve());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Notificaciones"]')!.click());
  expect(host.textContent).toContain("Hay cambios locales pendientes");
  await act(async () => buttonIncluding("Revisar configuración de la cuenta").click());
  await waitForLazyUi();
  expect(host.querySelector(".account-settings")).not.toBeNull();
});

test("localiza los avisos dinámicos de sincronización en inglés", async () => {
  localStorage.setItem("laural.language.v1", "en");
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return null;
    if (command === "get_providers") return [];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: null };
    if (command === "get_preference_sync_status") return { pending: true };
    return undefined;
  });
  await act(async () => root!.render(<App />));
  await act(async () => Promise.resolve());
  expect(host.textContent).toContain("Local changes are waiting to sync; Laural will retry them.");
  expect(buttonIncluding("Review")).toBeDefined();
});

test("el selector de espacio abre acciones de proyecto y cuenta", async () => {
  await act(async () => root!.render(<App />));
  const picker = host.querySelector<HTMLButtonElement>(".workspace-picker")!;
  await act(async () => picker.click());
  expect(picker.getAttribute("aria-expanded")).toBe("true");
  expect(host.textContent).toContain("Los espacios compartidos aún no están disponibles.");
  await act(async () => buttonIncluding("Abrir carpeta de proyecto").click());
  expect(mocks.open).toHaveBeenCalledWith({ directory: true, multiple: false });
  expect(host.querySelector('[role="menu"][aria-label="Espacio de trabajo"]')).toBeNull();

  await act(async () => picker.click());
  await act(async () => buttonIncluding("Cuenta y sincronización").click());
  expect(host.textContent).toContain("Cuenta y sincronización");
});

test("el panel del asistente se puede ocultar, mostrar y recuerda la preferencia local", async () => {
  await act(async () => root!.render(<App />));
  expect(host.querySelector(".assistant-panel")).not.toBeNull();
  const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Ocultar asistente IA"]')!;
  await act(async () => toggle.click());
  expect(host.querySelector(".assistant-panel")).toBeNull();
  expect(host.querySelector(".workspace-body")?.classList.contains("assistant-hidden")).toBe(true);
  expect(localStorage.getItem("laural.assistant-visible.v1")).toBe("false");

  await act(async () => root!.unmount());
  root = createRoot(host);
  await act(async () => root!.render(<App />));
  expect(host.querySelector(".assistant-panel")).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Mostrar asistente IA"]')!.click());
  expect(host.querySelector(".assistant-panel")).not.toBeNull();
  expect(localStorage.getItem("laural.assistant-visible.v1")).toBe("true");
});

test("los controles Copiar y Limpiar envían la acción a la pestaña activa", async () => {
  await act(async () => root!.render(<App />));
  const lastRequest = () => mocks.terminalRequests[mocks.terminalRequests.length - 1];
  await act(async () => buttonIncluding("Copiar").click());
  expect(lastRequest()).toEqual(expect.objectContaining({ copySequence: 1, copyTarget: lastRequest()?.terminalId }));
  await act(async () => buttonIncluding("Limpiar").click());
  expect(lastRequest()).toEqual(expect.objectContaining({ clearSequence: 1, clearTarget: lastRequest()?.terminalId }));
});

test("Más opciones abre accesos rápidos a la terminal y se cierra tras elegir", async () => {
  await act(async () => root!.render(<App />));
  const more = host.querySelector<HTMLButtonElement>('[aria-label="Más opciones"]')!;
  await act(async () => more.click());
  expect(host.querySelector('[role="menu"][aria-label="Más opciones de terminal"]')).not.toBeNull();
  await act(async () => buttonIncluding("Mostrar bloques").click());
  expect(host.querySelector(".command-blocks-panel")).not.toBeNull();
  expect(more.getAttribute("aria-expanded")).toBe("false");

  await act(async () => more.click());
  await act(async () => buttonIncluding("Ocultar asistente IA").click());
  expect(host.querySelector(".assistant-panel")).toBeNull();
  expect(host.querySelector('[role="menu"][aria-label="Más opciones de terminal"]')).toBeNull();
});

test("los tres puntos del perfil abren sus opciones de portabilidad y cuenta", async () => {
  await act(async () => root!.render(<App />));
  const profile = host.querySelector<HTMLButtonElement>(".profile-row")!;
  await act(async () => profile.click());
  expect(profile.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector('[role="menu"][aria-label="Opciones del perfil local"]')).not.toBeNull();
  await act(async () => buttonIncluding("Importar y exportar configuración").click());
  await waitForLazyUi();
  expect(host.querySelector("#transfer-title")?.textContent).toBe("Exportar e importar configuración");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Cerrar importar y exportar configuración"]')!.click());

  await act(async () => profile.click());
  await act(async () => buttonIncluding("Cuenta y sincronización").click());
  expect(host.querySelector("#account-settings-title")?.textContent).toBe("Cuenta y sincronización");
});

test("importar una configuración aplica el idioma incluido en la exportación v2", async () => {
  const imported = {
    preferences: { themeId: "ocean", appearance: "light", updateMode: "automatic", language: "en" },
    activeProvider: null,
    providers: [],
    backupPath: "C:\\Laural\\previous.laural",
    backupEncrypted: false,
    backupContainsApiKeys: false,
  };
  mocks.open.mockResolvedValue("C:\\Laural\\settings.laural");
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_provider") return null;
    if (command === "get_providers") return [];
    if (command === "get_agent_settings") return { mode: "review", allowedPrefixes: [], backupRetention: null };
    if (command === "preview_configuration") return { ...imported, containsApiKeys: false };
    if (command === "import_configuration") return imported;
    return undefined;
  });
  await act(async () => root!.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>(".profile-row")!.click());
  await act(async () => buttonIncluding("Importar y exportar configuración").click());
  await waitForLazyUi();
  await act(async () => buttonIncluding("Elegir archivo .laural").click());
  await act(async () => buttonIncluding("Validar y previsualizar").click());
  await act(async () => buttonIncluding("Aplicar importación").click());

  expect(localStorage.getItem("laural.language.v1")).toBe("en");
  expect(document.documentElement.lang).toBe("en");
  expect(localStorage.getItem("laural.theme")).toBe("ocean");
});

test("la navegación Historial muestra solo comandos recientes de la sesión", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await act(async () => root!.render(<App />));
  await act(async () => buttonIncluding("Historial").click());
  expect(host.textContent).toContain("Todavía no hay comandos recientes en esta sesión.");
  await act(async () => buttonIncluding("Cerrar").click());

  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="begin-command"]')!.click());
  await act(async () => buttonIncluding("Historial").click());
  expect(host.querySelector("#palette-title")?.textContent).toBe("Historial de comandos");
  expect(buttonIncluding("git status")).not.toBeUndefined();
  expect(host.querySelector(".palette-group-label")?.textContent).toContain("COMANDOS RECIENTES");
  expect(host.querySelector(".palette-group-label")?.textContent).not.toContain("ACCIONES");
  await act(async () => buttonIncluding("git status").click());
  expect(writeText).toHaveBeenCalledWith("git status");
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
