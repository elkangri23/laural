import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresRequestRateLimiter } from "../src/request-rate-limit.js";

describe("limitador persistente de solicitudes", () => {
  it("envía una huella HMAC en vez de la dirección IP y usa una actualización atómica", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: true }] });
    const pepper = "secreto-de-prueba-con-aleatoriedad-suficiente";
    const limiter = new PostgresRequestRateLimiter({ query } as unknown as Pick<Pool, "query">, pepper);
    expect(await limiter.consume("native-login", "203.0.113.8", 10, 60)).toBe(true);

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    const expectedDigest = createHmac("sha256", pepper).update("native-login\0").update("203.0.113.8").digest("hex");
    expect(sql).toContain("ON CONFLICT (scope, key_digest) DO UPDATE");
    expect(sql).toContain("LEAST(request_rate_limits.request_count + 1");
    expect(parameters).toEqual(["native-login", expectedDigest, 60, 10]);
    expect(parameters).not.toContain("203.0.113.8");
  });

  it("devuelve el rechazo persistido y valida las políticas", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: false }] });
    const limiter = new PostgresRequestRateLimiter({ query } as unknown as Pick<Pool, "query">, "x".repeat(32));
    expect(await limiter.consume("preferences-write", "127.0.0.1", 30, 60)).toBe(false);
    await expect(limiter.consume("scope with spaces", "127.0.0.1", 30, 60)).rejects.toThrow("política");
    await expect(limiter.consume("native-login", "127.0.0.1", 0, 60)).rejects.toThrow("política");
    expect(() => new PostgresRequestRateLimiter({ query } as unknown as Pick<Pool, "query">, "corto")).toThrow("32 y 256 bytes");
    expect(() => new PostgresRequestRateLimiter({ query } as unknown as Pick<Pool, "query">, "x".repeat(257))).toThrow("256 bytes");
  });

  it("limpia periódicamente contadores expirados", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: true }] });
    const limiter = new PostgresRequestRateLimiter({ query } as unknown as Pick<Pool, "query">, "x".repeat(32));
    for (let index = 0; index < 512; index += 1) {
      expect(await limiter.consume("preferences-read", "127.0.0.1", 120, 60)).toBe(true);
    }

    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(513));
    expect(String(query.mock.calls[512]?.[0])).toContain("DELETE FROM request_rate_limits");
    expect(String(query.mock.calls[512]?.[0])).toContain("LIMIT $1");
    expect(query.mock.calls[512]?.[1]).toEqual([1_000]);
  });

  it("no solapa limpiezas y reintenta en lotes posteriores", async () => {
    const cleanupResolvers: Array<() => void> = [];
    const query = vi.fn((sql: string) => {
      if (sql.includes("DELETE FROM request_rate_limits")) {
        return new Promise((resolve) => cleanupResolvers.push(() => resolve({ rows: [] })));
      }
      return Promise.resolve({ rows: [{ allowed: true }] });
    });
    const limiter = new PostgresRequestRateLimiter({ query } as unknown as Pick<Pool, "query">, "x".repeat(32));

    for (let index = 0; index < 512; index += 1) await limiter.consume("preferences-read", "127.0.0.1", 120, 60);
    await vi.waitFor(() => expect(cleanupResolvers).toHaveLength(1));
    for (let index = 0; index < 512; index += 1) await limiter.consume("preferences-read", "127.0.0.1", 120, 60);
    expect(cleanupResolvers).toHaveLength(1);

    cleanupResolvers[0]?.();
    for (let index = 0; index < 512; index += 1) await limiter.consume("preferences-read", "127.0.0.1", 120, 60);
    await vi.waitFor(() => expect(cleanupResolvers).toHaveLength(2));
    cleanupResolvers[1]?.();
  });

  it("vuelve a permitir la purga cuando la consulta de limpieza falla", async () => {
    let failCleanup: (() => void) | undefined;
    const query = vi.fn((sql: string) => {
      if (sql.includes("DELETE FROM request_rate_limits")) {
        return new Promise((_resolve, reject) => { failCleanup = () => reject(new Error("database unavailable")); });
      }
      return Promise.resolve({ rows: [{ allowed: true }] });
    });
    const limiter = new PostgresRequestRateLimiter({ query } as unknown as Pick<Pool, "query">, "x".repeat(32));

    for (let index = 0; index < 512; index += 1) await limiter.consume("preferences-read", "127.0.0.1", 120, 60);
    await vi.waitFor(() => expect(failCleanup).toBeTypeOf("function"));
    failCleanup?.();
    for (let index = 0; index < 512; index += 1) await limiter.consume("preferences-read", "127.0.0.1", 120, 60);
    await vi.waitFor(() => expect(query.mock.calls.filter(([sql]) => sql.includes("DELETE FROM request_rate_limits"))).toHaveLength(2));
  });
});
