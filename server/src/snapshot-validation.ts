import { Ajv2020 } from "ajv/dist/2020.js";
import type { PreferenceSnapshot } from "./contracts.js";
import schemaV1 from "../../shared/preference-snapshot-v1.schema.json" with { type: "json" };
import schemaV2 from "../../shared/preference-snapshot-v2.schema.json" with { type: "json" };
import type { PreferenceSnapshot as PreferenceSnapshotV1 } from "../../shared/preference-snapshot-v1.js";
import type { PreferenceSnapshotV2 } from "../../shared/preference-snapshot-v2.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateV1 = ajv.compile<PreferenceSnapshotV1>(schemaV1);
const validateV2 = ajv.compile<PreferenceSnapshotV2>(schemaV2);

export function isPreferenceSnapshot(value: unknown): value is PreferenceSnapshot {
  return validateV1(value) || validateV2(value);
}
