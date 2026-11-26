import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { deliverSecurityEmailBatch, type SecurityEmailEvent } from "../src/security-email-outbox.js";

type Notice = { id: string; recipient_email: string; event_type: SecurityEmailEvent; attempts: number };

function createPool(
  notices: Notice[],
  options: { claimMissing?: boolean; selectError?: Error; deliveryUpdateError?: Error } = {},
) {
  let nextNotice = 0;
  const clients: Array<{ query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }> = [];
  const pool = {
    connect: vi.fn(async () => {
      const notice = notices[nextNotice++];
      const client = {
        query: vi.fn(async (statement: string) => {
          if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") return { rows: [] };
          if (statement.startsWith("SELECT id, recipient_email")) {
            if (options.selectError) throw options.selectError;
            return { rows: notice ? [notice] : [] };
          }
          if (statement.startsWith("UPDATE account_security_email_outbox")) {
            if (options.claimMissing) return { rows: [] };
            return { rows: notice ? [{ ...notice, attempts: notice.attempts + 1 }] : [] };
          }
          throw new Error(`Consulta inesperada: ${statement}`);
        }),
        release: vi.fn(),
      };
      clients.push(client);
      return client;
    }),
    query: vi.fn(async (statement: string) => {
      if (statement.includes("SET delivered_at = now()") && options.deliveryUpdateError) {
        throw options.deliveryUpdateError;
      }
      return { rows: [], rowCount: 1 };
    }),
  } as unknown as Pick<Pool, "connect" | "query">;
  return { pool, clients };
}

const notice = (id: string, attempts = 0): Notice => ({
  id,
  recipient_email: `${id}@example.test`,
  event_type: "totp_enabled",
  attempts,
});

describe("outbox crítico de avisos de seguridad", () => {
  it("confirma y entrega avisos reclamados hasta encontrar la cola vacía", async () => {
    const { pool, clients } = createPool([notice("uno")]);
    const sender = { sendSecurityNotice: vi.fn(async () => undefined) };

    await expect(deliverSecurityEmailBatch(pool, sender)).resolves.toEqual({ delivered: 1, deferred: 0 });
    expect(sender.sendSecurityNotice).toHaveBeenCalledWith({
      email: "uno@example.test",
      eventType: "totp_enabled",
      notificationId: "uno",
    });
    expect(clients[0]?.query.mock.calls.map(([statement]) => statement)).toEqual([
      "BEGIN",
      expect.stringContaining("FOR UPDATE SKIP LOCKED LIMIT 1"),
      expect.stringContaining("SET claimed_at = now(), attempts = attempts + 1"),
      "COMMIT",
    ]);
    expect(clients[0]?.release).toHaveBeenCalledOnce();
  });

  it("no envía ni escribe cuando no hay avisos pendientes", async () => {
    const { pool, clients } = createPool([]);
    const sender = { sendSecurityNotice: vi.fn(async () => undefined) };

    await expect(deliverSecurityEmailBatch(pool, sender)).resolves.toEqual({ delivered: 0, deferred: 0 });
    expect(sender.sendSecurityNotice).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
    expect(clients[0]?.query.mock.calls.map(([statement]) => statement)).toEqual([
      "BEGIN",
      expect.stringContaining("FOR UPDATE SKIP LOCKED LIMIT 1"),
      "COMMIT",
    ]);
  });

  it("deja disponible para reintento el aviso que falla y respeta el backoff máximo", async () => {
    const { pool, clients } = createPool([notice("reintento", 12)]);
    const sender = { sendSecurityNotice: vi.fn(async () => { throw new Error("Resend no disponible"); }) };

    await expect(deliverSecurityEmailBatch(pool, sender)).resolves.toEqual({ delivered: 0, deferred: 1 });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("available_at = now()"), ["reintento", 21_600, 8]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("abandoned_at = CASE WHEN attempts >= $3"), ["reintento", 21_600, 8]);
    expect(clients[0]?.release).toHaveBeenCalledOnce();
  });

  it("aplaza un aviso si falla registrar su entrega", async () => {
    const { pool } = createPool([notice("registro")], { deliveryUpdateError: new Error("fallo al confirmar entrega") });
    const sender = { sendSecurityNotice: vi.fn(async () => undefined) };

    await expect(deliverSecurityEmailBatch(pool, sender)).resolves.toEqual({ delivered: 0, deferred: 1 });
    expect(sender.sendSecurityNotice).toHaveBeenCalledOnce();
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("no cuenta un aviso que deja de estar disponible al reclamarlo", async () => {
    const { pool, clients } = createPool([notice("en-carrera")], { claimMissing: true });
    const sender = { sendSecurityNotice: vi.fn(async () => undefined) };

    await expect(deliverSecurityEmailBatch(pool, sender)).resolves.toEqual({ delivered: 0, deferred: 0 });
    expect(sender.sendSecurityNotice).not.toHaveBeenCalled();
    expect(clients[0]?.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("revierte y libera el cliente cuando falla la reclamación", async () => {
    const databaseError = new Error("fallo en SELECT");
    const { pool, clients } = createPool([], { selectError: databaseError });
    const sender = { sendSecurityNotice: vi.fn(async () => undefined) };

    await expect(deliverSecurityEmailBatch(pool, sender)).rejects.toBe(databaseError);
    expect(clients[0]?.query.mock.calls.map(([statement]) => statement)).toEqual([
      "BEGIN",
      expect.stringContaining("FOR UPDATE SKIP LOCKED LIMIT 1"),
      "ROLLBACK",
    ]);
    expect(clients[0]?.release).toHaveBeenCalledOnce();
  });

  it("limita cada ejecución a 50 avisos aunque se solicite un lote mayor", async () => {
    const notices = Array.from({ length: 51 }, (_, index) => notice(`aviso-${index}`));
    const { pool } = createPool(notices);
    const sender = { sendSecurityNotice: vi.fn(async () => undefined) };

    await expect(deliverSecurityEmailBatch(pool, sender, 100)).resolves.toEqual({ delivered: 50, deferred: 0 });
    expect(sender.sendSecurityNotice).toHaveBeenCalledTimes(50);
    expect(pool.connect).toHaveBeenCalledTimes(50);
  });
});
