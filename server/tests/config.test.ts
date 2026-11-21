import { describe, expect, it } from "vitest";
import { readConfig, readEmailAuthConfig } from "../src/config.js";

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

  it("mantiene apagada la autenticación por correo de forma predeterminada", () => {
    expect(readEmailAuthConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("activa correo solo con clave, remitente sin controles y pepper de 32 bytes", () => {
    expect(readEmailAuthConfig({
      EMAIL_AUTH_ENABLED: "true", RESEND_API_KEY: "re_test", RESEND_FROM: "Laural <auth@example.test>", AUTH_PIN_PEPPER: "x".repeat(32),
    } as NodeJS.ProcessEnv)).toEqual({ resendApiKey: "re_test", resendFrom: "Laural <auth@example.test>", pinPepper: "x".repeat(32) });
    expect(() => readEmailAuthConfig({ EMAIL_AUTH_ENABLED: "true" } as NodeJS.ProcessEnv)).toThrow();
    expect(() => readEmailAuthConfig({
      EMAIL_AUTH_ENABLED: "true", RESEND_API_KEY: "key", RESEND_FROM: "bad\nfrom", AUTH_PIN_PEPPER: "x".repeat(32),
    } as NodeJS.ProcessEnv)).toThrow();
    expect(() => readEmailAuthConfig({
      EMAIL_AUTH_ENABLED: "true", RESEND_API_KEY: "key", RESEND_FROM: "auth@example.test", AUTH_PIN_PEPPER: "short",
    } as NodeJS.ProcessEnv)).toThrow();
  });
});
