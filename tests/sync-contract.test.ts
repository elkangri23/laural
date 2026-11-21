import { describe, expect, it } from "vitest";
import sharedFixture from "../shared/fixtures/preference-snapshot-v1.json";
import type { PreferenceSnapshot } from "../src/sync/contracts";

const fixture: PreferenceSnapshot = sharedFixture;

describe("contrato del snapshot de preferencias", () => {
  it("mantiene la versión y excluye el endpoint local sin consentimiento", () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.providers[0].kind).toBe("ollama");
    expect(fixture.providers[0]).not.toHaveProperty("customEndpoint");
    expect(fixture.providers[1].customEndpoint).toBe("https://llm.example/v1");
  });

  it("no serializa campos de credenciales, agente, chat o terminal", () => {
    const forbidden = /^(apiKey|password|accessToken|refreshToken|passkey|mfa|chat|terminal|projectPath|agentPolicy)$/i;
    const inspect = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(inspect);
      } else if (value && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
          expect(key).not.toMatch(forbidden);
          inspect(nested);
        }
      }
    };

    inspect(fixture);
  });
});
