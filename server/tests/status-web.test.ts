import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const asset = (name: string) => new URL(`../web/${name}`, import.meta.url);

describe("página estática de estado", () => {
  it("usa idioma español y carga solo recursos locales", async () => {
    const page = await readFile(asset("status.html"), "utf8");
    expect(page).toContain('<html lang="es">');
    expect(page).toContain('href="/status.css"');
    expect(page).toContain('src="/status.js"');
    expect(page).not.toMatch(/<script(?![^>]+src=)/i);
    expect(page).not.toContain("style=");
  });

  it("pinta avisos como texto, omite cookies y se actualiza periódicamente", async () => {
    const script = await readFile(asset("status.js"), "utf8");
    expect(script).toContain('credentials: "omit"');
    expect(script).toContain("textContent");
    expect(script).not.toContain("innerHTML");
    expect(script).toContain("60_000");
  });

  it("Caddy sirve la página y el documento aparte de Fastify", async () => {
    const caddy = await readFile(new URL("../deploy/Caddyfile", import.meta.url), "utf8");
    const statusHandler = caddy.indexOf("@statusPage path");
    const apiProxy = caddy.indexOf("reverse_proxy 127.0.0.1:8080");
    expect(statusHandler).toBeGreaterThanOrEqual(0);
    expect(caddy).toContain("/var/lib/laural/status");
    expect(caddy).toContain("/opt/laural/current/server/dist/server/web");
    expect(caddy).toContain("Content-Security-Policy");
    expect(apiProxy).toBeGreaterThan(statusHandler);
  });
});
