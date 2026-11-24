import { describe, expect, it } from "vitest";
import { checkCriticalCoverage } from "../scripts/check-critical-coverage.mjs";

function file(path: string, statementHits = [1, 1], branchHits = [1, 1]) {
  return {
    path,
    statementMap: Object.fromEntries(statementHits.map((_, index) => [index, { start: { line: index + 1 } }])),
    s: Object.fromEntries(statementHits.map((hits, index) => [index, hits])),
    b: { 0: branchHits },
    branchMap: { 0: { type: "if" } },
  };
}

describe("gate de cobertura crítica del servicio", () => {
  it("acepta informes con todas las líneas y ramas cubiertas", () => {
    expect(checkCriticalCoverage({ a: file("C:\\repo\\server\\src\\auth.ts") }, ["src/auth.ts"])).toEqual([]);
  });

  it("rechaza líneas y ramas descubiertas", () => {
    const failures = checkCriticalCoverage({ a: file("/repo/server/src/auth.ts", [1, 0], [1, 0]) }, ["src/auth.ts"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("1/2 líneas y 1/2 ramas");
    expect(failures[0]).toContain("2");
  });

  it("rechaza archivos ausentes o duplicados en el informe", () => {
    expect(checkCriticalCoverage({}, ["src/auth.ts"])[0]).toContain("se encontraron 0");
    expect(checkCriticalCoverage({ a: file("/a/src/auth.ts"), b: file("/b/src/auth.ts") }, ["src/auth.ts"])[0]).toContain("se encontraron 2");
  });

  it("rechaza conteos o ubicaciones de líneas inválidos", () => {
    const invalidCount = file("/repo/src/auth.ts");
    invalidCount.s["0"] = Number.NaN;
    expect(checkCriticalCoverage({ a: invalidCount }, ["src/auth.ts"])[0]).toContain("líneas ejecutables válidas");

    const invalidLocation = file("/repo/src/auth.ts");
    invalidLocation.statementMap["0"].start.line = 0;
    expect(checkCriticalCoverage({ a: invalidLocation }, ["src/auth.ts"])[0]).toContain("ubicación de línea inválida");

    const invalidBranch = file("/repo/src/auth.ts");
    invalidBranch.b["0"][0] = Number.NaN;
    expect(checkCriticalCoverage({ a: invalidBranch }, ["src/auth.ts"])[0]).toContain("líneas ejecutables válidas");
  });
});
