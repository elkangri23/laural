import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { checkCriticalCoverage, CRITICAL_SERVER_FILES } from "./critical-coverage.mjs";

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
