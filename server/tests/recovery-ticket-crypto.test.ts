import { describe, expect, it } from "vitest";
import { decryptRecoveryTicket, encryptRecoveryTicket } from "../src/recovery-ticket-crypto.js";

const pepper = "test-recovery-pepper-with-at-least-32-characters";
const ticket = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
const grantId = "c35c91ca-5a81-4008-8811-91971f7c17ad";

describe("cifrado del ticket de recuperación", () => {
  it("cifra un ticket aleatorio con nonce distinto y liga el descifrado al caso", () => {
    const first = encryptRecoveryTicket(ticket, pepper, grantId);
    const second = encryptRecoveryTicket(ticket, pepper, grantId);
    expect(first).not.toHaveProperty("ticket");
    expect(first.ciphertext).not.toContain(ticket);
    expect(first.nonce).not.toBe(second.nonce);
    expect(decryptRecoveryTicket(first, pepper, grantId)).toBe(ticket);
    expect(() => decryptRecoveryTicket(first, pepper, `${grantId.slice(0, -1)}e`)).toThrow();
  });

  it("rechaza sobres alterados, versiones desconocidas, pepper corto y ticket mal formado", () => {
    const envelope = encryptRecoveryTicket(ticket, pepper, grantId);
    expect(() => decryptRecoveryTicket({ ...envelope, tag: "AA" }, pepper, grantId)).toThrow("formato válido");
    expect(() => decryptRecoveryTicket({ ...envelope, version: 2 } as never, pepper, grantId)).toThrow("versión");
    expect(() => encryptRecoveryTicket(ticket, "short", grantId)).toThrow("32 bytes");
    expect(() => encryptRecoveryTicket("bad", pepper, grantId)).toThrow("formato válido");
    const malformedTicket = encryptRecoveryTicket(ticket, pepper, grantId);
    const altered = { ...malformedTicket, ciphertext: Buffer.from("bad").toString("base64url") };
    expect(() => decryptRecoveryTicket(altered, pepper, grantId)).toThrow("formato válido");
  });
});
