// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), save: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open, save: mocks.save }));
vi.mock("../src/components/ModalShell", () => ({
  ModalShell: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => (
    <div role="dialog"><button onClick={onClose}>Cerrar</button>{children}</div>
  ),
}));

import { ConfigurationTransfer as TransferView } from "../src/components/ConfigurationTransfer";
import { LanguageProvider } from "../src/i18n";

function ConfigurationTransfer(props: ComponentProps<typeof TransferView>) {
  return <LanguageProvider><TransferView {...props} /></LanguageProvider>;
}

let root: Root | undefined;
let host: HTMLDivElement;
const preferences = { themeId: "laurel", appearance: "dark" as const, updateMode: "manual" as const, language: "es" as const };

function button(text: string): HTMLButtonElement {
  const item = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
  if (!(item instanceof HTMLButtonElement)) throw new Error(`No se encontró el botón ${text}`);
  return item;
}

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.invoke.mockReset();
  mocks.open.mockReset();
  mocks.save.mockReset();
  localStorage.clear();
  localStorage.setItem("laural.language.v1", "es");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

test("localiza la portabilidad al inglés sin cambiar el contrato de exportación", async () => {
  localStorage.setItem("laural.language.v1", "en");
  mocks.save.mockResolvedValue(null);
  mocks.open.mockResolvedValue(null);
  await act(async () => root!.render(<ConfigurationTransfer preferences={preferences} onClose={vi.fn()} onImported={vi.fn()} />));
  expect(host.textContent).toContain("Export and import settings");
  expect(host.textContent).toContain("Include API keys");
  expect(host.textContent).toContain("File password");
  expect(host.textContent).toContain("Import");
  await act(async () => button("Export file").click());
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "Laural-settings.laural", filters: [{ name: "Laural settings", extensions: ["laural"] }] }));
  await act(async () => button("Choose .laural file").click());
  expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ filters: [{ name: "Laural settings", extensions: ["laural"] }] }));
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
  expect(host.textContent).toContain("Keys are never exported in plain text");
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

test("exige confirmar y proteger con contraseña las claves incluidas", async () => {
  await act(async () => root!.render(<ConfigurationTransfer preferences={preferences} onClose={vi.fn()} onImported={vi.fn()} />));
  await act(async () => host.querySelector<HTMLInputElement>('.transfer-card input[type="checkbox"]')?.click());
  const passwords = host.querySelectorAll<HTMLInputElement>('input[type="password"]');
  await act(async () => {
    setInput(passwords[0], "contraseña-segura-1");
    setInput(passwords[1], "contraseña-segura-2");
  });
  await act(async () => button("Exportar archivo").click());
  expect(host.textContent).toContain("Las contraseñas no coinciden");
  expect(mocks.save).not.toHaveBeenCalled();

  await act(async () => setInput(passwords[1], "contraseña-segura-1"));
  await act(async () => setInput(passwords[0], "corta"));
  await act(async () => setInput(passwords[1], "corta"));
  await act(async () => button("Exportar archivo").click());
  expect(host.textContent).toContain("al menos 12 caracteres");
  expect(mocks.save).not.toHaveBeenCalled();
});

test("exporta claves solo cuando la contraseña fuerte coincide", async () => {
  mocks.save.mockResolvedValue("C:\\Laural-seguro.laural");
  mocks.invoke.mockResolvedValue(undefined);
  await act(async () => root!.render(<ConfigurationTransfer preferences={preferences} onClose={vi.fn()} onImported={vi.fn()} />));
  await act(async () => host.querySelector<HTMLInputElement>('.transfer-card input[type="checkbox"]')?.click());
  const passwords = host.querySelectorAll<HTMLInputElement>('input[type="password"]');
  await act(async () => {
    setInput(passwords[0], "contraseña-segura-1");
    setInput(passwords[1], "contraseña-segura-1");
  });
  await act(async () => button("Exportar archivo").click());
  expect(mocks.invoke).toHaveBeenCalledWith("export_configuration", expect.objectContaining({ destination: "C:\\Laural-seguro.laural", includeApiKeys: true, password: "contraseña-segura-1" }));
  expect(host.textContent).toContain("claves están cifradas");
  expect(host.querySelectorAll<HTMLInputElement>('input[type="password"]')[0]?.value).toBe("");
});

