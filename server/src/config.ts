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

export type PasskeyConfig = {
  rpName: string;
  rpId: string;
  origin: string;
};

export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function readGoogleOAuthConfig(environment: NodeJS.ProcessEnv, emailAuthEnabled: boolean): GoogleOAuthConfig | null {
  if (environment.GOOGLE_OAUTH_ENABLED?.trim().toLowerCase() !== "true") return null;
  if (!emailAuthEnabled) throw new Error("GOOGLE_OAUTH_ENABLED requiere EMAIL_AUTH_ENABLED=true.");
  const clientId = environment.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = environment.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || clientId.length > 255 || !clientId.endsWith(".apps.googleusercontent.com")) throw new Error("GOOGLE_OAUTH_CLIENT_ID no es válido.");
  if (!clientSecret || clientSecret.length > 512 || /[\r\n]/.test(clientSecret)) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET no es válido.");
  let redirect: URL;
  try { redirect = new URL(redirectUri ?? ""); } catch { throw new Error("GOOGLE_OAUTH_REDIRECT_URI debe ser HTTPS."); }
  if (redirect.protocol !== "https:" || redirect.pathname !== "/auth/google/callback"
    || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.href !== redirectUri) {
    throw new Error("GOOGLE_OAUTH_REDIRECT_URI debe ser una URL HTTPS exacta terminada en /auth/google/callback.");
  }
  return { clientId, clientSecret, redirectUri: redirect.href };
}

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

export function readPasskeyConfig(environment: NodeJS.ProcessEnv, emailAuthEnabled: boolean): PasskeyConfig | null {
  if (environment.PASSKEYS_ENABLED?.trim().toLowerCase() !== "true") return null;
  if (!emailAuthEnabled) throw new Error("PASSKEYS_ENABLED requiere EMAIL_AUTH_ENABLED=true.");

  const rpName = environment.PASSKEY_RP_NAME?.trim() || "Laural";
  const rpId = environment.PASSKEY_RP_ID?.trim().toLowerCase();
  const origin = environment.PASSKEY_ORIGIN?.trim();
  if (!rpId || rpId.length > 253 || !/^(localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})$/.test(rpId)) {
    throw new Error("PASSKEY_RP_ID debe ser un nombre DNS o localhost válido.");
  }
  if (rpName.length < 1 || rpName.length > 64) throw new Error("PASSKEY_RP_NAME debe tener entre 1 y 64 caracteres.");
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin ?? "");
  } catch {
    throw new Error("PASSKEY_ORIGIN debe ser un origen HTTPS válido.");
  }
  const localOrigin = rpId === "localhost" && parsedOrigin.protocol === "http:" && parsedOrigin.hostname === "localhost";
  if ((!localOrigin && parsedOrigin.protocol !== "https:") || parsedOrigin.origin !== origin || parsedOrigin.hostname !== rpId) {
    throw new Error("PASSKEY_ORIGIN debe ser HTTPS y coincidir exactamente con PASSKEY_RP_ID.");
  }
  return { rpName, rpId, origin: parsedOrigin.origin };
}
