export const CRITICAL_SERVER_FILES = ["src/config.ts", "src/auth.ts", "src/email-auth.ts", "src/account-deletion.ts", "src/account-mfa.ts", "src/account-passkeys.ts", "src/account-recovery.ts", "src/google-oauth.ts", "src/app.ts", "src/native-auth.ts", "src/recovery-ticket-crypto.ts", "src/retention.ts", "src/security-email-outbox.ts", "src/resend-mailer.ts", "src/migration-runner.ts", "src/snapshot-validation.ts", "src/auth-pages.ts", "scripts/critical-coverage.mjs"];

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
