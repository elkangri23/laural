// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { detectLanguage, initialLanguage, LanguageProvider, useLanguage } from "../src/i18n";

let root: Root | undefined;
let host: HTMLDivElement;

function LanguageProbe() {
  const { language, messages, setLanguage } = useLanguage();
  return <div>
    <span data-testid="language">{language}</span>
    <span data-testid="settings-title">{messages.settings.title}</span>
    <button onClick={() => setLanguage(language === "es" ? "en" : "es")}>Cambiar</button>
  </div>;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

test("detecta inglés y mantiene español como alternativa", () => {
  expect(detectLanguage("en-GB")).toBe("en");
  expect(detectLanguage("es-MX")).toBe("es");
  expect(detectLanguage("fr-FR")).toBe("es");
  expect(detectLanguage(undefined)).toBe("es");
});

test("conserva una selección válida y reemplaza valores desconocidos por el idioma del sistema", () => {
  vi.stubGlobal("navigator", { language: "en-US" });
  localStorage.setItem("laural.language.v1", "es");
  expect(initialLanguage()).toBe("es");

  localStorage.setItem("laural.language.v1", "fr");
  expect(initialLanguage()).toBe("en");
  expect(localStorage.getItem("laural.language.v1")).toBe("en");
});

test("cambia la interfaz del catálogo y persiste la selección local", async () => {
  vi.stubGlobal("navigator", { language: "es-ES" });
  await act(async () => root!.render(<LanguageProvider><LanguageProbe /></LanguageProvider>));
  expect(host.querySelector('[data-testid="settings-title"]')?.textContent).toBe("Configuración");

  await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
  expect(host.querySelector('[data-testid="language"]')?.textContent).toBe("en");
  expect(host.querySelector('[data-testid="settings-title"]')?.textContent).toBe("Settings");
  expect(localStorage.getItem("laural.language.v1")).toBe("en");
  expect(document.documentElement.lang).toBe("en");
});
