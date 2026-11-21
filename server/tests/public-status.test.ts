import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPublicStatus, unavailableStatus } from "../src/public-status.js";

const directories: string[] = [];
async function statusFile(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "laural-status-test-"));
  directories.push(directory);
  const path = join(directory, "status.json");
  await writeFile(path, content, "utf8");
  return path;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("documento de estado público", () => {
  it("valida y lee los campos públicos permitidos", async () => {
    const data = {
      state: "degraded",
      summary: "Sincronización intermitente.",
      updatedAt: "2026-11-21T10:15:00Z",
      notices: [{ kind: "incident", title: "Latencia", message: "Estamos investigando demoras.", updatedAt: "2026-11-21T10:00:00Z" }],
    };
    expect(await readPublicStatus(await statusFile(JSON.stringify(data)))).toEqual(data);
  });

  it("rechaza propiedades privadas o estados que no estén en el contrato", async () => {
    const data = { state: "operational", summary: "OK", updatedAt: "2026-11-21T10:15:00Z", notices: [], accountCount: 100 };
    await expect(readPublicStatus(await statusFile(JSON.stringify(data)))).rejects.toThrow("invalid");
    await expect(readPublicStatus(await statusFile(JSON.stringify({ ...data, accountCount: undefined, state: "debug" })))).rejects.toThrow("invalid");
    await expect(readPublicStatus(await statusFile(JSON.stringify({ ...data, accountCount: undefined, updatedAt: "2026-99-99T99:99:99Z" })))).rejects.toThrow("invalid");
  });

  it("rechaza un archivo que no contiene JSON", async () => {
    await expect(readPublicStatus(await statusFile("{"))).rejects.toThrow();
  });

  it("limita el tamaño y no devuelve detalles internos en el estado de reserva", async () => {
    await expect(readPublicStatus(await statusFile(" ".repeat(16 * 1024 + 1)))).rejects.toThrow("size limit");
    const fallback = unavailableStatus();
    expect(fallback.state).toBe("unknown");
    expect(fallback.notices).toEqual([]);
    expect(JSON.stringify(fallback)).not.toContain("Error");
  });
});
