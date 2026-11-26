import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const MINIMUM_LINE_COVERAGE = 85;
export const MINIMUM_BRANCH_COVERAGE = 65;

const COVERAGE_THRESHOLDS = {
  lines: { label: "líneas", minimum: MINIMUM_LINE_COVERAGE },
  branches: { label: "ramas", minimum: MINIMUM_BRANCH_COVERAGE },
};

export const CRITICAL_RUST_BRANCH_FILES = [
  "agent_files.rs",
  "chat_stream.rs",
  "configuration_transfer.rs",
  "git_panel.rs",
  "preferences/snapshot.rs",
  "terminal_flow.rs",
  "terminal_prediction.rs",
];
export const CRITICAL_RUST_LINE_FILES = [...CRITICAL_RUST_BRANCH_FILES, "terminal_output.rs"];
const EXACT_COVERAGE_FILES = new Set(["terminal_flow.rs", "terminal_prediction.rs"]);

const FILES_BY_METRIC = {
  lines: CRITICAL_RUST_LINE_FILES,
  branches: CRITICAL_RUST_BRANCH_FILES,
};

export function checkCriticalCoverage(report, metric = "lines") {
  const threshold = COVERAGE_THRESHOLDS[metric];
  if (!threshold) {
    return [`Métrica de cobertura no admitida: ${metric}`];
  }

  const files = report?.data?.flatMap((unit) => unit.files ?? []) ?? [];
  const failures = [];

  for (const name of FILES_BY_METRIC[metric]) {
    const matches = files.filter((file) => file.filename?.replaceAll("\\", "/").endsWith(`/${name}`));
    if (matches.length !== 1) {
      failures.push(`${name}: se esperaba un archivo en el informe y se encontraron ${matches.length}`);
      continue;
    }

    const percent = matches[0].summary?.[metric]?.percent;
    const minimum = EXACT_COVERAGE_FILES.has(name) ? 100 : threshold.minimum;
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      failures.push(`${name}: el informe no contiene una cobertura de ${threshold.label} válida`);
    } else if (percent < minimum) {
      failures.push(`${name}: ${percent.toFixed(2)} % es inferior al mínimo de ${minimum} % de ${threshold.label}`);
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
  const option = process.argv[3];
  const metric = option === undefined ? "lines" : option === "--branches" ? "branches" : null;
  const threshold = COVERAGE_THRESHOLDS[metric];
  if (!threshold) {
    throw new Error("Usa --branches para medir ramas o deja la opción vacía para líneas.");
  }

  const failures = checkCriticalCoverage(report, metric);
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  console.log(`Cobertura de ${threshold.label} ≥ ${threshold.minimum} % en: ${FILES_BY_METRIC[metric].join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
