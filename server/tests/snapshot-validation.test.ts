import { describe, expect, it } from "vitest";
import fixtureV1 from "../../shared/fixtures/preference-snapshot-v1.json" with { type: "json" };
import fixtureV2 from "../../shared/fixtures/preference-snapshot-v2.json" with { type: "json" };
import { isPreferenceSnapshot } from "../src/snapshot-validation.js";

describe("validación de snapshots aceptados por el servicio", () => {
  it("acepta snapshots v1 y v2", () => {
    expect(isPreferenceSnapshot(fixtureV1)).toBe(true);
    expect(isPreferenceSnapshot(fixtureV2)).toBe(true);
  });

  it("rechaza snapshots desconocidos, idiomas inválidos y propiedades secretas", () => {
    expect(isPreferenceSnapshot({ schemaVersion: 3 })).toBe(false);
    expect(isPreferenceSnapshot({ ...fixtureV2, preferences: { ...fixtureV2.preferences, language: "fr" } })).toBe(false);
    expect(isPreferenceSnapshot({ ...fixtureV1, providers: [{ ...fixtureV1.providers[0], apiKey: "secret" }] })).toBe(false);
  });
});
