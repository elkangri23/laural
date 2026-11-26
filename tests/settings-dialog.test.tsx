// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SettingsDialog } from "../src/components/SettingsDialog";
import { LanguageProvider } from "../src/i18n";

let root: Root | undefined;
let host: HTMLDivElement;
let showModal: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;
let originalShowModal: PropertyDescriptor | undefined;
let originalClose: PropertyDescriptor | undefined;

beforeEach(() => {
  localStorage.setItem("laural.language.v1", "es");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: showModal });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: close });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
  vi.unstubAllGlobals();
});

const sections = Object.fromEntries([
  ["personalization", <button key="personalization">Apariencia</button>],
  ["ai", <button key="ai">Proveedores</button>],
  ["agent", <button key="agent">Agente</button>],
  ["data", <button key="data">Datos</button>],
  ["application", <button key="application">Aplicación</button>],
]) as Parameters<typeof SettingsDialog>[0]["sections"];

function renderDialog(onClose: () => void, activeCategory: Parameters<typeof SettingsDialog>[0]["activeCategory"] = "personalization", onCategoryChange = vi.fn()) {
  act(() => root!.render(<LanguageProvider><SettingsDialog onClose={onClose} sections={sections} activeCategory={activeCategory} onCategoryChange={onCategoryChange} /></LanguageProvider>));
}

test("abre como diálogo modal y enfoca el título para orientar al teclado", () => {
  const onClose = vi.fn();
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();

  renderDialog(onClose);
  opener.remove();

  const dialog = host.querySelector("dialog")!;
  const title = host.querySelector("h2")!;
  expect(showModal).toHaveBeenCalledOnce();
  expect(dialog.getAttribute("aria-labelledby")).toBe("modal-shell-title");
  expect(title.tabIndex).toBe(-1);
  expect(document.activeElement).toBe(title);
});

test("Escape cierra Configuración mediante el evento nativo de cancelación", () => {
  const onClose = vi.fn();
  renderDialog(onClose);

  const cancel = new Event("cancel", { cancelable: true });
  act(() => host.querySelector("dialog")!.dispatchEvent(cancel));

  expect(cancel.defaultPrevented).toBe(true);
  expect(onClose).toHaveBeenCalledOnce();
});

test("presenta cinco categorías y muestra el contenido seleccionado", () => {
  const onCategoryChange = vi.fn();
  renderDialog(vi.fn(), "agent", onCategoryChange);
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(5);
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Agente y terminal");
  expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain("Agente");
  act(() => (host.querySelector('[role="tab"][aria-selected="false"]') as HTMLButtonElement).click());
  expect(onCategoryChange).toHaveBeenCalledWith("personalization");
});

test("cambia y navega categorías con teclas de flecha, Inicio y Fin", () => {
  const onCategoryChange = vi.fn();
  renderDialog(vi.fn(), "personalization", onCategoryChange);
  const firstTab = host.querySelector('[role="tab"]') as HTMLButtonElement;
  act(() => firstTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })));
  expect(onCategoryChange).toHaveBeenLastCalledWith("application");
  expect(document.activeElement?.textContent).toBe("Aplicación");
  act(() => firstTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
  expect(onCategoryChange).toHaveBeenLastCalledWith("ai");
  act(() => firstTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
  expect(onCategoryChange).toHaveBeenLastCalledWith("ai");
  act(() => firstTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })));
  expect(onCategoryChange).toHaveBeenLastCalledWith("application");
  act(() => (document.activeElement as HTMLButtonElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true })));
  expect(onCategoryChange).toHaveBeenLastCalledWith("personalization");
  act(() => firstTab.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })));
  expect(onCategoryChange).toHaveBeenLastCalledWith("application");
  act(() => firstTab.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true })));
  expect(onCategoryChange).toHaveBeenCalledTimes(6);
});

test("permite seleccionar categoría en el selector compacto", () => {
  const onCategoryChange = vi.fn();
  renderDialog(vi.fn(), "personalization", onCategoryChange);
  const select = host.querySelector(".settings-compact-nav select") as HTMLSelectElement;
  act(() => {
    Object.defineProperty(select, "value", { configurable: true, value: "data" });
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onCategoryChange).toHaveBeenCalledWith("data");
});
