import assert from "node:assert/strict";
import test from "node:test";
import { CRITICAL_RUST_FILES, MINIMUM_LINE_COVERAGE, checkCriticalCoverage } from "./check-critical-rust-coverage.mjs";

function reportWithCoverage(coverageByName) {
  return {
    data: [
      {
        files: Object.entries(coverageByName).map(([name, percent]) => ({
          filename: `C:/workspace/src-tauri/src/${name}`,
          summary: { lines: { percent } },
        })),
      },
    ],
  };
}

test("acepta cada módulo crítico en el umbral", () => {
  const report = reportWithCoverage(Object.fromEntries(CRITICAL_RUST_FILES.map((name) => [name, MINIMUM_LINE_COVERAGE])));

  assert.deepEqual(checkCriticalCoverage(report), []);
});

test("falla si falta un módulo crítico", () => {
  const report = reportWithCoverage({
    "agent_files.rs": 91.55,
    "configuration_transfer.rs": 94.1,
  });

  assert.deepEqual(checkCriticalCoverage(report), [
    "git_panel.rs: se esperaba un archivo en el informe y se encontraron 0",
  ]);
});

test("falla si la cobertura queda por debajo del mínimo", () => {
  const report = reportWithCoverage({
    "agent_files.rs": 91.55,
    "configuration_transfer.rs": 84.99,
    "git_panel.rs": 87.94,
  });

  assert.deepEqual(checkCriticalCoverage(report), [
    "configuration_transfer.rs: 84.99 % es inferior al mínimo de 85 %",
  ]);
});

test("falla con porcentajes inválidos o archivos ambiguos", () => {
  const report = reportWithCoverage({
    "agent_files.rs": 91.55,
    "configuration_transfer.rs": Number.NaN,
    "git_panel.rs": 101,
  });
  report.data[0].files.push({
    filename: "D:/copy/src-tauri/src/agent_files.rs",
    summary: { lines: { percent: 100 } },
  });

  assert.deepEqual(checkCriticalCoverage(report), [
    "agent_files.rs: se esperaba un archivo en el informe y se encontraron 2",
    "configuration_transfer.rs: el informe no contiene una cobertura de líneas válida",
    "git_panel.rs: el informe no contiene una cobertura de líneas válida",
  ]);
});
