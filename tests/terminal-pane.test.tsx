// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import TerminalPane from "../src/components/TerminalPane";
import { themes } from "../src/themes";

const { invoke, listen, write, onData } = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), write: vi.fn(), onData: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = {}; parser = { registerOscHandler: () => ({ dispose() {} }) };
    write = write; writeln = write;
    loadAddon() {} open() {} focus() {} dispose() {}
    onData = onData;
  },
}));

let root: Root | undefined;
let host: HTMLDivElement;
const finished = vi.fn(), restart = vi.fn(), output = vi.fn(), submit = vi.fn();
const handlers = new Map<string, (event: { payload: unknown }) => void>();
const removeOutput = vi.fn(), removeExit = vi.fn();
function pane(visible = true) {
  return <TerminalPane terminalId="uno" shell="cmd" cwd={null} visible={visible} active={visible}
    appearance="dark" theme={themes[0]} onCommandFinish={finished} onRestart={restart}
    onTextOutput={output} onCommandSubmit={submit} />;
}
beforeEach(() => {
  vi.resetAllMocks();
  handlers.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div");
  root = createRoot(host);
  listen.mockImplementation(async (name, fn) => {
    handlers.set(name, fn);
    return name === "terminal-output" ? removeOutput : removeExit;
  });
  onData.mockReturnValue({ dispose() {} });
  invoke.mockResolvedValue(undefined);
});
async function unmount() {
  await act(async () => root?.unmount());
  root = undefined;
}
afterEach(async () => { await unmount(); vi.unstubAllGlobals(); });

test("ocultar la pestaña conserva el proceso y su salida; salir permite reiniciar", async () => {
  await act(async () => root!.render(pane()));
  await act(async () => root!.render(pane(false)));
  handlers.get("terminal-output")!({ payload: { terminalId: "uno", data: [65] } });
  expect(output).toHaveBeenCalledWith("uno", "A");
  await act(async () => root!.render(pane()));
  expect(invoke.mock.calls.filter(([name]) => name === "create_terminal")).toHaveLength(1);
  await act(async () => handlers.get("terminal-exit")!({ payload: "otro" }));
  expect(host.querySelector("button")).toBeNull();
  await act(async () => handlers.get("terminal-exit")!({ payload: "uno" }));
  expect(finished).toHaveBeenCalledWith("uno", null);
  host.querySelector("button")!.click();
  expect(restart).toHaveBeenCalledOnce();
  await unmount();
  expect(removeOutput).toHaveBeenCalledOnce();
  expect(removeExit).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledWith("close_terminal", { terminalId: "uno" });
});

test("cerrar mientras se registra la salida evita arrancar el proceso", async () => {
  let subscribed!: (remove: () => void) => void;
  listen.mockImplementationOnce(() => new Promise(resolve => { subscribed = resolve; }));
  await act(async () => root!.render(pane()));
  await unmount();
  await act(async () => subscribed(removeOutput));
  expect(removeOutput).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
});

test("cerrar durante el arranque espera al proceso y después lo cierra", async () => {
  let started!: () => void;
  invoke.mockImplementationOnce(() => new Promise<void>(resolve => { started = resolve; }));
  await act(async () => root!.render(pane()));
  await unmount();
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["create_terminal"]);
  await act(async () => started());
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["create_terminal", "close_terminal"]);
});

test("entrega la respuesta del cursor cuando termina el arranque", async () => {
  let started!: () => void;
  invoke.mockImplementationOnce(() => new Promise<void>(resolve => { started = resolve; }));
  await act(async () => root!.render(pane()));
  onData.mock.calls[0][0]("\x1b[1;1R");
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["create_terminal"]);
  await act(async () => started());
  expect(invoke).toHaveBeenCalledWith("write_terminal", { terminalId: "uno", data: "\x1b[1;1R" });
});
