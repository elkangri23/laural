// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { formatDownloadProgress, UpdateManager } from "../src/components/UpdateManager";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  getVersion: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("../src/components/SettingsDialog", () => ({
  SettingsDialog: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => <div role="dialog"><button aria-label="Cerrar configuración" onClick={onClose}>Cerrar</button>{children}</div>,
}));

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.check.mockReset();
  mocks.getVersion.mockReset().mockResolvedValue("0.1.0-alpha.14");
  mocks.download.mockReset().mockImplementation(async (onEvent: (event: unknown) => void) => {
    onEvent({ event: "Started", data: { contentLength: 2048 } });
    onEvent({ event: "Progress", data: { chunkLength: 2048 } });
    onEvent({ event: "Finished" });
  });
  mocks.install.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

test("presenta elección inicial y recuerda el modo manual", async () => {
  mocks.check.mockResolvedValue(null);
  root = createRoot(host);
  await act(async () => root!.render(<UpdateManager settingsOpen={false} onSettingsOpen={vi.fn()} onSettingsClose={vi.fn()} />));
  expect(host.textContent).toContain("¿Cómo quieres recibir actualizaciones?");

  const manualButton = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Avisarme y decidir"))!;
  await act(async () => manualButton.click());

  expect(localStorage.getItem("laural.update-mode.v1")).toBe("manual");
  expect(mocks.check).toHaveBeenCalledTimes(1);
});

test("descarga, indica que está lista y solicita instalación con reinicio", async () => {
  const update = { version: "0.1.0-alpha.15", download: mocks.download, install: mocks.install, close: mocks.close };
  mocks.check.mockResolvedValueOnce(null).mockResolvedValueOnce(update);
  root = createRoot(host);
  let settingsOpen = false;
  const render = () => root!.render(<UpdateManager settingsOpen={settingsOpen} onSettingsOpen={vi.fn()} onSettingsClose={vi.fn()} />);
  await act(async () => render());
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Avisarme y decidir"))!.click());

  settingsOpen = true;
  await act(async () => render());
  expect(host.textContent).toContain("0.1.0-alpha.14");
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Buscar ahora")!.click());
  expect(host.textContent).toContain("0.1.0-alpha.15");

  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Descargar 0.1.0-alpha.15"))!.click());
  expect(host.textContent).toContain("está lista para instalar");
  expect(host.textContent).toContain("Instalar y reiniciar");

  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Instalar y reiniciar")!.click());
  expect(mocks.install).toHaveBeenCalledWith({ restartAfterInstall: true });
});

test("el modo automático descarga e instala al detectar una versión nueva", async () => {
  const update = { version: "0.1.0-alpha.15", download: mocks.download, install: mocks.install, close: mocks.close };
  mocks.check.mockResolvedValue(update);
  root = createRoot(host);
  await act(async () => root!.render(<UpdateManager settingsOpen={false} onSettingsOpen={vi.fn()} onSettingsClose={vi.fn()} />));

  const automaticButton = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Descargar e instalar automáticamente"))!;
  await act(async () => automaticButton.click());
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  expect(mocks.check).toHaveBeenCalledWith({ timeout: 15_000 });
  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(mocks.install).toHaveBeenCalledWith({ restartAfterInstall: true });
});

test("Buscar ahora respeta el modo automático configurado", async () => {
  const update = { version: "0.1.0-alpha.16", download: mocks.download, install: mocks.install, close: mocks.close };
  localStorage.setItem("laural.update-mode.v1", "automatic");
  mocks.check.mockResolvedValueOnce(null).mockResolvedValueOnce(update);
  root = createRoot(host);
  await act(async () => {
    root!.render(<UpdateManager settingsOpen onSettingsOpen={vi.fn()} onSettingsClose={vi.fn()} />);
    await Promise.resolve();
  });

  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Buscar ahora")!.click());

  expect(mocks.check).toHaveBeenCalledTimes(2);
  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(mocks.install).toHaveBeenCalledWith({ restartAfterInstall: true });
  expect(host.textContent).not.toContain("está lista para instalar");
});

test("formatea el avance sin superar el cien por cien", () => {
  expect(formatDownloadProgress(512, 2048)).toBe("25%");
  expect(formatDownloadProgress(4096, 2048)).toBe("100%");
  expect(formatDownloadProgress(2048, null)).toBe("2 KB descargados");
});
