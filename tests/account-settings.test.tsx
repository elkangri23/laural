// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AccountSettings } from "../src/components/AccountSettings";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listenFails: false, onStatus: undefined as ((event: { payload: { status: string; message: string } }) => void) | undefined }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, callback: typeof mocks.onStatus) => {
    if (mocks.listenFails) throw new Error("listener unavailable");
    mocks.onStatus = callback ?? undefined;
    return () => { mocks.onStatus = undefined; };
  },
}));
vi.mock("../src/components/SettingsDialog", () => ({
  SettingsDialog: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
}));

let host: HTMLDivElement;
let root: Root;
const preferences = { themeId: "laurel", appearance: "dark" as const, updateMode: "manual" as const };
const renderAccountSettings = (onImported = vi.fn(), syncRiskAcknowledged = true, onAcknowledgeSyncRisk = vi.fn(() => true)) => <AccountSettings onClose={vi.fn()} preferences={preferences} onImported={onImported} onSyncSettled={vi.fn()} syncRiskAcknowledged={syncRiskAcknowledged} onAcknowledgeSyncRisk={onAcknowledgeSyncRisk} />;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.onStatus = undefined;
  mocks.listenFails = false;
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "account_session_status") return false;
    return undefined;
  });
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

test("inicia login en navegador y muestra el resultado de la sesión", async () => {
  await act(async () => root.render(renderAccountSettings()));
  const login = host.querySelector("button");
  expect(login?.textContent).toBe("Iniciar sesión");

  await act(async () => login?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("start_account_login");

  await act(async () => mocks.onStatus?.({ payload: { status: "waiting", message: "Completa el acceso en el navegador." } }));
  expect(host.querySelector("button")?.textContent).toBe("Esperando en el navegador…");
  await act(async () => mocks.onStatus?.({ payload: { status: "signed_in", message: "Sesión iniciada correctamente." } }));
  expect(host.textContent).toContain("Sesión iniciada correctamente.");
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toContain("Quitar cuenta de este equipo");
});

test("presenta errores de navegador y del almacén local", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return false;
    if (command === "start_account_login") throw new Error("browser unavailable");
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => host.querySelector<HTMLButtonElement>('button')?.click());
  expect(host.textContent).toContain("No se pudo abrir el navegador");

  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "clear_account_session") throw new Error("credential store unavailable");
    return undefined;
  });
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Quitar cuenta de este equipo")?.click());
  expect(host.textContent).toContain("No se pudo quitar la sesión");
});

test("informa si falla la lectura del almacén seguro", async () => {
  mocks.invoke.mockRejectedValue(new Error("credential store unavailable"));
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  expect(host.textContent).toContain("No se pudo consultar el almacén seguro de Windows");
});

test("informa si no se puede escuchar el resultado del login", async () => {
  mocks.invoke.mockReturnValue(new Promise(() => undefined));
  mocks.listenFails = true;
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  expect(host.textContent).toContain("No se pudo escuchar el resultado");
});

test("quita solo la sesión local y comunica la limitación", async () => {
  mocks.invoke.mockImplementation(async (command: string) => command === "account_session_status");
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Quitar cuenta de este equipo")?.click());

  expect(mocks.invoke).toHaveBeenCalledWith("clear_account_session");
  expect(host.textContent).toContain("la revocación remota está pendiente");
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toContain("Iniciar sesión");
});

test("compara el snapshot y ofrece elección sin revelar los cambios", async () => {
  const local = { schemaVersion: 1, preferences, activeProviderId: "local", providers: [{ id: "local", kind: "ollama", name: "Ollama", model: "qwen", customEndpoint: undefined }] };
  const cloud = { ...local, preferences: { ...preferences, themeId: "ocean" } };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_preference_snapshot") return local;
    if (command === "read_remote_preferences") return { snapshot: cloud, revision: 7 };
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => host.querySelector<HTMLButtonElement>("button")?.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.click());
  expect(host.textContent).toContain("no coincide");
  expect(host.textContent).not.toContain("ocean");
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toContain("Usar este equipo");
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toContain("Usar la nube");
});

test("bloquea la sincronización hasta aceptar el riesgo del VPS", async () => {
  const onAcknowledge = vi.fn(() => true);
  mocks.invoke.mockImplementation(async (command: string) => command === "account_session_status");
  await act(async () => root.render(renderAccountSettings(vi.fn(), false, onAcknowledge)));

  expect(host.textContent).toContain("una pérdida total del VPS puede borrar tus datos sincronizados");
  expect(host.textContent).toContain("no hay cifrado de extremo a extremo");
  const syncButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora");
  expect(syncButton?.disabled).toBe(true);
  await act(async () => syncButton?.click());
  expect(mocks.invoke).not.toHaveBeenCalledWith("read_remote_preferences");

  const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
  await act(async () => { if (checkbox) checkbox.click(); });
  const acceptButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Aceptar riesgo y habilitar sincronización");
  expect(acceptButton?.disabled).toBe(false);
  await act(async () => acceptButton?.click());
  expect(onAcknowledge).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Riesgo revisado en este equipo");
  expect([...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.disabled).toBe(false);
});

test("aplica la configuración cloud mediante Rust y comunica la copia local", async () => {
  const snapshot = { schemaVersion: 1, preferences, activeProviderId: null, providers: [] };
  const imported = { preferences, activeProvider: null, providers: [], backupPath: "C:/Laural/transfer-backups/configuracion.laural", backupEncrypted: false, backupContainsApiKeys: false };
  const onImported = vi.fn();
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_preference_snapshot") return snapshot;
    if (command === "read_remote_preferences") return { snapshot: { ...snapshot, preferences: { ...preferences, themeId: "ocean" } }, revision: 3 };
    if (command === "apply_remote_preference_snapshot") return imported;
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings(onImported)));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Usar la nube")?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("apply_remote_preference_snapshot", expect.objectContaining({ snapshot: expect.objectContaining({ preferences: expect.objectContaining({ themeId: "ocean" }) }) }));
  expect(onImported).toHaveBeenCalledWith(imported);
  expect(host.textContent).toContain(imported.backupPath);
});
