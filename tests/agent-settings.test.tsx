// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AgentSettings, type ExecutionMode } from "../src/components/AgentSettings";
import { LanguageProvider, type Language } from "../src/i18n";

const retentionMock = vi.hoisted(() => ({ onChange: undefined as ((days: number | null) => void) | undefined, value: null as number | null }));
vi.mock("../src/components/BackupRetentionControl", () => ({
  BackupRetentionControl: (props: { value: number | null; onChange: (days: number | null) => void }) => {
    retentionMock.onChange = props.onChange;
    retentionMock.value = props.value;
    return <button type="button" data-testid="retention" onClick={() => props.onChange(20)}>Retención {props.value ?? "ilimitada"}</button>;
  },
}));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.setItem("laural.language.v1", "es");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  retentionMock.onChange = undefined;
  retentionMock.value = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render(mode: ExecutionMode, policyNotice = "", backupRetention: number | null = null, withChildren = true, language: Language = "es") {
  const onModeChange = vi.fn();
  const onRulesChange = vi.fn();
  const onSaveRules = vi.fn();
  const onBackupRetentionChange = vi.fn();
  const onPredictionChange = vi.fn();
  localStorage.setItem("laural.language.v1", language);
  act(() => root.render(<LanguageProvider><AgentSettings
    mode={mode}
    onModeChange={onModeChange}
    rules="git status"
    onRulesChange={onRulesChange}
    onSaveRules={onSaveRules}
    backupRetention={backupRetention}
    onBackupRetentionChange={onBackupRetentionChange}
    powerShellPredictionEnabled={false}
    onPowerShellPredictionChange={onPredictionChange}
    policyNotice={policyNotice}
  >{withChildren ? <p>Actividad del agente</p> : undefined}</AgentSettings></LanguageProvider>));
  return { onModeChange, onRulesChange, onSaveRules, onBackupRetentionChange, onPredictionChange };
}

test("muestra políticas sin aviso, reglas ni contenido opcional en modo revisión", () => {
  const callbacks = render("review", "", null, false);
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.querySelector(".policy-notice")).toBeNull();
  expect(host.textContent).toContain("Los cambios de archivos siempre requieren aprobación.");
  expect(host.textContent).toContain("Sugerencias locales de PowerShell");
  const prediction = host.querySelector<HTMLInputElement>(".powershell-prediction-setting input")!;
  expect(prediction.checked).toBe(false);
  act(() => prediction.click());
  expect(callbacks.onPredictionChange).toHaveBeenCalledWith(true);
  expect(host.textContent).not.toContain("Actividad del agente");
  expect(retentionMock.value).toBeNull();
});

test("permite editar y guardar reglas cuando se elige el modo por reglas", () => {
  const callbacks = render("rules", "Reglas guardadas", 20);
  const textarea = host.querySelector("textarea")!;
  expect(textarea.value).toBe("git status");
  expect(host.querySelector(".policy-notice")?.textContent).toBe("Reglas guardadas");
  expect(retentionMock.value).toBe(20);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "git diff");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelector(".rules-editor button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const modeSelect = host.querySelector("select")!;
    modeSelect.value = "automatic";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(callbacks.onSaveRules).toHaveBeenCalledOnce();
  expect(callbacks.onRulesChange).toHaveBeenCalledWith("git diff");
  expect(callbacks.onModeChange).toHaveBeenCalledWith("automatic");
  act(() => (host.querySelector('[data-testid="retention"]') as HTMLButtonElement).click());
  expect(callbacks.onBackupRetentionChange).toHaveBeenCalledWith(20);
});

test("representa el modo automático y permite cambiar el modo desde el selector", () => {
  const callbacks = render("automatic");
  expect(host.querySelector("select")?.value).toBe("automatic");
  expect(host.querySelector("textarea")).toBeNull();
  const select = host.querySelector("select")!;
  act(() => {
    select.value = "review";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(callbacks.onModeChange).toHaveBeenCalledWith("review");
  expect(host.textContent).toContain("Actividad del agente");
});

test("localiza las opciones sensibles de aprobación y PowerShell en inglés", () => {
  render("rules", "Rules saved", null, false, "en");

  const select = host.querySelector("select")!;
  expect(host.querySelector("label")?.textContent).toContain("Agent permissions");
  expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
    "Confirm every command",
    "Run allowed rules",
    "Automatic for Git status queries",
  ]);
  const rules = host.querySelector("textarea")!;
  expect(rules.placeholder).toBe("One exact command per line");
  expect(rules.getAttribute("aria-label")).toBe("Exact allowed commands, one per line");
  expect(host.querySelector(".rules-editor button")?.textContent).toBe("Save rules");
  expect(host.querySelector(".policy-notice")?.textContent).toBe("Rules saved");
  expect(host.querySelector(".powershell-prediction-setting")?.textContent).toContain("Local PowerShell suggestions");
  expect(host.querySelector(".powershell-prediction-setting")?.textContent).toContain("PSReadLine history");
  expect(host.textContent).toContain("File changes always require approval.");
  expect(host.textContent).toContain("Filters do not isolate the shell.");
});
