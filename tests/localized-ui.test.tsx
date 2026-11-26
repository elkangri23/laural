// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { AgentActivity } from "../src/components/AgentActivity";
import { ChatMessageItem } from "../src/components/ChatMessageItem";
import { CommandBlockItem } from "../src/components/CommandBlockItem";
import { CommandPalette } from "../src/components/CommandPalette";
import { GitPanel } from "../src/components/GitPanel";
import { HelpDialog } from "../src/components/HelpDialog";
import { NotificationCenter } from "../src/components/NotificationCenter";
import { LanguageProvider } from "../src/i18n";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

let root: Root | undefined;
let host: HTMLDivElement;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

test("traduce los controles de diálogos y conserva el aviso libre del backend", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.invoke.mockResolvedValue([]);
  localStorage.setItem("laural.language.v1", "en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const noop = vi.fn();

  await act(async () => root!.render(<LanguageProvider><>
    <HelpDialog onClose={noop} onConfigureProvider={noop} onOpenSettings={noop} onOpenPalette={noop} />
    <NotificationCenter syncNotice="La sincronización está pendiente." onClose={noop} onOpenUpdates={noop} onOpenAccount={noop} />
    <AgentActivity />
    <ChatMessageItem message={{ id: "user", role: "user", content: "texto original" }} />
    <CommandBlockItem block={{ id: "running", terminalId: "t1", command: "git status", output: "", status: "running", exitCode: null }} />
    <CommandPalette commands={[]} actions={[]} view="history" onClose={noop} />
    <GitPanel projectPath={null} onClose={noop} onOpenProject={noop} onIncludeDiff={noop} />
  </></LanguageProvider>));

  expect(host.textContent).toContain("How can we help?");
  expect(host.textContent).toContain("Notifications");
  expect(host.textContent).toContain("La sincronización está pendiente.");
  expect(host.textContent).toContain("Agent activity");
  expect(host.textContent).toContain("You");
  expect(host.textContent).toContain("Running");
  expect(host.textContent).toContain("Command history");
  expect(host.textContent).toContain("There are no recent commands in this session yet.");
  expect(host.textContent).toContain("Open a project folder to view its Git status.");
  expect(host.querySelector('[aria-label="Close help"]')).not.toBeNull();
});
