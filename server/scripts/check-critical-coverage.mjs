import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const CRITICAL_SERVER_FILES = ["src/config.ts", "src/auth.ts", "src/email-auth.ts"];

export function checkCriticalCoverage(report, files = CRITICAL_SERVER_FILES) {
  const entries = Object.values(report ?? {}).filter((entry) => typeof entry?.path === "string");
  const failures = [];

  for (const name of files) {
    const normalizedName = name.replaceAll("\\", "/");
    const matches = entries.filter((entry) => entry.path.replaceAll("\\", "/").endsWith(`/${normalizedName}`));
    if (matches.length !== 1) {
      failures.push(`${name}: se esperaba un archivo en el informe y se encontraron ${matches.length}`);
      continue;
    }

    const file = matches[0];
    const statements = Object.entries(file.statementMap ?? {});
    const branchEntries = Object.entries(file.b ?? {});
    const branchMap = file.branchMap ?? {};
    const hasInvalidBranches = branchEntries.some(([id, counts]) => !Array.isArray(counts)
      || branchMap[id] === null || typeof branchMap[id] !== "object"
      || counts.some((hits) => !Number.isFinite(hits) || hits < 0));
    if (statements.length === 0 || statements.some(([id]) => !Number.isFinite(file.s?.[id]) || file.s[id] < 0)
      || hasInvalidBranches || branchEntries.length !== Object.keys(branchMap).length) {
      failures.push(`${name}: el informe no contiene líneas ejecutables válidas`);
      continue;
    }

    const lines = new Map();
    for (const [id, location] of statements) {
      const line = location?.start?.line;
      if (!Number.isInteger(line) || line < 1) {
        failures.push(`${name}: el informe contiene una ubicación de línea inválida`);
        break;
      }
      lines.set(line, (lines.get(line) ?? 0) + file.s[id]);
    }
    if (lines.size === 0) continue;

    const branches = branchEntries.flatMap(([, counts]) => counts);
    const uncoveredLines = [...lines].filter(([, hits]) => hits === 0).map(([line]) => line);
    const uncoveredBranches = branches.filter((hits) => hits === 0).length;
    if (uncoveredLines.length > 0 || uncoveredBranches > 0) {
      failures.push(`${name}: ${lines.size - uncoveredLines.length}/${lines.size} líneas y ${branches.length - uncoveredBranches}/${branches.length} ramas; líneas sin cubrir: ${uncoveredLines.join(", ") || "ninguna"}; ramas sin cubrir: ${uncoveredBranches}`);
    }
  }

  return failures;
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error("Indica la ruta al informe coverage-final.json de Vitest.");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const failures = checkCriticalCoverage(report);
  if (failures.length > 0) throw new Error(failures.join("\n"));
  console.log(`Cobertura Crítica del 100 % en líneas y ramas: ${CRITICAL_SERVER_FILES.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
