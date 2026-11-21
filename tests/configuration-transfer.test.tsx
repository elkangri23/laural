// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), save: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open, save: mocks.save }));
vi.mock("../src/components/SettingsDialog", () => ({
  SettingsDialog: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => (
    <div role="dialog"><button onClick={onClose}>Cerrar</button>{children}</div>
  ),
}));

import { ConfigurationTransfer } from "../src/components/ConfigurationTransfer";

let root: Root | undefined;
let host: HTMLDivElement;
const preferences = { themeId: "laurel", appearance: "dark" as const, updateMode: "manual" as const };

function button(text: string): HTMLButtonElement {
  const item = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
  if (!(item instanceof HTMLButtonElement)) throw new Error(`No se encontró el botón ${text}`);
  return item;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.invoke.mockReset();
  mocks.open.mockReset();
  mocks.save.mockReset();
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

test("exporta sin API keys por defecto", async () => {
  const onImported = vi.fn();
  mocks.save.mockResolvedValue("C:\\Users\\test\\Laural-configuracion.laural");
  mocks.invoke.mockResolvedValue(undefined);
  await act(async () => root!.render(<ConfigurationTransfer preferences={preferences} onClose={vi.fn()} onImported={onImported} />));
  await act(async () => button("Exportar archivo").click());

  expect(mocks.invoke).toHaveBeenCalledWith("export_configuration", {
    destination: "C:\\Users\\test\\Laural-configuracion.laural",
    preferences,
    includeApiKeys: false,
    password: null,
  });
  expect(host.textContent).toContain("sin incluir claves API");
});

test("previsualiza perfiles sin exponer el contenido de sus claves y aplica importación", async () => {
  const onImported = vi.fn();
  const preview = {
    preferences,
    activeProviderId: "provider-1",
    providers: [{ id: "provider-1", name: "Local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen", hasApiKey: true }],
    containsApiKeys: true,
  };
  const imported = {
    preferences: { ...preferences, themeId: "ocean" },
    activeProvider: { id: "provider-1", name: "Local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen", hasApiKey: true },
    providers: [{ id: "provider-1", name: "Local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen", hasApiKey: true }],
    backupPath: "C:\\Users\\test\\AppData\\Laural\\transfer-backups\\previous.laural",
    backupEncrypted: true,
    backupContainsApiKeys: true,
  };
  mocks.open.mockResolvedValue("C:\\Users\\test\\settings.laural");
  mocks.invoke.mockImplementation(async (command: string) => command === "preview_configuration" ? preview : imported);
  await act(async () => root!.render(<ConfigurationTransfer preferences={preferences} onClose={vi.fn()} onImported={onImported} />));

  await act(async () => button("Elegir archivo").click());
  await act(async () => button("Validar y previsualizar").click());
  expect(host.textContent).toContain("Local · qwen · http://127.0.0.1:11434/v1 · clave incluida");
  expect(host.textContent).not.toContain("secret-key");

  await act(async () => button("Aplicar importación").click());
  expect(mocks.invoke).toHaveBeenLastCalledWith("import_configuration", {
    source: "C:\\Users\\test\\settings.laural",
    password: null,
    strategy: "merge",
    currentPreferences: preferences,
  });
  expect(onImported).toHaveBeenCalledWith(imported);
  expect(host.textContent).toContain("C:\\Users\\test\\AppData\\Laural\\transfer-backups\\previous.laural");
});

test("rechaza una preferencia importada con tema desconocido antes de aplicarla", async () => {
  const onImported = vi.fn();
  mocks.open.mockResolvedValue("C:\\Users\\test\\settings.laural");
  mocks.invoke.mockResolvedValue({
    preferences: { ...preferences, themeId: "tema-desconocido" },
    activeProviderId: null,
    providers: [],
    containsApiKeys: false,
  });
  await act(async () => root!.render(<ConfigurationTransfer preferences={preferences} onClose={vi.fn()} onImported={onImported} />));
  await act(async () => button("Elegir archivo").click());
  await act(async () => button("Validar y previsualizar").click());

  expect(host.textContent).toContain("tema que esta versión de Laural no reconoce");
  expect(host.textContent).not.toContain("Aplicar importación");
  expect(onImported).not.toHaveBeenCalled();
});
