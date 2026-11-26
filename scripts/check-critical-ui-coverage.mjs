import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const CRITICAL_UI_FILES = [
  "src/accountActionGuards.ts",
  "src/components/AccountSettings.tsx",
  "src/components/AgentSettings.tsx",
  "src/components/AssistantMarkdown.tsx",
  "src/components/BackupRetentionControl.tsx",
  "src/components/CommandBlockItem.tsx",
  "src/components/ConfigurationTransfer.tsx",
  "src/components/TerminalPane.tsx",
  "src/components/UpdateManager.tsx",
  "src/terminalOutput.ts",
  "src/terminalPaneState.ts",
];

export const STANDARD_UI_FILES = [
  "src/App.tsx",
  "src/components/AgentActivity.tsx",
  "src/components/ChatMessageItem.tsx",
  "src/components/CommandPalette.tsx",
  "src/components/GitPanel.tsx",
  "src/components/HelpDialog.tsx",
  "src/components/ModalShell.tsx",
  "src/components/NotificationCenter.tsx",
  "src/components/SettingsDialog.tsx",
  "src/components/TaskRecipes.tsx",
  "src/i18n.tsx",
  "src/streamingText.ts",
  "src/chatHistory.ts",
  "src/chatPersistence.ts",
];

export const TRIVIAL_UI_FILES = [
  "src/locales/en.ts",
  "src/locales/es.ts",
  "src/locales/types.ts",
  "src/main.tsx",
  "src/sync/contracts.ts",
  "src/themes.ts",
  "src/components/SparkIcon.tsx",
  "src/vite-env.d.ts",
];

function parseRecords(lcov) {
  return lcov.split("end_of_record").flatMap((record) => {
    const filename = record.match(/^SF:(.+)$/m)?.[1];
    if (!filename) return [];

    const count = (key) => {
      const value = record.match(new RegExp(`^${key}:(\\d+)$`, "m"))?.[1];
      return value === undefined ? null : Number(value);
    };

    return [{
      filename: filename.replaceAll("\\", "/"),
      lines: { covered: count("LH"), total: count("LF") },
      branches: { covered: count("BRH"), total: count("BRF") },
    }];
  });
}

function validateMetric(record, path, metric, minimum, exact) {
  const counts = record[metric];
  if (
    counts.covered === null || counts.total === null ||
    !Number.isSafeInteger(counts.covered) || !Number.isSafeInteger(counts.total) ||
    counts.total <= 0 || counts.covered < 0 || counts.covered > counts.total
  ) {
    return `${path}: el informe no contiene datos válidos de ${metric === "lines" ? "líneas" : "ramas"}`;
  }

  const belowMinimum = exact
    ? counts.covered !== counts.total
    : counts.covered * 100 < counts.total * minimum;
  if (belowMinimum) {
    const percentage = (100 * counts.covered) / counts.total;
    return `${path}: ${percentage.toFixed(2)} % es inferior al mínimo de ${minimum} % de ${metric === "lines" ? "líneas" : "ramas"}`;
  }
  return null;
}

function checkFiles(records, paths, metric, minimum, exact) {
  const failures = [];
  for (const path of paths) {
    const matches = records.filter((record) => record.filename === path || record.filename.endsWith(`/${path}`));
    if (matches.length !== 1) {
      failures.push(`${path}: se esperaba un archivo en el informe y se encontraron ${matches.length}`);
      continue;
    }
    const failure = validateMetric(matches[0], path, metric, minimum, exact);
    if (failure) failures.push(failure);
  }
  return failures;
}

export function checkUiCoverage(lcov) {
  const records = parseRecords(lcov);
  return [
    ...checkFiles(records, CRITICAL_UI_FILES, "lines", 100, true),
    ...checkFiles(records, CRITICAL_UI_FILES, "branches", 100, true),
    ...checkFiles(records, STANDARD_UI_FILES, "lines", 80, false),
  ];
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error("Indica la ruta a coverage/lcov.info generado por Vitest.");
  const failures = checkUiCoverage(await readFile(reportPath, "utf8"));
  if (failures.length > 0) throw new Error(failures.join("\n"));
  console.log(`Cobertura UI: ${CRITICAL_UI_FILES.length} archivos Críticos al 100/100 y ${STANDARD_UI_FILES.length} Estándar con al menos 80 % de líneas; ${TRIVIAL_UI_FILES.length} Triviales excluidos.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
