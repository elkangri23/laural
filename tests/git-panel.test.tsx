// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { LanguageProvider } from "../src/i18n";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GitPanel } from "../src/components/GitPanel";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

let root: Root | undefined;
let host: HTMLDivElement;

function renderWithLanguage(children: ReactNode) {
  localStorage.setItem("laural.language.v1", "es");
  return root!.render(<LanguageProvider>{children}</LanguageProvider>);
}
const props = { projectPath: "C:/proyecto", onClose: vi.fn(), onOpenProject: vi.fn(), onIncludeDiff: vi.fn() };

beforeEach(() => {
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "get_git_status") return { root: "C:/proyecto", branch: "feature/git", changes: [{ code: "M", path: "src/App.tsx" }] };
    if (command === "get_git_diff") return { content: "diff --git a/src/App.tsx b/src/App.tsx\n+ cambio", truncated: false };
    return undefined;
  });
  props.onClose.mockReset();
  props.onOpenProject.mockReset();
  props.onIncludeDiff.mockReset();
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

test("muestra rama, cambios y diff sin pedir ejecución ni contexto", async () => {
  await act(async () => renderWithLanguage(<GitPanel {...props} />));
  expect(host.textContent).toContain("feature/git");
  expect(host.textContent).toContain("src/App.tsx");
  expect(host.textContent).toContain("diff --git");
  expect(host.textContent).toContain("solo se comparte con el modelo si eliges incluirlo");
  expect(mocks.invoke).toHaveBeenCalledWith("get_git_status", { projectPath: props.projectPath });
  expect(mocks.invoke).toHaveBeenCalledWith("get_git_diff", { projectPath: props.projectPath });
});

test("solo añade el diff al contexto tras una acción explícita", async () => {
  await act(async () => renderWithLanguage(<GitPanel {...props} />));
  await act(async () => (host.querySelector("button.git-include-diff") as HTMLButtonElement).click());

  expect(props.onIncludeDiff).toHaveBeenCalledWith("diff --git a/src/App.tsx b/src/App.tsx\n+ cambio", false);
});

test("ofrece elegir proyecto cuando no hay una carpeta abierta", async () => {
  await act(async () => renderWithLanguage(<GitPanel projectPath={null} onClose={props.onClose} onOpenProject={props.onOpenProject} onIncludeDiff={props.onIncludeDiff} />));
  expect(host.textContent).toContain("Abre una carpeta de proyecto");
  await act(async () => (host.querySelector("button.action-primary") as HTMLButtonElement).click());
  expect(props.onOpenProject).toHaveBeenCalledOnce();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

test("informa de errores de lectura del repositorio", async () => {
  mocks.invoke.mockRejectedValueOnce("La carpeta seleccionada no contiene un repositorio Git.");
  await act(async () => renderWithLanguage(<GitPanel {...props} />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("no contiene un repositorio Git");
});
