// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { BackupRetentionControl } from "../src/components/BackupRetentionControl";

let root: Root | undefined;
let host: HTMLDivElement;
const change = vi.fn();

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  change.mockReset();
  vi.unstubAllGlobals();
});

test("muestra sin límite por defecto y publica la selección", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () => root!.render(<BackupRetentionControl value={null} onChange={change} />));

  const select = host.querySelector("select")!;
  expect(select.value).toBe("none");
  expect(host.textContent).toContain("Al guardar o restaurar un archivo");
  expect([...select.options].map((option) => option.value)).toEqual(["none", "5", "10", "20", "50", "100"]);

  await act(async () => {
    select.value = "20";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(change).toHaveBeenCalledWith(20);

  await act(async () => {
    select.value = "none";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(change).toHaveBeenLastCalledWith(null);
});
