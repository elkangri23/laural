import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import schema from "../../shared/preference-snapshot-v1.schema.json" with { type: "json" };
import fixture from "../../shared/fixtures/preference-snapshot-v1.json" with { type: "json" };
import {
  snapshotAppearances,
  snapshotProviderKinds,
  snapshotThemeIds,
  snapshotUpdateModes,
} from "../../shared/preference-snapshot-v1-enums.js";
import type { PreferenceSnapshot } from "../src/contracts.js";

const validate = new Ajv2020({ allErrors: true, strict: true }).compile<PreferenceSnapshot>(schema);

describe("schema canónico del snapshot", () => {
  it("valida el fixture compartido que consume cliente y servidor", () => {
    expect(validate(fixture)).toBe(true);
  });

  it("valida cada valor enumerado del schema en el fixture", () => {
    const themes = schema.properties.preferences.properties.themeId.enum;
    const kinds = schema.properties.providers.items.properties.kind.enum;
    const appearances = schema.properties.preferences.properties.appearance.enum;
    const updateModes = schema.properties.preferences.properties.updateMode.enum;

    for (const themeId of themes) {
      expect(validate({ ...fixture, preferences: { ...fixture.preferences, themeId } })).toBe(true);
    }
    for (const kind of kinds) {
      expect(validate({ ...fixture, providers: [{ ...fixture.providers[0], kind }] })).toBe(true);
    }
    for (const appearance of appearances) {
      expect(validate({ ...fixture, preferences: { ...fixture.preferences, appearance } })).toBe(true);
    }
    for (const updateMode of updateModes) {
      expect(validate({ ...fixture, preferences: { ...fixture.preferences, updateMode } })).toBe(true);
    }
  });

  it("mantiene las enumeraciones TypeScript idénticas al schema canónico", () => {
    expect(schema.properties.preferences.properties.themeId.enum).toEqual(snapshotThemeIds);
    expect(schema.properties.preferences.properties.appearance.enum).toEqual(snapshotAppearances);
    expect(schema.properties.preferences.properties.updateMode.enum).toEqual(snapshotUpdateModes);
    expect(schema.properties.providers.items.properties.kind.enum).toEqual(snapshotProviderKinds);
  });

  it("rechaza secretos, campos desconocidos y valores fuera del contrato", () => {
    expect(validate({ ...fixture, accessToken: "secreto" })).toBe(false);
    expect(validate({ ...fixture, providers: [{ ...fixture.providers[0], apiKey: "secreto" }] })).toBe(false);
    expect(validate({ ...fixture, preferences: { ...fixture.preferences, themeId: "tema-inexistente" } })).toBe(false);
    expect(validate({ ...fixture, providers: [{ ...fixture.providers[0], kind: "provider-inexistente" }] })).toBe(false);
  });
});
