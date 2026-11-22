export type ServiceConfig = {
  databaseUrl: string;
  host: string;
  port: number;
  rateLimitPepper: string;
};

export type EmailAuthConfig = {
  resendApiKey: string;
  resendFrom: string;
  pinPepper: string;
  recoveryPepper: string;
  totpEncryptionKey: Buffer;
};

export function readConfig(environment: NodeJS.ProcessEnv): ServiceConfig {
  const databaseUrl = environment.DATABASE_URL?.trim();
  const host = environment.HOST?.trim() || "127.0.0.1";
  const portText = environment.PORT?.trim() || "8080";
  const port = Number(portText);
  const rateLimitPepper = environment.RATE_LIMIT_PEPPER?.trim();
  const rateLimitPepperBytes = rateLimitPepper ? Buffer.byteLength(rateLimitPepper, "utf8") : 0;

  if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("DATABASE_URL debe indicar una conexión PostgreSQL.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT debe ser un entero entre 1 y 65535.");
  }
  if (!host || host.length > 255 || /[\s/\\]/.test(host)) {
    throw new Error("HOST no es válido.");
  }
  if (!rateLimitPepper || rateLimitPepperBytes < 32 || rateLimitPepperBytes > 256) {
    throw new Error("RATE_LIMIT_PEPPER debe tener entre 32 y 256 bytes.");
  }

  return { databaseUrl, host, port, rateLimitPepper };
}

export function readEmailAuthConfig(environment: NodeJS.ProcessEnv): EmailAuthConfig | null {
  if (environment.EMAIL_AUTH_ENABLED?.trim().toLowerCase() !== "true") return null;

  const resendApiKey = environment.RESEND_API_KEY?.trim();
  const resendFrom = environment.RESEND_FROM?.trim();
  const pinPepper = environment.AUTH_PIN_PEPPER?.trim();
  const recoveryPepper = environment.AUTH_RECOVERY_PEPPER?.trim();
  const totpEncryptionKeyText = environment.TOTP_ENCRYPTION_KEY?.trim();
  const totpEncryptionKey = totpEncryptionKeyText ? Buffer.from(totpEncryptionKeyText, "base64url") : Buffer.alloc(0);
  if (!resendApiKey || resendApiKey.length > 256) throw new Error("RESEND_API_KEY no es válido.");
  if (!resendFrom || resendFrom.length > 254 || /[\r\n]/.test(resendFrom)) throw new Error("RESEND_FROM no es válido.");
  if (!pinPepper || Buffer.byteLength(pinPepper, "utf8") < 32) throw new Error("AUTH_PIN_PEPPER debe tener al menos 32 bytes.");
  if (!recoveryPepper || Buffer.byteLength(recoveryPepper, "utf8") < 32) throw new Error("AUTH_RECOVERY_PEPPER debe tener al menos 32 bytes.");
  if (!totpEncryptionKeyText || totpEncryptionKey.length !== 32 || totpEncryptionKey.toString("base64url") !== totpEncryptionKeyText) {
    throw new Error("TOTP_ENCRYPTION_KEY debe ser una clave base64url de 32 bytes.");
  }

  return { resendApiKey, resendFrom, pinPepper, recoveryPepper, totpEncryptionKey };
}
