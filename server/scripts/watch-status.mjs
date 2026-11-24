// Chequeo automático del estado público del servicio de sincronización.
// Se ejecuta cada 5 minutos desde cron en el VPS: comprueba la salud de la
// API por la URL pública (para probar el camino real: nginx + TLS + API)
// y, solo si cambia el estado derivado, republica status.json.
//
// Reglas:
// - El estado "maintenance" lo gestiona una persona: el script no lo toca.
// - Conserva los avisos y el componente de correo tal como están publicados
//   (el correo no se puede comprobar con un chequeo barato).
// - Un resultado malo se confirma con una segunda comprobación antes de
//   publicar "degradado", para no marcar una caída por un reinicio breve.
// - Es autocontenido (no importa dist/): refleja el esquema de
//   server/src/public-status.ts. Si ese esquema cambia, hay que revisar
//   este script. La validación completa la hace el validador del repo
//   (npm run status:validate).

import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASE_URL = "https://sync.laurafernandezenfermeria.com";
export const DEFAULT_STATUS_FILE = "/var/lib/laural/status/status.json";

const COMPONENT_IDS = ["api", "sync", "email"];
const STATES = ["unknown", "operational", "degraded", "maintenance"];
const NOTICE_KINDS = ["incident", "maintenance", "notice"];
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const OPERATIONAL_SUMMARY = "Servicio de sincronización en funcionamiento. Registro abierto.";
const DEGRADED_READY_SUMMARY = "El servicio responde con problemas. Estamos revisándolo.";
const DEGRADED_DOWN_SUMMARY = "El servicio no responde a los chequeos de salud.";

function isValidUtc(value) {
  try {
    const canonical = new Date(value).toISOString();
    return canonical === value || canonical.replace(".000Z", "Z") === value;
  } catch {
    return false;
  }
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

// Reflejo mínimo del esquema de server/src/public-status.ts: sirve para
// no publicar (ni tomar como base) un documento que la página no podría leer.
export function isValidStatus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!hasOnlyKeys(value, ["state", "summary", "updatedAt", "components", "notices"])) return false;
  if (!STATES.includes(value.state)) return false;
  if (typeof value.summary !== "string" || value.summary.length < 1 || value.summary.length > 240) return false;
  if (typeof value.updatedAt !== "string" || !UTC_PATTERN.test(value.updatedAt) || !isValidUtc(value.updatedAt)) return false;
  if (!Array.isArray(value.components) || value.components.length !== 3) return false;
  const ids = new Set();
  for (const component of value.components) {
    if (!component || typeof component !== "object" || Array.isArray(component)) return false;
    if (!hasOnlyKeys(component, ["id", "state", "summary"])) return false;
    if (!COMPONENT_IDS.includes(component.id) || ids.has(component.id)) return false;
    ids.add(component.id);
    if (!STATES.includes(component.state)) return false;
    if (typeof component.summary !== "string" || component.summary.length < 1 || component.summary.length > 120) return false;
  }
  if (!Array.isArray(value.notices) || value.notices.length > 8) return false;
  for (const notice of value.notices) {
    if (!notice || typeof notice !== "object" || Array.isArray(notice)) return false;
    if (!hasOnlyKeys(notice, ["kind", "title", "message", "updatedAt"])) return false;
    if (!NOTICE_KINDS.includes(notice.kind)) return false;
    if (typeof notice.title !== "string" || notice.title.length < 1 || notice.title.length > 100) return false;
    if (typeof notice.message !== "string" || notice.message.length < 1 || notice.message.length > 600) return false;
    if (typeof notice.updatedAt !== "string" || !UTC_PATTERN.test(notice.updatedAt) || !isValidUtc(notice.updatedAt)) return false;
  }
  return true;
}

async function probeEndpoint(url, timeoutMs) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return body?.status === "ok";
  } catch {
    return false;
  }
}

// /health/live y /health/ready no tienen límite de peticiones: un chequeo
// cada 5 minutos son 24 peticiones por hora, despreciable.
export async function probeHealth(baseUrl, timeoutMs) {
  const live = await probeEndpoint(`${baseUrl}/health/live`, timeoutMs);
  const ready = await probeEndpoint(`${baseUrl}/health/ready`, timeoutMs);
  if (ready) return { kind: "operational" };
  if (live) return { kind: "degraded", reason: "ready" };
  return { kind: "down" };
}

