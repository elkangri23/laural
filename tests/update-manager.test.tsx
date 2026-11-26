// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { formatDownloadProgress, UpdateManager as UpdateManagerView } from "../src/components/UpdateManager";
import { LanguageProvider } from "../src/i18n";

function UpdateManager(props: ComponentProps<typeof UpdateManagerView>) {
  return <LanguageProvider><UpdateManagerView {...props} /></LanguageProvider>;
}

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  getVersion: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("../src/components/ModalShell", () => ({
  ModalShell: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => <div role="dialog"><button aria-label="Cerrar configuración" onClick={onClose}>Cerrar</button>{children}</div>,
}));

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("laural.language.v1", "es");
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

test("localiza la elección inicial y estados de actualización en inglés", async () => {
  localStorage.setItem("laural.language.v1", "en");
  mocks.check.mockResolvedValueOnce(null);
  root = createRoot(host);
  await act(async () => root!.render(<UpdateManager settingsOpen={false} onSettingsOpen={vi.fn()} onSettingsClose={vi.fn()} />));
  expect(host.textContent).toContain("How do you want to receive updates?");
  expect(host.textContent).toContain("Notify me so I can choose when to install");
  expect(host.textContent).toContain("Download and install automatically");
  expect(host.textContent).toContain("cryptographic signature");

  expect(formatDownloadProgress(1024, null, "en")).toBe("1 KB downloaded");
  expect(formatDownloadProgress(512, 1024, "en")).toBe("50%");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

test("presenta elección inicial y recuerda el modo manual", async () => {
  mocks.check.mockResolvedValueOnce(null);
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

  settingsOpen = false;
  await act(async () => render());
  expect(host.textContent).toContain("Actualización lista · 0.1.0-alpha.15");

  settingsOpen = true;
  await act(async () => render());
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

test("cierra la decisión inicial seleccionando el modo manual por defecto", async () => {
  mocks.check.mockResolvedValue(null);
  root = createRoot(host);
  const onSettingsClose = vi.fn();
  await act(async () => root!.render(<UpdateManager settingsOpen={false} onSettingsOpen={vi.fn()} onSettingsClose={onSettingsClose} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Cerrar configuración"]')?.click());
  expect(localStorage.getItem("laural.update-mode.v1")).toBe("manual");
  expect(onSettingsClose).not.toHaveBeenCalled();
});

test("expone errores de búsqueda y permite abrir las opciones desde el aviso", async () => {
  localStorage.setItem("laural.update-mode.v1", "manual");
  const update = { version: "0.1.0-alpha.16", download: mocks.download, install: mocks.install, close: mocks.close };
  mocks.check.mockRejectedValueOnce(new Error("network failure")).mockResolvedValueOnce(update);
  root = createRoot(host);
  const onSettingsOpen = vi.fn();
  const render = (settingsOpen: boolean) => root!.render(<UpdateManager settingsOpen={settingsOpen} onSettingsOpen={onSettingsOpen} onSettingsClose={vi.fn()} />);
  await act(async () => render(false));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  expect(host.querySelector('[aria-label^="Actualización disponible"]')).toBeNull();
  await act(async () => render(true));
  expect(host.textContent).toContain("No se pudo comprobar o descargar");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Buscar ahora")?.click());
  expect(host.querySelector("select")?.value).toBe("manual");
  await act(async () => render(false));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label^="Actualización disponible"]')?.click());
  expect(onSettingsOpen).toHaveBeenCalledOnce();
  const onSettingsClose = vi.fn();
  await act(async () => root!.render(<UpdateManager settingsOpen onSettingsOpen={onSettingsOpen} onSettingsClose={onSettingsClose} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Cerrar configuración"]')?.click());
  expect(onSettingsClose).toHaveBeenCalledOnce();
});

test("muestra el fallback de versión y gestiona errores de descarga e instalación", async () => {
  localStorage.setItem("laural.update-mode.v1", "manual");
  mocks.getVersion.mockRejectedValue(new Error("unavailable"));
  const update = { version: "0.1.0-alpha.17", download: mocks.download, install: mocks.install, close: mocks.close };
  mocks.check.mockResolvedValue(update);
  mocks.download.mockRejectedValue(new Error("download failure"));
  root = createRoot(host);
  await act(async () => root!.render(<UpdateManager settingsOpen onSettingsOpen={vi.fn()} onSettingsClose={vi.fn()} />));
  await act(async () => Promise.resolve());
  expect(host.textContent).toContain("Desarrollo");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.startsWith("Descargar "))?.click());
  expect(host.textContent).toContain("No se pudo descargar la actualización");

  mocks.download.mockImplementation(async (onEvent: (event: unknown) => void) => onEvent({ event: "Finished" }));
  mocks.install.mockRejectedValue(new Error("installer failure"));
  mocks.check.mockResolvedValue(update);
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Buscar ahora")?.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.startsWith("Descargar "))?.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Instalar y reiniciar")?.click());
  expect(host.textContent).toContain("No se pudo iniciar el instalador");
});

test("al cambiar a automático explica el reinicio y tolera progreso sin tamaño conocido", async () => {
  localStorage.setItem("laural.update-mode.v1", "manual");
  const update = { version: "0.1.0-alpha.18", download: mocks.download, install: mocks.install, close: mocks.close };
  mocks.check.mockResolvedValue(null);
  let finishDownload: (() => void) | undefined;
  mocks.download.mockImplementation((onEvent: (event: unknown) => void) => {
    onEvent({ event: "Started", data: {} });
    onEvent({ event: "Progress", data: { chunkLength: 2048 } });
    onEvent({ event: "Finished" });
    return new Promise<void>((resolve) => { finishDownload = resolve; });
  });
  root = createRoot(host);
  await act(async () => root!.render(<UpdateManager settingsOpen onSettingsOpen={vi.fn()} onSettingsClose={vi.fn()} />));
  const select = host.querySelector<HTMLSelectElement>("select")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "automatic");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(localStorage.getItem("laural.update-mode.v1")).toBe("automatic");
  expect(host.textContent).toContain("cierra Laural y reinicia la app");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "manual");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  mocks.check.mockResolvedValue(update);
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Buscar ahora")?.click());
  await act(async () => {
    [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.startsWith("Descargar "))?.click();
    await Promise.resolve();
  });
  expect(host.querySelector("progress")?.getAttribute("aria-label")).toBe("Progreso de descarga: 2 KB descargados");
  await act(async () => finishDownload?.());
});

test("no inicia una segunda comprobación mientras la primera sigue pendiente", async () => {
  vi.useFakeTimers();
  localStorage.setItem("laural.update-mode.v1", "manual");
  let resolveCheck: ((update: null) => void) | undefined;
  mocks.check.mockImplementation(() => new Promise((resolve) => { resolveCheck = resolve; }));
  root = createRoot(host);
  await act(async () => root!.render(<UpdateManager settingsOpen onSettingsOpen={vi.fn()} onSettingsClose={vi.fn()} />));
  expect(mocks.check).toHaveBeenCalledTimes(1);

  await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000); });
  expect(mocks.check).toHaveBeenCalledTimes(1);

  await act(async () => resolveCheck?.(null));
  vi.useRealTimers();
});
