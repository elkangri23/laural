// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ModalShell } from "../src/components/ModalShell";

let root: Root;
let host: HTMLDivElement;
let showModal: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: showModal });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: close });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
  vi.unstubAllGlobals();
});

test("abre, enfoca el título, cierra con Escape y libera el diálogo al desmontarse", async () => {
  const onClose = vi.fn();
  await act(async () => root.render(<ModalShell title="Cuenta" onClose={onClose}><p>Contenido</p></ModalShell>));
  const dialog = host.querySelector("dialog")!;
  expect(showModal).toHaveBeenCalledOnce();
  expect(dialog.getAttribute("aria-labelledby")).toBe("modal-shell-title");
  expect(document.activeElement?.textContent).toBe("Cuenta");
  expect(host.querySelector('[aria-label="Cerrar cuenta"]')).not.toBeNull();
  const cancel = new Event("cancel", { cancelable: true });
  act(() => dialog.dispatchEvent(cancel));
  expect(cancel.defaultPrevented).toBe(true);
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  expect(close).toHaveBeenCalledOnce();
});

test("admite una clase de diálogo específica sin incorporar navegación de categorías", async () => {
  await act(async () => root.render(<ModalShell title="Transferencia" className="transfer-dialog" onClose={vi.fn()}><p>Archivo</p></ModalShell>));
  expect(host.querySelector("dialog")?.className).toBe("transfer-dialog");
  expect(host.querySelector('[role="tablist"]')).toBeNull();
});