function sameVisibleState(current, next) {
  if (current.state !== next.state || current.summary !== next.summary) return false;
  return next.components.every((component) => {
    const other = current.components.find((item) => item.id === component.id);
    return other && other.state === component.state && other.summary === component.summary;
  });
}

// current puede ser null (fichero ausente o no válido): en ese caso se
// construye un documento nuevo desde cero, con el correo en "unknown".
export function buildNextStatus(current, probe) {
  if (current && current.state === "maintenance") {
    return { status: current, changed: false, reason: "maintenance" };
  }
  const email = current?.components?.find((component) => component.id === "email") ?? {
    id: "email",
    state: "unknown",
    summary: "Estado sin confirmar.",
  };
  const notices = current?.notices ?? [];
  let next;
  if (probe.kind === "operational") {
    next = {
      state: "operational",
      summary: OPERATIONAL_SUMMARY,
      updatedAt: new Date().toISOString(),
      components: [
        { id: "api", state: "operational", summary: "API en funcionamiento." },
        { id: "sync", state: "operational", summary: "Sincronización de preferencias activa." },
        email,
      ],
      notices,
    };
  } else if (probe.kind === "degraded") {
    next = {
      state: "degraded",
      summary: DEGRADED_READY_SUMMARY,
      updatedAt: new Date().toISOString(),
      components: [
        { id: "api", state: "degraded", summary: "La API responde con problemas." },
        { id: "sync", state: "degraded", summary: "La sincronización puede fallar." },
        email,
      ],
      notices,
    };
  } else {
    next = {
      state: "degraded",
      summary: DEGRADED_DOWN_SUMMARY,
      updatedAt: new Date().toISOString(),
      components: [
        { id: "api", state: "degraded", summary: "La API no responde." },
        { id: "sync", state: "degraded", summary: "La sincronización no está disponible." },
        email,
      ],
      notices,
    };
  }
  if (current && sameVisibleState(current, next)) {
    return { status: current, changed: false, reason: "sin cambios" };
  }
  return { status: next, changed: true, reason: probe.kind };
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    statusFile: DEFAULT_STATUS_FILE,
    dryRun: false,
    timeoutMs: 5000,
    confirmDelaySeconds: 20,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--base-url") {
      options.baseUrl = argv[++index];
    } else if (arg === "--status-file") {
      options.statusFile = argv[++index];
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++index]);
    } else if (arg === "--confirm-delay-seconds") {
      options.confirmDelaySeconds = Number(argv[++index]);
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }
  if (!options.baseUrl || !options.statusFile
    || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0
    || !Number.isFinite(options.confirmDelaySeconds) || options.confirmDelaySeconds < 0) {
    throw new Error("Argumentos no válidos.");
  }
  options.baseUrl = options.baseUrl.replace(/\/$/, "");
  return options;
}

async function readCurrentStatus(statusFile) {
  try {
    const content = await readFile(statusFile, "utf8");
    const parsed = JSON.parse(content);
    return isValidStatus(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function publishStatus(status, statusFile) {
  const content = `${JSON.stringify(status, null, 2)}\n`;
  await mkdir(dirname(statusFile), { recursive: true });
  const temporaryPath = join(dirname(statusFile), `.status-${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o644);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, statusFile);
}

function log(message) {
  console.log(`[${new Date().toISOString()}] watch-status: ${message}`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let probe = await probeHealth(options.baseUrl, options.timeoutMs);
  if (probe.kind !== "operational" && options.confirmDelaySeconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, options.confirmDelaySeconds * 1000));
    probe = await probeHealth(options.baseUrl, options.timeoutMs);
  }
  const current = await readCurrentStatus(options.statusFile);
  const { status, changed, reason } = buildNextStatus(current, probe);
  if (!changed) {
    log(`sin cambios (${reason}). Estado actual: ${status.state}.`);
    return 0;
  }
  if (options.dryRun) {
    console.log(JSON.stringify(status, null, 2));
    log(`simulación: publicaría ${status.state} (${reason}).`);
    return 0;
  }
  if (!isValidStatus(status)) throw new Error("El documento generado no es válido.");
  await publishStatus(status, options.statusFile);
  log(`publicado ${status.state} (${reason}).`);
  return 0;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`[watch-status] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
