// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AssistantMarkdown } from "../src/components/AssistantMarkdown";
import { LanguageProvider } from "../src/i18n";

let host: HTMLDivElement;
let root: Root;

function renderMarkdown(content: string, language: "es" | "en" = "es") {
  localStorage.setItem("laural.language.v1", language);
  return root.render(<LanguageProvider><AssistantMarkdown content={content} /></LanguageProvider>);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

test("renderiza formato, listas, tablas y código como elementos legibles", async () => {
  const markdown = "# Resumen\n\n**Listo** y `npm test`.\n\n- Uno\n- Dos\n\n```ts\nconst ok = true;\n```\n\n| Campo | Valor |\n| --- | --- |\n| Estado | Bien |";
  await act(async () => renderMarkdown(markdown));

  expect(host.querySelector("h1")?.textContent).toBe("Resumen");
  expect(host.querySelector("strong")?.textContent).toBe("Listo");
  expect(host.querySelectorAll("ul li")).toHaveLength(2);
  expect(host.querySelector("pre code")?.textContent).toContain("const ok = true;");
  expect(host.querySelector("table td")?.textContent).toBe("Estado");
  expect(host.textContent).not.toContain("**Listo**");
});

test("no ejecuta HTML, enlaces javascript ni carga imágenes remotas", async () => {
  const markdown = "<img src=x onerror=alert(1)>\n\n[enlace](javascript:alert(1))\n\n![secreto](https://example.com/tracker.png)";
  await act(async () => renderMarkdown(markdown));

  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector("script")).toBeNull();
  expect(host.querySelector("a")?.getAttribute("href")).toBe("");
  expect(host.textContent).toContain("Imagen omitida: secreto");
  expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
});

test("solo conserva fragmentos y protocolos web o mailto, y omite imágenes sin alt", async () => {
  const markdown = "[fragmento](#seccion) [web segura](https://example.com) [web](http://example.org) [correo](mailto:help@example.com) [inválido](invalid-relative-path)\n\n![](https://example.com/tracker.png)";
  await act(async () => renderMarkdown(markdown, "en"));

  expect(host.querySelector('a[href="#seccion"]')).not.toBeNull();
  expect(host.querySelector('a[href="https://example.com"]')).not.toBeNull();
  expect(host.querySelector('a[href="http://example.org"]')).not.toBeNull();
  expect(host.querySelector('a[href="mailto:help@example.com"]')).not.toBeNull();
  expect(host.querySelector('a[href=""]')).not.toBeNull();
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toContain("Image omitted");
});
