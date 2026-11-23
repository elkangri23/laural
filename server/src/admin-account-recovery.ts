import pg from "pg";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readConfig, readEmailAuthConfig } from "./config.js";
import { isOperator, listPendingRecoveryCases, recordRecoveryDecision, type RecoveryDecision, type RecoveryEvidence } from "./account-recovery-admin.js";

type AdminPool = Pick<pg.Pool, "query" | "connect" | "end">;
type CliDependencies = {
  args: string[];
  platform: NodeJS.Platform;
  uid: number | undefined;
  sudoUser: string | undefined;
  recoveryPepper?: string;
  createPool?: () => AdminPool;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

export async function runAdminRecoveryCli(input: CliDependencies): Promise<number> {
  const out = input.stdout ?? console.log;
  const error = input.stderr ?? console.error;
  if (input.platform !== "linux" || input.uid !== 0 || !isOperator(input.sudoUser)) {
    error("Ejecuta esta herramienta en el VPS Linux mediante sudo desde una cuenta administrativa.");
    return 1;
  }
  const [action, caseId, decision, evidence, confirmation] = input.args;
  if (action === "list" && input.args.length === 1) return await listCases(input, out, error);
  if (action === "decide" && input.args.length === 5 && confirmation === caseId) {
    return await decideCase(input, caseId ?? "", decision ?? "", evidence ?? "", out, error);
  }
  error("Uso:\n  sudo npm run admin:recovery -- list\n  sudo npm run admin:recovery -- decide <id-caso> <approved|denied> <categoría-prueba> <id-caso-confirmación>");
  return 2;
}

async function listCases(input: CliDependencies, out: (message: string) => void, error: (message: string) => void): Promise<number> {
  try {
    const cases = await withDatabase(input, listPendingRecoveryCases);
    if (cases.length === 0) { out("No hay solicitudes verificadas pendientes de revisión."); return 0; }
    out("ID del caso | Correo | Solicitud UTC | Buzón verificado UTC");
    for (const item of cases) {
      out(`${item.id} | ${safeTerminalText(item.account_email)} | ${item.created_at.toISOString()} | ${item.mailbox_verified_at.toISOString()}`);
    }
    return 0;
  } catch {
    error("No se pudieron consultar los casos. Comprueba acceso local a PostgreSQL y migraciones.");
    return 1;
  }
}

async function decideCase(
  input: CliDependencies,
  caseId: string,
  decisionInput: string,
  evidenceInput: string,
  out: (message: string) => void,
  error: (message: string) => void,
): Promise<number> {
  const decision = decisionInput as RecoveryDecision;
  const evidence = evidenceInput as RecoveryEvidence;
  const operator = input.sudoUser;
  if (!isOperator(operator)) return 1;
  if (decision === "approved" && evidence === "insufficient") {
    error("No se puede aprobar un caso sin evidencia independiente suficiente.");
    return 2;
  }
  try {
    if (decision === "approved" && (!input.recoveryPepper || Buffer.byteLength(input.recoveryPepper, "utf8") < 32)) {
      error("No se puede aprobar sin AUTH_RECOVERY_PEPPER configurado para proteger el enlace.");
      return 1;
    }
    const updated = await withDatabase(input, (pool) => recordRecoveryDecision(pool, {
      caseId, decision, evidence, operator, recoveryPepper: input.recoveryPepper ?? "",
    }));
    if (!updated) {
      error("Caso inexistente, no verificado, ya revisado o datos de decisión no válidos.");
      return 1;
    }
    out(`Decisión ${decision === "approved" ? "aprobada" : "denegada"} registrada para ${caseId}.`);
    out(decision === "approved"
      ? "Se ha emitido un enlace de un solo uso. Los factores solo cambiarán cuando se confirme el TOTP nuevo; no se crea ninguna sesión."
      : "La denegación no modifica factores, sesiones ni preferencias.");
    return 0;
  } catch {
    error("No se pudo registrar la decisión. No se han aplicado cambios a la cuenta.");
    return 1;
  }
}

async function withDatabase<T>(input: CliDependencies, operation: (pool: AdminPool) => Promise<T>): Promise<T> {
  const pool = input.createPool?.() ?? createPool();
  try { return await operation(pool); }
  finally { await pool.end(); }
}

function createPool(): pg.Pool {
  const config = readConfig(process.env);
  return new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 1_000 });
}

function safeTerminalText(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, "?").slice(0, 320);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const emailAuthConfig = readEmailAuthConfig(process.env);
  process.exitCode = await runAdminRecoveryCli({
    args: process.argv.slice(2), platform: process.platform, uid: process.getuid?.(), sudoUser: process.env.SUDO_USER,
    ...(emailAuthConfig ? { recoveryPepper: emailAuthConfig.recoveryPepper } : {}),
  });
}
