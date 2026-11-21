import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSessionAuthenticator, createSessionRevoker } from "../src/auth.js";

describe("autenticación de sesiones", () => {
  it("rechaza cabeceras ausentes o tokens con formato inválido antes de consultar", async () => {
    const query = vi.fn();
    const authenticate = createSessionAuthenticator({ query });
    expect(await authenticate(undefined)).toBeNull();
    expect(await authenticate("Basic abc")).toBeNull();
    expect(await authenticate(`Bearer ${"!".repeat(43)}`)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("busca el hash de un token opaco y devuelve la cuenta activa", async () => {
    const token = "A".repeat(43);
    const query = vi.fn(async (_sql: string, values: string[]) => ({ rows: [{ account_id: "acct-1" }] }));
    const authenticate = createSessionAuthenticator({ query });
    expect(await authenticate(`Bearer ${token}`)).toBe("acct-1");
    expect(query.mock.calls[0]?.[1]).toEqual([createHash("sha256").update(token).digest("hex")]);
    expect(query.mock.calls[0]?.[0]).toContain("email_verified_at IS NOT NULL");
    expect(query.mock.calls[0]?.[0]).toContain("revoked_at IS NULL");
  });

  it("no autentica una sesión desconocida", async () => {
    const authenticate = createSessionAuthenticator({ query: async () => ({ rows: [] }) });
    expect(await authenticate(`Bearer ${"b".repeat(43)}`)).toBeNull();
  });

  it("revoca por hash y cuenta solo la sesión vigente del token presentado", async () => {
    const token = "C".repeat(43);
    const query = vi.fn(async (_sql: string, values: string[]) => ({ rows: [{ id: "session-1" }].slice(0, values[0] === "acct-1" ? 1 : 0) }));
    const revoke = createSessionRevoker({ query });

    expect(await revoke("acct-1", `Bearer ${token}`)).toBe(true);
    expect(query.mock.calls[0]?.[1]).toEqual(["acct-1", createHash("sha256").update(token).digest("hex")]);
    expect(query.mock.calls[0]?.[0]).toContain("revoked_at IS NULL");
    expect(query.mock.calls[0]?.[0]).toContain("expires_at > now()");
    expect(await revoke("acct-2", `Bearer ${token}`)).toBe(false);
    expect(await revoke("acct-1", "Bearer invalid")).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
