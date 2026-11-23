import { describe, expect, it, vi } from "vitest";
import { runAdminRecoveryCli } from "../src/admin-account-recovery.js";

const base = { platform: "linux" as NodeJS.Platform, uid: 0, sudoUser: "laura.admin" };

function database(rows: unknown[] = [], rowCount: number | null = 0) {
  const query = vi.fn(async () => ({ rows, rowCount }));
  const client = { query, release: vi.fn() };
  return {
    query,
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
  };
}

describe("CLI local de revisión administrativa", () => {
  it("rechaza plataformas, sesiones o usuarios que no son sudo root", async () => {
    const stderr: string[] = [];
    const code = await runAdminRecoveryCli({ ...base, platform: "win32", uid: 1000, args: ["list"], stderr: (text) => stderr.push(text) });
    expect(code).toBe(1);
    expect(stderr[0]).toContain("mediante sudo");
  });

  it("rechaza argumentos desconocidos e imprime el uso", async () => {
    const stderr: string[] = [];
    const code = await runAdminRecoveryCli({ ...base, args: ["drop"], stderr: (text) => stderr.push(text) });
    expect(code).toBe(2);
    expect(stderr[0]).toContain("admin:recovery -- list");
  });

  it("lista casos y neutraliza controles que pudieran inyectar secuencias de terminal", async () => {
    const pool = database([{
      id: "c35c91ca-5a81-4008-8811-91971f7c17ad", account_email: "laura\u001b[31m\u202e@example.test",
      created_at: new Date("2026-11-23T12:00:00Z"), mailbox_verified_at: new Date("2026-11-23T12:01:00Z"),
    }]);
    const stdout: string[] = [];
    const code = await runAdminRecoveryCli({ ...base, args: ["list"], createPool: () => pool as never, stdout: (text) => stdout.push(text) });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("laura?[31m?@example.test");
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("informa cuando no hay casos y falla de forma genérica si PostgreSQL no responde", async () => {
    const emptyPool = database();
    const stdout: string[] = [];
    expect(await runAdminRecoveryCli({ ...base, args: ["list"], createPool: () => emptyPool as never, stdout: (text) => stdout.push(text) })).toBe(0);
    expect(stdout[0]).toContain("No hay solicitudes");
    const failedPool = { query: vi.fn(async () => { throw new Error("no imprimir conexión ni credenciales"); }), end: vi.fn(async () => undefined) };
    const stderr: string[] = [];
    expect(await runAdminRecoveryCli({ ...base, args: ["list"], createPool: () => failedPool as never, stderr: (text) => stderr.push(text) })).toBe(1);
    expect(stderr[0]).toContain("No se pudieron consultar");
    expect(stderr.join("\n")).not.toContain("credenciales");
  });

  it("rechaza aprobación sin prueba independiente antes de abrir PostgreSQL", async () => {
    const createPool = vi.fn();
    const stderr: string[] = [];
    const caseId = "c35c91ca-5a81-4008-8811-91971f7c17ad";
    const code = await runAdminRecoveryCli({ ...base, args: ["decide", caseId, "approved", "insufficient", caseId], createPool, stderr: (text) => stderr.push(text) });
    expect(code).toBe(2);
    expect(createPool).not.toHaveBeenCalled();
    expect(stderr[0]).toContain("evidencia independiente");
  });

  it("exige repetir el UUID y registra decisiones sin tocar la cuenta", async () => {
    const caseId = "c35c91ca-5a81-4008-8811-91971f7c17ad";
    const pool = database([], 1);
    const stdout: string[] = [];
    const result = await runAdminRecoveryCli({
      ...base, args: ["decide", caseId, "approved", "google_identity", caseId],
      recoveryPepper: "a-recovery-pepper-with-at-least-32-bytes",
      createPool: () => pool as never, stdout: (text) => stdout.push(text),
    });
    expect(result).toBe(0);
    expect(pool.connect).toHaveBeenCalledOnce();
    expect(stdout.join("\n")).toContain("enlace de un solo uso");
    expect(pool.end).toHaveBeenCalledOnce();

    const stderr: string[] = [];
    expect(await runAdminRecoveryCli({
      ...base, args: ["decide", caseId, "denied", "insufficient", "different-id"], stderr: (text) => stderr.push(text),
    })).toBe(2);
    expect(stderr[0]).toContain("confirmación");
  });

  it("no registra dos veces un caso ni revela detalles de error PostgreSQL", async () => {
    const caseId = "c35c91ca-5a81-4008-8811-91971f7c17ad";
    const pool = database([], 0);
    const stderr: string[] = [];
    expect(await runAdminRecoveryCli({ ...base, args: ["decide", caseId, "denied", "insufficient", caseId], createPool: () => pool as never, stderr: (text) => stderr.push(text) })).toBe(1);
    expect(stderr[0]).toContain("ya revisado");
    const failedPool = { query: vi.fn(async () => { throw new Error("secreto SQL"); }), end: vi.fn(async () => undefined) };
    stderr.length = 0;
    expect(await runAdminRecoveryCli({ ...base, args: ["decide", caseId, "denied", "insufficient", caseId], createPool: () => failedPool as never, stderr: (text) => stderr.push(text) })).toBe(1);
    expect(stderr[0]).toContain("No se han aplicado cambios");
    expect(stderr.join()).not.toContain("secreto SQL");
  });
});
