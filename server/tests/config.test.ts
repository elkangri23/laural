import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

describe("configuración del servicio", () => {
  it("usa localhost y el puerto predeterminado", () => {
    expect(readConfig({ DATABASE_URL: "postgresql://user:pass@localhost/db" } as NodeJS.ProcessEnv))
      .toEqual({ databaseUrl: "postgresql://user:pass@localhost/db", host: "127.0.0.1", port: 8080 });
  });

  it("acepta una configuración explícita válida", () => {
    expect(readConfig({ DATABASE_URL: "postgres://db/laural", HOST: "0.0.0.0", PORT: "9090" } as NodeJS.ProcessEnv).port).toBe(9090);
  });

  it.each([
    [{}, "DATABASE_URL"],
    [{ DATABASE_URL: "https://example.test" }, "DATABASE_URL"],
    [{ DATABASE_URL: "postgres://db/laural", PORT: "0" }, "PORT"],
    [{ DATABASE_URL: "postgres://db/laural", PORT: "no" }, "PORT"],
    [{ DATABASE_URL: "postgres://db/laural", HOST: "bad/host" }, "HOST"],
  ])("rechaza configuración inválida %#", (environment) => {
    expect(() => readConfig(environment as NodeJS.ProcessEnv)).toThrow();
  });
});
