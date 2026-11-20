// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SettingsDialog } from "../src/components/SettingsDialog";

let root: Root | undefined;
let host: HTMLDivElement;
let showModal: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;
let originalShowModal: PropertyDescriptor | undefined;
let originalClose: PropertyDescriptor | undefined;

beforeEach(() => {
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

function renderDialog(onClose: () => void, children: ReactNode = <button>Guardar</button>) {
  act(() => root!.render(<SettingsDialog onClose={onClose}>{children}</SettingsDialog>));
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
  expect(dialog.getAttribute("aria-labelledby")).toBe("settings-title");
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
