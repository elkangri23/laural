// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { LanguageProvider } from "../src/i18n";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CommandBlockItem, type CommandBlock } from "../src/components/CommandBlockItem";

let root: Root | undefined;
let host: HTMLDivElement;

function renderWithLanguage(children: ReactNode) {
  localStorage.setItem("laural.language.v1", "es");
  return root!.render(<LanguageProvider>{children}</LanguageProvider>);
}
const stableBlock: CommandBlock = {
  id: "terminado",
  terminalId: "uno",
  command: "git status",
  output: "limpio\u001b[31m seguro\u001b[0m",
  status: "finished",
  exitCode: 0,
};
const runningBlock: CommandBlock = {
  id: "activo",
  terminalId: "uno",
  command: "npm test",
  output: "",
  status: "running",
  exitCode: null,
};
const unknownExitBlock: CommandBlock = {
  ...stableBlock,
  id: "sin-codigo",
  command: "comando editado",
  status: "finished",
  exitCode: null,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("memoiza cada bloque y limpia el formato de terminal de su salida", async () => {
  await act(async () => renderWithLanguage(<>
    <CommandBlockItem block={stableBlock} />
    <CommandBlockItem block={runningBlock} />
    <CommandBlockItem block={unknownExitBlock} />
  </>));

  expect(CommandBlockItem).toHaveProperty("$$typeof", Symbol.for("react.memo"));
  expect(host.textContent).toContain("Sin salida capturada.");
  expect(host.querySelector('[data-status="running"]')).not.toBeNull();
  expect(host.textContent).toContain("Salida 0");
  expect(host.textContent).toContain("Finalizado");
  expect(host.textContent).toContain("limpio seguro");
  expect(host.textContent).not.toContain("\u001b");
});
