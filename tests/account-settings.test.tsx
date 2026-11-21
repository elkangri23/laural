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
  await act(async () => root.render(<AccountSettings onClose={vi.fn()} />));
  const login = host.querySelector("button");
  expect(login?.textContent).toBe("Iniciar sesión");

  await act(async () => login?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("start_account_login");

  await act(async () => mocks.onStatus?.({ payload: { status: "waiting", message: "Completa el acceso en el navegador." } }));
  expect(host.querySelector("button")?.textContent).toBe("Esperando en el navegador…");
  await act(async () => mocks.onStatus?.({ payload: { status: "signed_in", message: "Sesión iniciada correctamente." } }));
  expect(host.textContent).toContain("Sesión iniciada correctamente.");
  expect(host.querySelector("button")?.textContent).toBe("Quitar cuenta de este equipo");
});

test("presenta errores de navegador y del almacén local", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return false;
    if (command === "start_account_login") throw new Error("browser unavailable");
    return undefined;
  });
  await act(async () => root.render(<AccountSettings onClose={vi.fn()} />));
  await act(async () => host.querySelector("button")?.click());
  expect(host.textContent).toContain("No se pudo abrir el navegador");

  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "clear_account_session") throw new Error("credential store unavailable");
    return undefined;
  });
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<AccountSettings onClose={vi.fn()} />));
  await act(async () => host.querySelector("button")?.click());
  expect(host.textContent).toContain("No se pudo quitar la sesión");
});

test("informa si falla la lectura del almacén seguro", async () => {
  mocks.invoke.mockRejectedValue(new Error("credential store unavailable"));
  await act(async () => root.render(<AccountSettings onClose={vi.fn()} />));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  expect(host.textContent).toContain("No se pudo consultar el almacén seguro de Windows");
});

test("informa si no se puede escuchar el resultado del login", async () => {
  mocks.invoke.mockReturnValue(new Promise(() => undefined));
  mocks.listenFails = true;
  await act(async () => root.render(<AccountSettings onClose={vi.fn()} />));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  expect(host.textContent).toContain("No se pudo escuchar el resultado");
});

test("quita solo la sesión local y comunica la limitación", async () => {
  mocks.invoke.mockImplementation(async (command: string) => command === "account_session_status");
  await act(async () => root.render(<AccountSettings onClose={vi.fn()} />));
  await act(async () => host.querySelector("button")?.click());

  expect(mocks.invoke).toHaveBeenCalledWith("clear_account_session");
  expect(host.textContent).toContain("la revocación remota está pendiente");
  expect(host.querySelector("button")?.textContent).toBe("Iniciar sesión");
});
