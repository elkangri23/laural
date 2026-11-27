import { describe, expect, test } from "vitest";
import { extractChatCommand } from "../src/chatCommands";

describe("extractChatCommand", () => {
  test("acepta sintaxis compatible en cada shell", () => {
    expect(extractChatCommand("powershell", "  Get-ChildItem  ", "powershell")).toBe("Get-ChildItem");
    expect(extractChatCommand("cmd", "dir", "cmd")).toBe("dir");
    expect(extractChatCommand("bash", "ls", "wsl")).toBe("ls");
    expect(extractChatCommand("shell", "pwd", "git-bash")).toBe("pwd");
  });

  test("rechaza etiquetas ausentes o incompatibles", () => {
    expect(extractChatCommand(undefined, "dir", "cmd")).toBeNull();
    expect(extractChatCommand("bash", "ls", "cmd")).toBeNull();
    expect(extractChatCommand("powershell", "Get-ChildItem", "cmd")).toBeNull();
    expect(extractChatCommand(" BASH ", "ls", "wsl")).toBe("ls");
  });

  test("rechaza contenido vacío, multilínea, con controles o demasiado largo", () => {
    expect(extractChatCommand("cmd", "  \n  ", "cmd")).toBeNull();
    expect(extractChatCommand("cmd", "dir\nwhoami", "cmd")).toBeNull();
    expect(extractChatCommand("cmd", "dir\u2028whoami", "cmd")).toBeNull();
    expect(extractChatCommand("cmd", "dir\u0001", "cmd")).toBeNull();
    expect(extractChatCommand("cmd", "x".repeat(4_001), "cmd")).toBeNull();
    expect(extractChatCommand("cmd", "x".repeat(4_000), "cmd")).toHaveLength(4_000);
  });
});
