import { describe, expect, it } from "vitest";
import { readConfig, readEmailAuthConfig } from "../src/config.js";

describe("configuración del servicio", () => {
  it("usa localhost y el puerto predeterminado", () => {
    expect(readConfig({ DATABASE_URL: "postgresql://user:pass@localhost/db", RATE_LIMIT_PEPPER: "r".repeat(32) } as NodeJS.ProcessEnv))
      .toEqual({ databaseUrl: "postgresql://user:pass@localhost/db", host: "127.0.0.1", port: 8080, rateLimitPepper: "r".repeat(32) });
  });

  it("acepta una configuración explícita válida", () => {
    expect(readConfig({ DATABASE_URL: "postgres://db/laural", HOST: "0.0.0.0", PORT: "9090", RATE_LIMIT_PEPPER: "r".repeat(32) } as NodeJS.ProcessEnv).port).toBe(9090);
  });

  it.each([
    [{}, "DATABASE_URL"],
    [{ DATABASE_URL: "https://example.test" }, "DATABASE_URL"],
    [{ DATABASE_URL: "postgres://db/laural", RATE_LIMIT_PEPPER: "r".repeat(32), PORT: "0" }, "PORT"],
    [{ DATABASE_URL: "postgres://db/laural", RATE_LIMIT_PEPPER: "r".repeat(32), PORT: "no" }, "PORT"],
    [{ DATABASE_URL: "postgres://db/laural", RATE_LIMIT_PEPPER: "r".repeat(32), HOST: "bad/host" }, "HOST"],
    [{ DATABASE_URL: "postgres://db/laural" }, "RATE_LIMIT_PEPPER"],
    [{ DATABASE_URL: "postgres://db/laural", RATE_LIMIT_PEPPER: "short" }, "RATE_LIMIT_PEPPER"],
    [{ DATABASE_URL: "postgres://db/laural", RATE_LIMIT_PEPPER: "x".repeat(257) }, "RATE_LIMIT_PEPPER"],
  ])("rechaza configuración inválida %#", (environment) => {
    expect(() => readConfig(environment as NodeJS.ProcessEnv)).toThrow();
  });

  it("mantiene apagada la autenticación por correo de forma predeterminada", () => {
    expect(readEmailAuthConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("activa correo solo con claves, remitente sin controles y parámetros TOTP válidos", () => {
    expect(readEmailAuthConfig({
      EMAIL_AUTH_ENABLED: "true", RESEND_API_KEY: "re_test", RESEND_FROM: "Laural <auth@example.test>", AUTH_PIN_PEPPER: "x".repeat(32), AUTH_RECOVERY_PEPPER: "y".repeat(32), TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    } as NodeJS.ProcessEnv)).toMatchObject({ resendApiKey: "re_test", resendFrom: "Laural <auth@example.test>", pinPepper: "x".repeat(32), recoveryPepper: "y".repeat(32), totpEncryptionKey: Buffer.alloc(32, 7) });
    expect(() => readEmailAuthConfig({ EMAIL_AUTH_ENABLED: "true" } as NodeJS.ProcessEnv)).toThrow();
    expect(() => readEmailAuthConfig({
      EMAIL_AUTH_ENABLED: "true", RESEND_API_KEY: "key", RESEND_FROM: "bad\nfrom", AUTH_PIN_PEPPER: "x".repeat(32), AUTH_RECOVERY_PEPPER: "y".repeat(32), TOTP_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64url"),
    } as NodeJS.ProcessEnv)).toThrow();
    expect(() => readEmailAuthConfig({
      EMAIL_AUTH_ENABLED: "true", RESEND_API_KEY: "key", RESEND_FROM: "auth@example.test", AUTH_PIN_PEPPER: "short", AUTH_RECOVERY_PEPPER: "y".repeat(32), TOTP_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64url"),
    } as NodeJS.ProcessEnv)).toThrow();
  });
});