test("limpia la vista previa cuando la validación falla y conserva un error comprensible", async () => {
  mocks.open.mockResolvedValue("C:\\Laural\invalid.laural");
  mocks.invoke.mockRejectedValue("Contraseña incorrecta");
  await act(async () => root!.render(<ConfigurationTransfer preferences={preferences} onClose={vi.fn()} onImported={vi.fn()} />));
  await act(async () => button("Elegir archivo .laural").click());
  await act(async () => button("Validar y previsualizar").click());
  expect(host.textContent).toContain("Contraseña incorrecta");
  expect(host.querySelector(".transfer-preview")).toBeNull();
});

test("impide aplicar un tema inválido aunque haya pasado la previsualización", async () => {
  const onImported = vi.fn();
  mocks.open.mockResolvedValue("C:\\Laural\\legacy.laural");
  mocks.invoke.mockImplementation(async (command: string) => command === "preview_configuration"
    ? { preferences, activeProviderId: null, providers: [], containsApiKeys: false }
    : { preferences: { ...preferences, themeId: "missing-theme" }, activeProvider: null, providers: [], backupPath: "", backupEncrypted: false, backupContainsApiKeys: false });
  await act(async () => root!.render(<ConfigurationTransfer preferences={preferences} onClose={vi.fn()} onImported={onImported} />));
  await act(async () => button("Elegir archivo .laural").click());
  await act(async () => button("Validar y previsualizar").click());
  await act(async () => button("Aplicar importación").click());
  expect(host.textContent).toContain("El tema importado no está disponible");
  expect(mocks.invoke).toHaveBeenCalledWith("import_configuration", expect.anything());
  expect(onImported).not.toHaveBeenCalled();
});

test("permite elegir reemplazo y cancelación del selector sin crear una ruta", async () => {
  mocks.open.mockResolvedValue(null);
  await act(async () => root!.render(<ConfigurationTransfer preferences={preferences} onClose={vi.fn()} onImported={vi.fn()} />));
  await act(async () => button("Elegir archivo .laural").click());
  expect(host.textContent).not.toContain("Validar y previsualizar");
  expect(mocks.invoke).not.toHaveBeenCalled();
});

test("expone el aviso al reemplazar perfiles y aplica un archivo sin clave ni respaldo cifrado", async () => {
  const imported = { preferences, activeProvider: null, providers: [], backupPath: "C:\\backup.laural", backupEncrypted: false, backupContainsApiKeys: false };
  const onImported = vi.fn();
  mocks.open.mockResolvedValue("C:\\entrada.laural");
  mocks.invoke.mockImplementation(async (command: string) => command === "preview_configuration"
    ? { preferences: { ...preferences, appearance: "light" }, activeProviderId: null, providers: [{ id: "local", providerKind: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen", hasApiKey: false, shareCustomEndpoint: false }], containsApiKeys: false }
    : imported);
  await act(async () => root!.render(<ConfigurationTransfer preferences={preferences} onClose={vi.fn()} onImported={onImported} />));
  await act(async () => button("Elegir archivo .laural").click());
  await act(async () => button("Validar y previsualizar").click());
  const importPassword = host.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!;
  await act(async () => setInput(importPassword, "clave de importación"));
  expect(host.querySelector(".transfer-preview")).toBeNull();
  await act(async () => button("Validar y previsualizar").click());
  const strategy = host.querySelector<HTMLSelectElement>("select")!;
  await act(async () => {
    strategy.value = "replace";
    strategy.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.textContent).toContain("Los perfiles que no estén en el archivo se quitarán");
  expect(host.textContent).toContain("Ollama · qwen");
  expect(host.textContent).toContain("sin claves");
  expect(host.textContent).toContain("Claro");
  await act(async () => button("Aplicar importación").click());
  expect(onImported).toHaveBeenCalledWith(imported);
  expect(host.textContent).toContain("C:\\backup.laural");
  expect(host.textContent).toContain("sin claves API");
});

test("no exporta si se cancela el selector de destino", async () => {
  mocks.save.mockResolvedValue(null);
  await act(async () => root!.render(<ConfigurationTransfer preferences={preferences} onClose={vi.fn()} onImported={vi.fn()} />));
  await act(async () => button("Exportar archivo").click());
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Configuración exportada");
});
