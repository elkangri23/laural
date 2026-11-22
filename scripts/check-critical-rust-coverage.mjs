import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const MINIMUM_LINE_COVERAGE = 85;

export const CRITICAL_RUST_FILES = [
  "agent_files.rs",
  "configuration_transfer.rs",
  "git_panel.rs",
];

export function checkCriticalCoverage(report) {
  const files = report?.data?.flatMap((unit) => unit.files ?? []) ?? [];
  const failures = [];

  for (const name of CRITICAL_RUST_FILES) {
    const matches = files.filter((file) => file.filename?.replaceAll("\\", "/").endsWith(`/${name}`));
    if (matches.length !== 1) {
      failures.push(`${name}: se esperaba un archivo en el informe y se encontraron ${matches.length}`);
      continue;
    }

    const percent = matches[0].summary?.lines?.percent;
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      failures.push(`${name}: el informe no contiene una cobertura de líneas válida`);
    } else if (percent < MINIMUM_LINE_COVERAGE) {
      failures.push(`${name}: ${percent.toFixed(2)} % es inferior al mínimo de ${MINIMUM_LINE_COVERAGE} %`);
    }
  }

  return failures;
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    throw new Error("Indica la ruta al informe JSON de cargo llvm-cov.");
  }

  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const failures = checkCriticalCoverage(report);
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  console.log(`Cobertura de líneas ≥ ${MINIMUM_LINE_COVERAGE} % en: ${CRITICAL_RUST_FILES.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
