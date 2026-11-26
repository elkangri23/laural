import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import schemaV1 from "../../shared/preference-snapshot-v1.schema.json" with { type: "json" };
import schemaV2 from "../../shared/preference-snapshot-v2.schema.json" with { type: "json" };
import fixtureV1 from "../../shared/fixtures/preference-snapshot-v1.json" with { type: "json" };
import fixtureV2 from "../../shared/fixtures/preference-snapshot-v2.json" with { type: "json" };
import {
  snapshotAppearances,
  snapshotProviderKinds,
  snapshotThemeIds,
  snapshotUpdateModes,
} from "../../shared/preference-snapshot-v1-enums.js";
import { snapshotLanguages } from "../../shared/preference-snapshot-v2-enums.js";
import type { PreferenceSnapshotV2 } from "../../shared/preference-snapshot-v2.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateV1 = ajv.compile(schemaV1);
const validateV2 = ajv.compile<PreferenceSnapshotV2>(schemaV2);

describe("schemas canónicos de snapshots", () => {
  it("valida los fixtures compartidos v1 y v2", () => {
    expect(validateV1(fixtureV1)).toBe(true);
    expect(validateV2(fixtureV2)).toBe(true);
  });

  it("mantiene enums de preferencias y proveedores idénticos en ambos formatos", () => {
    for (const themeId of snapshotThemeIds) {
      expect(validateV1({ ...fixtureV1, preferences: { ...fixtureV1.preferences, themeId } })).toBe(true);
      expect(validateV2({ ...fixtureV2, preferences: { ...fixtureV2.preferences, themeId } })).toBe(true);
    }
    for (const kind of snapshotProviderKinds) {
      expect(validateV1({ ...fixtureV1, providers: [{ ...fixtureV1.providers[0], kind }] })).toBe(true);
      expect(validateV2({ ...fixtureV2, providers: [{ ...fixtureV2.providers[0], kind }] })).toBe(true);
    }
    for (const appearance of snapshotAppearances) {
      expect(validateV1({ ...fixtureV1, preferences: { ...fixtureV1.preferences, appearance } })).toBe(true);
      expect(validateV2({ ...fixtureV2, preferences: { ...fixtureV2.preferences, appearance } })).toBe(true);
    }
    for (const updateMode of snapshotUpdateModes) {
      expect(validateV1({ ...fixtureV1, preferences: { ...fixtureV1.preferences, updateMode } })).toBe(true);
      expect(validateV2({ ...fixtureV2, preferences: { ...fixtureV2.preferences, updateMode } })).toBe(true);
    }
    for (const language of snapshotLanguages) {
      expect(validateV2({ ...fixtureV2, preferences: { ...fixtureV2.preferences, language } })).toBe(true);
    }
  });

  it("mantiene las enumeraciones TypeScript idénticas al schema canónico", () => {
    for (const schema of [schemaV1, schemaV2]) {
      expect(schema.properties.preferences.properties.themeId.enum).toEqual(snapshotThemeIds);
      expect(schema.properties.preferences.properties.appearance.enum).toEqual(snapshotAppearances);
      expect(schema.properties.preferences.properties.updateMode.enum).toEqual(snapshotUpdateModes);
      expect(schema.properties.providers.items.properties.kind.enum).toEqual(snapshotProviderKinds);
    }
    expect(schemaV2.properties.preferences.properties.language.enum).toEqual(snapshotLanguages);
  });

  it("rechaza secretos, campos desconocidos y valores fuera de cada versión", () => {
    expect(validateV1({ ...fixtureV1, accessToken: "secreto" })).toBe(false);
    expect(validateV2({ ...fixtureV2, accessToken: "secreto" })).toBe(false);
    expect(validateV1({ ...fixtureV1, providers: [{ ...fixtureV1.providers[0], apiKey: "secreto" }] })).toBe(false);
    expect(validateV2({ ...fixtureV2, providers: [{ ...fixtureV2.providers[0], apiKey: "secreto" }] })).toBe(false);
    expect(validateV1({ ...fixtureV1, preferences: { ...fixtureV1.preferences, themeId: "tema-inexistente" } })).toBe(false);
    expect(validateV2({ ...fixtureV2, preferences: { ...fixtureV2.preferences, language: "fr" } })).toBe(false);
    expect(validateV2({ ...fixtureV2, preferences: { themeId: "laurel", appearance: "dark", updateMode: "manual" } })).toBe(false);
    expect(validateV1({ ...fixtureV1, preferences: { ...fixtureV1.preferences, language: "en" } })).toBe(false);
    expect(validateV1({ ...fixtureV1, schemaVersion: 3 })).toBe(false);
    expect(validateV2({ ...fixtureV2, schemaVersion: 3 })).toBe(false);
  });
});
