import { describe, expect, it } from "vitest";
import { checkCriticalCoverage, CRITICAL_SERVER_FILES } from "../scripts/critical-coverage.mjs";

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
    expect(checkCriticalCoverage({}, [])).toEqual([]);
    expect(checkCriticalCoverage(null, [])).toEqual([]);
    expect(checkCriticalCoverage({ ignored: null, a: file("/repo/src/auth.ts") }, ["src/auth.ts"])).toEqual([]);
  });

  it("incluye el validador v1/v2 en la lista Crítica del gate", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/snapshot-validation.ts");
  });

  it("incluye las plantillas de autenticación en el gate Crítico", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/auth-pages.ts");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/auth-pages.ts") }, ["src/auth-pages.ts"])).toEqual([]);
    expect(checkCriticalCoverage({ a: file("/repo/server/src/auth-pages.ts", [1, 0]) }, ["src/auth-pages.ts"])[0]).toContain("1/2 líneas");
  });

  it("incluye el registro de rutas de la API en el gate Crítico", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/app.ts");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/app.ts") }, ["src/app.ts"])).toEqual([]);
    expect(checkCriticalCoverage({ a: file("/repo/server/src/app.ts", [1, 0]) }, ["src/app.ts"])[0]).toContain("1/2 líneas");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/app.ts", [1, 1], [1, 0]) }, ["src/app.ts"])[0]).toContain("1/2 ramas");
  });

  it("incluye la autenticación nativa, MFA y PKCE en el gate Crítico", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/native-auth.ts");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/native-auth.ts") }, ["src/native-auth.ts"])).toEqual([]);
    expect(checkCriticalCoverage({ a: file("/repo/server/src/native-auth.ts", [1, 0]) }, ["src/native-auth.ts"])[0]).toContain("1/2 líneas");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/native-auth.ts", [1, 1], [1, 0]) }, ["src/native-auth.ts"])[0]).toContain("1/2 ramas");
  });

  it("incluye el cifrado de tickets de recuperación en el gate Crítico", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/recovery-ticket-crypto.ts");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/recovery-ticket-crypto.ts") }, ["src/recovery-ticket-crypto.ts"])).toEqual([]);
    expect(checkCriticalCoverage({ a: file("/repo/server/src/recovery-ticket-crypto.ts", [1, 0]) }, ["src/recovery-ticket-crypto.ts"])[0]).toContain("1/2 líneas");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/recovery-ticket-crypto.ts", [1, 1], [1, 0]) }, ["src/recovery-ticket-crypto.ts"])[0]).toContain("1/2 ramas");
  });

  it("incluye la eliminación transaccional de cuentas en el gate Crítico", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/account-deletion.ts");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/account-deletion.ts") }, ["src/account-deletion.ts"])).toEqual([]);
    expect(checkCriticalCoverage({ a: file("/repo/server/src/account-deletion.ts", [1, 1], [1, 0]) }, ["src/account-deletion.ts"])[0]).toContain("1/2 ramas");
  });

  it("incluye la gestión MFA de cuentas en el gate Crítico", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/account-mfa.ts");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/account-mfa.ts") }, ["src/account-mfa.ts"])).toEqual([]);
    expect(checkCriticalCoverage({ a: file("/repo/server/src/account-mfa.ts", [1, 0]) }, ["src/account-mfa.ts"])[0]).toContain("1/2 líneas");
  });

  it("incluye la gestión WebAuthn de passkeys en el gate Crítico", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/account-passkeys.ts");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/account-passkeys.ts") }, ["src/account-passkeys.ts"])).toEqual([]);
    expect(checkCriticalCoverage({ a: file("/repo/server/src/account-passkeys.ts", [1, 0]) }, ["src/account-passkeys.ts"])[0]).toContain("1/2 líneas");
  });

  it("incluye el flujo Google OAuth en el gate Crítico", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/google-oauth.ts");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/google-oauth.ts") }, ["src/google-oauth.ts"])).toEqual([]);
    expect(checkCriticalCoverage({ a: file("/repo/server/src/google-oauth.ts", [1, 0]) }, ["src/google-oauth.ts"])[0]).toContain("1/2 líneas");
  });

  it("incluye la recuperación de factores en el gate Crítico", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/account-recovery.ts");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/account-recovery.ts") }, ["src/account-recovery.ts"])).toEqual([]);
    expect(checkCriticalCoverage({ a: file("/repo/server/src/account-recovery.ts", [1, 0]) }, ["src/account-recovery.ts"])[0]).toContain("1/2 líneas");
  });

  it("incluye la purga de retención en el gate Crítico", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/retention.ts");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/retention.ts") }, ["src/retention.ts"])).toEqual([]);
  });

  it("incluye el outbox de avisos de seguridad en el gate Crítico", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/security-email-outbox.ts");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/security-email-outbox.ts") }, ["src/security-email-outbox.ts"])).toEqual([]);
    expect(checkCriticalCoverage({ a: file("/repo/server/src/security-email-outbox.ts", [1, 0]) }, ["src/security-email-outbox.ts"])[0]).toContain("1/2 líneas");
  });

  it("incluye el transporte de correos de seguridad en el gate Crítico", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/resend-mailer.ts");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/resend-mailer.ts") }, ["src/resend-mailer.ts"])).toEqual([]);
    expect(checkCriticalCoverage({ a: file("/repo/server/src/resend-mailer.ts", [1, 0]) }, ["src/resend-mailer.ts"])[0]).toContain("1/2 líneas");
  });

  it("incluye el ejecutor transaccional de migraciones en el gate Crítico", () => {
    expect(CRITICAL_SERVER_FILES).toContain("src/migration-runner.ts");
    expect(checkCriticalCoverage({ a: file("/repo/server/src/migration-runner.ts") }, ["src/migration-runner.ts"])).toEqual([]);
    expect(checkCriticalCoverage({ a: file("/repo/server/src/migration-runner.ts", [1, 0]) }, ["src/migration-runner.ts"])[0]).toContain("1/2 líneas");
  });

  it("rechaza líneas y ramas descubiertas", () => {
    const failures = checkCriticalCoverage({ a: file("/repo/server/src/auth.ts", [1, 0], [1, 0]) }, ["src/auth.ts"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("1/2 líneas y 1/2 ramas");
    expect(failures[0]).toContain("2");
    expect(checkCriticalCoverage({ a: file("/repo/src/auth.ts", [1, 1], [1, 0]) }, ["src/auth.ts"])[0]).toContain("2/2 líneas y 1/2 ramas");
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

    const incomplete = file("/repo/src/auth.ts");
    delete incomplete.statementMap;
    delete incomplete.b;
    delete incomplete.branchMap;
    expect(checkCriticalCoverage({ a: incomplete }, ["src/auth.ts"])[0]).toContain("líneas ejecutables válidas");
  });
});
