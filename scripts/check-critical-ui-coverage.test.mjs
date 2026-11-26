import assert from "node:assert/strict";
import test from "node:test";
import {
  CRITICAL_UI_FILES,
  STANDARD_UI_FILES,
  TRIVIAL_UI_FILES,
  checkUiCoverage,
} from "./check-critical-ui-coverage.mjs";

function lcovRecord(path, lines, branches) {
  return [
    `SF:C:/workspace/${path}`,
    `LF:${lines.total}`,
    `LH:${lines.covered}`,
    `BRF:${branches.total}`,
    `BRH:${branches.covered}`,
    "end_of_record",
  ].join("\n");
}

function completeReport(overrides = {}) {
  const files = [...CRITICAL_UI_FILES, ...STANDARD_UI_FILES, ...TRIVIAL_UI_FILES];
  return files.map((path) => {
    const defaults = CRITICAL_UI_FILES.includes(path)
      ? { lines: { covered: 10, total: 10 }, branches: { covered: 8, total: 8 } }
      : { lines: { covered: 8, total: 10 }, branches: { covered: 1, total: 10 } };
    const value = { ...defaults, ...overrides[path] };
    return lcovRecord(path, value.lines, value.branches);
  }).join("\n");
}

test("acepta archivos críticos al 100/100 y estándar desde el 80 % de líneas", () => {
  assert.deepEqual(checkUiCoverage(completeReport()), []);
});

test("excluye los archivos triviales del denominador aunque tengan cobertura cero", () => {
  const report = completeReport({
    [TRIVIAL_UI_FILES[0]]: {
      lines: { covered: 0, total: 10 },
      branches: { covered: 0, total: 10 },
    },
  });
  assert.deepEqual(checkUiCoverage(report), []);
});

test("rechaza cualquier línea o rama descubierta en un archivo crítico", () => {
  const report = completeReport({
    [CRITICAL_UI_FILES[0]]: {
      lines: { covered: 9, total: 10 },
      branches: { covered: 7, total: 8 },
    },
  });
  assert.deepEqual(checkUiCoverage(report), [
    `${CRITICAL_UI_FILES[0]}: 90.00 % es inferior al mínimo de 100 % de líneas`,
    `${CRITICAL_UI_FILES[0]}: 87.50 % es inferior al mínimo de 100 % de ramas`,
  ]);
});

test("rechaza un archivo estándar por debajo del 80 % de líneas", () => {
  const report = completeReport({
    [STANDARD_UI_FILES[0]]: {
      lines: { covered: 79, total: 100 },
      branches: { covered: 0, total: 1 },
    },
  });
  assert.deepEqual(checkUiCoverage(report), [
    `${STANDARD_UI_FILES[0]}: 79.00 % es inferior al mínimo de 80 % de líneas`,
  ]);
});

test("rechaza contadores críticos inválidos o ausentes", () => {
  const invalid = completeReport({
    [CRITICAL_UI_FILES[0]]: {
      lines: { covered: 11, total: 10 },
      branches: { covered: 9, total: 8 },
    },
  });
  assert.deepEqual(checkUiCoverage(invalid).slice(0, 2), [
    `${CRITICAL_UI_FILES[0]}: el informe no contiene datos válidos de líneas`,
    `${CRITICAL_UI_FILES[0]}: el informe no contiene datos válidos de ramas`,
  ]);

  const missingLines = [
    `SF:C:/workspace/${CRITICAL_UI_FILES[0]}`,
    "LF:10",
    "BRF:8",
    "BRH:8",
    "end_of_record",
  ].join("\n");
  assert.match(checkUiCoverage(missingLines)[0], /datos válidos de líneas/);
});

test("rechaza rutas ausentes o duplicadas e informes incompletos", () => {
  const incomplete = lcovRecord(CRITICAL_UI_FILES[0], { covered: 10, total: 10 }, { covered: 8, total: 8 });
  const duplicate = `${incomplete}\n${incomplete}`;
  const failures = checkUiCoverage(duplicate);
  assert.equal(failures[0], `${CRITICAL_UI_FILES[0]}: se esperaba un archivo en el informe y se encontraron 2`);
  assert.equal(failures[1], `${CRITICAL_UI_FILES[1]}: se esperaba un archivo en el informe y se encontraron 0`);
});
