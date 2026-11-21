import { describe, expect, it } from "vitest";
import {
  createRecoveryCodes,
  createTotpSecret,
  createTotpUri,
  decryptTotpSecret,
  encryptTotpSecret,
  matchingTotpCounter,
  recoveryCodeDigest,
  totpCode,
} from "../src/totp.js";

describe("fundamentos TOTP y códigos de recuperación", () => {
  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  it("genera el vector de seis dígitos RFC 6238", () => {
    expect(totpCode(rfcSecret, 1)).toBe("287082");
    expect(() => totpCode(rfcSecret, -1)).toThrow();
    expect(() => totpCode("!", 1)).toThrow();
  });

  it("acepta el margen temporal de ±1 paso y nunca reutiliza un contador", () => {
    const now = 60_000;
    expect(matchingTotpCounter(rfcSecret, totpCode(rfcSecret, 1), now)).toBe(1);
    expect(matchingTotpCounter(rfcSecret, totpCode(rfcSecret, 3), now)).toBe(3);
    expect(matchingTotpCounter(rfcSecret, totpCode(rfcSecret, 1), now, 1)).toBeNull();
    expect(matchingTotpCounter(rfcSecret, "12345x", now)).toBeNull();
    expect(matchingTotpCounter(rfcSecret, "123456", Number.NaN)).toBeNull();
    expect(matchingTotpCounter(rfcSecret, "123456", -1)).toBeNull();
  });

  it("cifra con autenticación asociada a la cuenta y detecta alteración/intercambio", () => {
    const key = Buffer.alloc(32, 7);
    const encrypted = encryptTotpSecret(rfcSecret, key, "cuenta-1");
    expect(decryptTotpSecret(encrypted, key, "cuenta-1")).toBe(rfcSecret);
    expect(() => decryptTotpSecret(encrypted, key, "cuenta-2")).toThrow();
    const tamperedCiphertext = `${encrypted.ciphertext[0] === "A" ? "B" : "A"}${encrypted.ciphertext.slice(1)}`;
    expect(() => decryptTotpSecret({ ...encrypted, ciphertext: tamperedCiphertext }, key, "cuenta-1")).toThrow();
    expect(() => decryptTotpSecret({ ...encrypted, version: 2 as 1 }, key, "cuenta-1")).toThrow();
    expect(() => decryptTotpSecret({ ...encrypted, nonce: "AA" }, key, "cuenta-1")).toThrow();
    expect(() => encryptTotpSecret(rfcSecret, Buffer.alloc(31), "cuenta-1")).toThrow();
    expect(() => encryptTotpSecret("bad", key, "cuenta-1")).toThrow();
  });

  it("crea secretos y URI compatibles con aplicaciones TOTP", () => {
    const secret = createTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(createTotpUri(secret, "ana@example.test")).toContain("otpauth://totp/Laural%3Aana%40example.test?");
    expect(createTotpUri(secret, "ana@example.test")).toContain("period=30");
  });

  it("genera códigos de recuperación de alta entropía cuyo digest depende de cuenta", () => {
    const codes = createRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/);
    expect(recoveryCodeDigest(codes[0]!, "cuenta-1", "pepper suficientemente largo para pruebas")).toMatch(/^[a-f0-9]{64}$/);
    expect(recoveryCodeDigest(codes[0]!, "cuenta-1", "pepper suficientemente largo para pruebas"))
      .not.toBe(recoveryCodeDigest(codes[0]!, "cuenta-2", "pepper suficientemente largo para pruebas"));
    expect(() => createRecoveryCodes(21)).toThrow();
    expect(() => createRecoveryCodes(0)).toThrow();
    expect(() => recoveryCodeDigest("bad-code", "cuenta-1", "pepper suficientemente largo para pruebas")).toThrow();
    expect(() => recoveryCodeDigest(codes[0]!, "cuenta-1", "short")).toThrow();
  });
});
