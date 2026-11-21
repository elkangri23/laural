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
  if (!resendApiKey || resendApiKey.length > 256) throw new Error("RESEND_API_KEY no es válido.");
  if (!resendFrom || resendFrom.length > 254 || /[\r\n]/.test(resendFrom)) throw new Error("RESEND_FROM no es válido.");
  if (!pinPepper || Buffer.byteLength(pinPepper, "utf8") < 32) throw new Error("AUTH_PIN_PEPPER debe tener al menos 32 bytes.");

  return { resendApiKey, resendFrom, pinPepper };
}
