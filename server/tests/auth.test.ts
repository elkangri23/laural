import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSessionAuthenticator } from "../src/auth.js";

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
});
