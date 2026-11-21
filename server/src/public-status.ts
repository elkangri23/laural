import { open } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";

const MAX_STATUS_BYTES = 16 * 1024;
const statusSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["state", "summary", "updatedAt", "notices"],
  properties: {
    state: { enum: ["unknown", "operational", "degraded", "maintenance"] },
    summary: { type: "string", minLength: 1, maxLength: 240 },
    updatedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$", maxLength: 40 },
    notices: {
      type: "array", maxItems: 8,
      items: {
        type: "object", additionalProperties: false,
        required: ["kind", "title", "message", "updatedAt"],
        properties: {
          kind: { enum: ["incident", "maintenance", "notice"] },
          title: { type: "string", minLength: 1, maxLength: 100 },
          message: { type: "string", minLength: 1, maxLength: 600 },
          updatedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$", maxLength: 40 },
        },
      },
    },
  },
} as const;

export type PublicStatus = {
  state: "unknown" | "operational" | "degraded" | "maintenance";
  summary: string;
  updatedAt: string;
  notices: { kind: "incident" | "maintenance" | "notice"; title: string; message: string; updatedAt: string }[];
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateStatus = ajv.compile<PublicStatus>(statusSchema);

export async function readPublicStatus(path?: string): Promise<PublicStatus> {
  const source = path ?? new URL("../web/status.json", import.meta.url);
  const handle = await open(source, "r");
  let content: string;
  try {
    const { size } = await handle.stat();
    if (size > MAX_STATUS_BYTES) throw new Error("Status document exceeds the size limit.");
    const buffer = Buffer.alloc(MAX_STATUS_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_STATUS_BYTES) throw new Error("Status document exceeds the size limit.");
    content = buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
  const parsed: unknown = JSON.parse(content);
  if (!validateStatus(parsed) || !isValidUtc(parsed.updatedAt) || parsed.notices.some((notice) => !isValidUtc(notice.updatedAt))) {
    throw new Error("Status document is invalid.");
  }
  return parsed;
}

function isValidUtc(value: string): boolean {
  try {
    const canonical = new Date(value).toISOString();
    return canonical === value || canonical.replace(".000Z", "Z") === value;
  } catch {
    return false;
  }
}

export function unavailableStatus(): PublicStatus {
  return {
    state: "unknown",
    summary: "No se pudo comprobar el estado actualizado del servicio.",
    updatedAt: new Date().toISOString(),
    notices: [],
  };
}
