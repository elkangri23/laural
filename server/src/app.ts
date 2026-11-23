import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import formbody from "@fastify/formbody";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { PreferenceSnapshot, PreferenceStore, ReadinessCheck, Authenticate, ListAccountSessions, RevokeAccountSession, RevokeOtherSessions, RevokeSession } from "./contracts.js";
import { normalizeEmail, type EmailAuthService } from "./email-auth.js";
import type { AccountMfaService } from "./account-mfa.js";
import type { AccountDeletionService } from "./account-deletion.js";
import { AccountPasskeyService, type PasskeySummary } from "./account-passkeys.js";
import { NativeAuthService, sha256, validateNativeFlowParameters, type LoginResult } from "./native-auth.js";
import type { RequestRateLimiter } from "./request-rate-limit.js";
import type { GoogleOAuthService } from "./google-oauth.js";
import snapshotSchema from "../../shared/preference-snapshot-v1.schema.json" with { type: "json" };

const BODY_LIMIT = 256 * 1024;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSnapshot = ajv.compile<PreferenceSnapshot>(snapshotSchema);

export type AppDependencies = {
  store: PreferenceStore;
  authenticate: Authenticate;
  revokeSession: RevokeSession;
  listAccountSessions: ListAccountSessions;
  revokeAccountSession: RevokeAccountSession;
  revokeOtherSessions: RevokeOtherSessions;
  checkReadiness: ReadinessCheck;
  emailAuth?: EmailAuthService;
  nativeAuth?: NativeAuthService;
  accountMfa?: AccountMfaService;
  accountDeletion?: AccountDeletionService;
  accountPasskeys?: AccountPasskeyService;
  googleOAuth?: GoogleOAuthService;
  requestRateLimiter: RequestRateLimiter;
};

type RegistrationBody = { displayName: string; email: string; password: string };
type EmailPinBody = { email: string; pin: string };
type EmailBody = { email: string };
type NativeLoginBody = { csrf: string; email: string; password: string };
type NativeMfaLoginBody = { csrf: string; email: string; proof: string };
type NativeRegisterBody = RegistrationBody & { csrf: string };
type NativePinBody = EmailPinBody & { csrf: string };
type NativeEmailBody = EmailBody & { csrf: string };
type NativePasswordResetBody = EmailBody & { csrf: string };
type PasswordResetBody = EmailPinBody & { password: string };
type NativePasswordResetConfirmBody = NativePinBody & { password: string };
type NativeStartQuery = { redirect_uri: string; state: string; code_challenge: string; code_challenge_method: "S256" };
type GoogleCallbackQuery = { state?: string; code?: string; error?: string };
type NativeExchangeBody = { code: string; codeVerifier: string };
type PasskeyLoginBody = { csrf: string; response?: unknown };
type PasskeyRegistrationBody = { csrf: string; displayName: string };
type PasskeyVerifyRegistrationBody = { csrf: string; response: unknown };

const FLOW_COOKIE = "__Host-laural-flow";
const PASSKEY_SESSION_COOKIE = "__Host-laural-passkey-session";
const PASSKEY_CSRF_COOKIE = "__Host-laural-passkey-csrf";

export function createApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT, trustProxy: ["127.0.0.1", "::1"] });
  const rateLimit = dependencies.requestRateLimiter;

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    return payload;
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await dependencies.checkReadiness();
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  const emailAuth = dependencies.emailAuth;
  const nativeAuth = dependencies.nativeAuth;
  const accountMfa = dependencies.accountMfa;
  const accountDeletion = dependencies.accountDeletion;
  const accountPasskeys = dependencies.accountPasskeys;
  const googleOAuth = dependencies.googleOAuth;

  app.get("/v1/auth/passkeys/status", { preHandler: limited(rateLimit, "passkey-status", 30, 60) }, async (request, reply) => {
    if (!await dependencies.authenticate(request.headers.authorization)) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({ enabled: Boolean(accountPasskeys) });
  });

  app.post("/v1/auth/session/revoke", { preHandler: limited(rateLimit, "session-revoke", 10, 60) }, async (request, reply) => {
    const authorization = request.headers.authorization;
    const accountId = await dependencies.authenticate(authorization);
    if (!accountId || !await dependencies.revokeSession(accountId, authorization)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.code(204).send();
  });

  app.get("/v1/auth/sessions", { preHandler: limited(rateLimit, "session-list", 20, 60) }, async (request, reply) => {
    const authorization = request.headers.authorization;
    const accountId = await dependencies.authenticate(authorization);
    if (!accountId) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({ sessions: await dependencies.listAccountSessions(accountId, authorization) });
  });

  app.delete<{ Params: { sessionId: string } }>("/v1/auth/sessions/:sessionId", {
    preHandler: limited(rateLimit, "session-revoke-other", 10, 60),
    schema: { params: { type: "object", additionalProperties: false, required: ["sessionId"], properties: { sessionId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    const authorization = request.headers.authorization;
    const accountId = await dependencies.authenticate(authorization);
    if (!accountId || !await dependencies.revokeAccountSession(accountId, authorization, request.params.sessionId)) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.code(204).send();
  });

  app.post("/v1/auth/sessions/revoke-others", { preHandler: limited(rateLimit, "session-revoke-others", 5, 60) }, async (request, reply) => {
    const authorization = request.headers.authorization;
    const accountId = await dependencies.authenticate(authorization);
    if (!accountId) return reply.code(401).send({ error: "unauthorized" });
    const revoked = await dependencies.revokeOtherSessions(accountId, authorization);
    return reply.send({ revoked });
  });

  if (accountDeletion) {
    app.delete<{ Body: { confirmation: "ELIMINAR" } }>("/v1/auth/account", {
      preHandler: limited(rateLimit, "account-delete", 3, 900),
      schema: {
        body: {
          type: "object", additionalProperties: false,
          required: ["confirmation"],
          properties: { confirmation: { const: "ELIMINAR" } },
        },
      },
    }, async (request, reply) => {
      const authorization = request.headers.authorization;
      const accountId = await dependencies.authenticate(authorization);
      if (!accountId) return reply.code(401).send({ error: "unauthorized" });
      const result = await accountDeletion.deleteAccount(accountId, authorization);
      if (result === "recent_auth_required") return reply.code(403).send({ error: "recent_auth_required" });
      if (result === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
      return reply.code(204).send();
    });
  }

  if (emailAuth && nativeAuth) {
    void app.register(formbody, { bodyLimit: 8 * 1024 });

    app.get<{ Querystring: NativeStartQuery }>("/auth/native", {
      preHandler: limited(rateLimit, "native-flow", 10, 60),
      schema: {
        querystring: {
          type: "object", additionalProperties: false,
          required: ["redirect_uri", "state", "code_challenge", "code_challenge_method"],
          properties: {
            redirect_uri: { type: "string", minLength: 1, maxLength: 256 },
            state: { type: "string", minLength: 43, maxLength: 128 },
            code_challenge: { type: "string", minLength: 43, maxLength: 43 },
            code_challenge_method: { const: "S256" },
          },
        },
      },
    }, async (request, reply) => {
      const { redirect_uri: redirectUri, state, code_challenge: codeChallenge } = request.query;
      if (!validateNativeFlowParameters({ redirectUri, state, codeChallenge })) {
        return reply.code(400).type("text/plain; charset=utf-8").send("Solicitud de autenticación no válida.");
      }
      const credentials = await nativeAuth.startFlow({ redirectUri, state, codeChallenge });
      reply.header("Set-Cookie", flowCookie(credentials.cookieToken));
      return reply.type("text/html; charset=utf-8").send(renderAuthPage(credentials.csrfToken, "", Boolean(accountPasskeys), Boolean(googleOAuth)));
    });

    if (googleOAuth) {
      app.post<{ Body: { csrf: string } }>("/auth/native/google/start", {
        preHandler: limited(rateLimit, "google-oauth-start", 10, 60),
        schema: { body: { type: "object", additionalProperties: false, required: ["csrf"], properties: { csrf: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" } } } },
      }, async (request, reply) => {
        const cookie = readCookie(request.headers.cookie, FLOW_COOKIE);
        if (!await nativeAuth.isBrowserFlowValid(cookie, request.body.csrf)) {
          return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage("", "La sesión de autenticación caducó. Vuelve a iniciar el proceso en Laural."));
        }
        const url = await googleOAuth.start(sha256(cookie!), sha256(request.body.csrf));
        return reply.redirect(url, 303);
      });

      app.get<{ Querystring: GoogleCallbackQuery }>("/auth/google/callback", {
        preHandler: limited(rateLimit, "google-oauth-callback", 20, 60),
        schema: { querystring: {
          type: "object", additionalProperties: false,
          properties: {
            state: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
            code: { type: "string", minLength: 1, maxLength: 2048 },
            error: { type: "string", maxLength: 128 },
          },
        } },
      }, async (request, reply) => {
        const { state, code, error } = request.query;
        if (!state) {
          return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage("", "No se pudo completar el acceso con Google. Vuelve a iniciar el proceso en Laural."));
        }
        if (Boolean(code) === Boolean(error)) {
          await googleOAuth.cancel(state);
          return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage("", "No se pudo completar el acceso con Google. Vuelve a iniciar el proceso en Laural."));
        }
        if (error) await googleOAuth.cancel(state);
        const flow = code ? await googleOAuth.finish(state, code) : null;
        if (!flow) {
          return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage("", "No se pudo completar el acceso con Google. Vuelve a iniciar el proceso en Laural."));
        }
        const result = await nativeAuth.completeFederatedLogin(flow);
        if (!result) {
          return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage("", "No se pudo completar el acceso con Google. Vuelve a iniciar el proceso en Laural."));
        }
        if (result.login.kind === "mfa_required") {
          return reply.type("text/html; charset=utf-8").send(renderMfaPage(result.csrfToken, result.login.email ?? "", "Verifica tu segundo factor para continuar."));
        }
        return redirectNativeLogin(reply, result.login);
      });
    }

    app.get("/auth.css", async (_request, reply) => {
      const stylesheet = await readFile(new URL("../web/auth.css", import.meta.url), "utf8");
      return reply.type("text/css; charset=utf-8").send(stylesheet);
    });

    app.post<{ Body: NativeLoginBody }>("/auth/native/login", {
      preHandler: limited(rateLimit, "native-login", 10, 60),
      schema: { body: nativeLoginSchema },
    }, async (request, reply) => {
      const cookieToken = readCookie(request.headers.cookie, FLOW_COOKIE);
      if (!await nativeAuth.isBrowserFlowValid(cookieToken, request.body.csrf)) {
        return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage("", "La sesión de autenticación caducó. Vuelve a iniciar el proceso en Laural."));
      }
      if (await emailLimitExceeded(rateLimit, "native-login-email", request.body.email, 10, 60, reply)) {
        return reply.type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "Demasiados intentos para este correo. Espera antes de volver a intentarlo."));
      }
      const result = await nativeAuth.login({
        cookieToken: cookieToken ?? "",
        csrfToken: request.body.csrf,
        email: request.body.email,
        password: request.body.password,
      });
      if (!result) return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "No se pudo iniciar sesión. Revisa los datos y que el correo esté verificado."));
      if (result.kind === "mfa_required") {
        return reply.type("text/html; charset=utf-8").send(renderMfaPage(request.body.csrf, request.body.email));
      }
      return redirectNativeLogin(reply, result);
    });

    app.post<{ Body: NativeMfaLoginBody }>("/auth/native/login/mfa", {
      preHandler: limited(rateLimit, "native-mfa-login", 10, 60),
      schema: { body: nativeMfaLoginSchema },
    }, async (request, reply) => {
      const cookieToken = readCookie(request.headers.cookie, FLOW_COOKIE);
      if (!await nativeAuth.isBrowserFlowValid(cookieToken, request.body.csrf)) {
        return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage("", "La sesión de autenticación caducó. Vuelve a iniciar el proceso en Laural."));
      }
      const accountId = await accountMfa?.pendingMfaLoginAccountId(cookieToken ?? "", request.body.csrf, request.body.email);
      if (accountId && !await rateLimit.consume("native-mfa-account", accountId, 10, 300)) {
        return reply.header("Retry-After", "300").code(429).type("text/html; charset=utf-8")
          .send(renderMfaPage(request.body.csrf, request.body.email, "Demasiados intentos para esta cuenta. Espera cinco minutos antes de volver a intentarlo."));
      }
      const result = await nativeAuth.completeMfa({
        cookieToken: cookieToken ?? "",
        csrfToken: request.body.csrf,
        email: request.body.email,
        proof: request.body.proof,
      });
      if (!result || result.kind !== "authorized") {
        return reply.code(400).type("text/html; charset=utf-8").send(renderMfaPage(request.body.csrf, request.body.email, "Código incorrecto o caducado. Inténtalo de nuevo."));
      }
      return redirectNativeLogin(reply, result);
    });

    app.post<{ Body: NativeRegisterBody }>("/auth/native/register", {
      preHandler: limited(rateLimit, "native-register", 3, 900),
      schema: { body: nativeRegisterSchema },
    }, async (request, reply) => {
      if (!await nativeAuth.isBrowserFlowValid(readCookie(request.headers.cookie, FLOW_COOKIE), request.body.csrf)) {
        return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage("", "La sesión de autenticación caducó. Vuelve a iniciar el proceso en Laural."));
      }
      if (await emailLimitExceeded(rateLimit, "auth-register-email", request.body.email, 3, 900, reply)) {
        return reply.type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "Demasiadas solicitudes para este correo. Espera antes de volver a intentarlo."));
      }
      await emailAuth.register(request.body);
      return reply.type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "Si los datos son válidos, enviaremos un PIN de verificación al correo indicado."));
    });

    app.post<{ Body: NativeEmailBody }>("/auth/native/verification/resend", {
      preHandler: limited(rateLimit, "native-resend", 3, 900),
      schema: { body: nativeEmailSchema },
    }, async (request, reply) => {
      if (!await nativeAuth.isBrowserFlowValid(readCookie(request.headers.cookie, FLOW_COOKIE), request.body.csrf)) {
        return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage("", "La sesión de autenticación caducó. Vuelve a iniciar el proceso en Laural."));
      }
      if (await emailLimitExceeded(rateLimit, "auth-resend-email", request.body.email, 3, 900, reply)) {
        return reply.type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "Demasiadas solicitudes para este correo. Espera antes de volver a intentarlo."));
      }
      await emailAuth.resendVerification(request.body.email);
      return reply.type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "Si la cuenta necesita verificación, enviaremos un nuevo PIN."));
    });

    app.post<{ Body: NativePinBody }>("/auth/native/verification/confirm", {
      preHandler: limited(rateLimit, "native-verify", 10, 60),
      schema: { body: nativePinSchema },
    }, async (request, reply) => {
      if (!await nativeAuth.isBrowserFlowValid(readCookie(request.headers.cookie, FLOW_COOKIE), request.body.csrf)) {
        return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage("", "La sesión de autenticación caducó. Vuelve a iniciar el proceso en Laural."));
      }
      if (await emailLimitExceeded(rateLimit, "auth-verify-email", request.body.email, 10, 300, reply)) {
        return reply.type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "Demasiados intentos para este correo. Espera antes de volver a intentarlo."));
      }
      await emailAuth.verify(request.body.email, request.body.pin);
      return reply.type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "Solicitud procesada. Si el PIN era correcto, ya puedes probar a iniciar sesión."));
    });

    app.post<{ Body: NativePasswordResetBody }>("/auth/native/password-reset/request", {
      preHandler: limited(rateLimit, "password-reset-request", 3, 900),
      schema: { body: nativeEmailSchema },
    }, async (request, reply) => {
      if (!await nativeAuth.isBrowserFlowValid(readCookie(request.headers.cookie, FLOW_COOKIE), request.body.csrf)) {
        return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage("", "La sesión de autenticación caducó. Vuelve a iniciar el proceso en Laural."));
      }
      if (await emailLimitExceeded(rateLimit, "password-reset-request-email", request.body.email, 3, 900, reply)) {
        return reply.type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "Demasiadas solicitudes para este correo. Espera antes de volver a intentarlo."));
      }
      await emailAuth.requestPasswordReset(request.body.email);
      return reply.type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "Si la cuenta puede recuperarse, enviaremos un PIN al correo indicado."));
    });

    app.post<{ Body: NativePasswordResetConfirmBody }>("/auth/native/password-reset/confirm", {
      preHandler: limited(rateLimit, "password-reset-confirm", 10, 60),
      schema: { body: nativePasswordResetSchema },
    }, async (request, reply) => {
      if (!await nativeAuth.isBrowserFlowValid(readCookie(request.headers.cookie, FLOW_COOKIE), request.body.csrf)) {
        return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage("", "La sesión de autenticación caducó. Vuelve a iniciar el proceso en Laural."));
      }
      if (await emailLimitExceeded(rateLimit, "password-reset-confirm-email", request.body.email, 10, 300, reply)) {
        return reply.type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "Demasiados intentos para este correo. Espera antes de volver a intentarlo."));
      }
      const result = await emailAuth.confirmPasswordReset(request.body.email, request.body.pin, request.body.password);
      if (result === "invalid_request") return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "Revisa el formato de los datos e inténtalo de nuevo."));
      return reply.type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "Solicitud procesada. Si el PIN era correcto, la contraseña se cambió; vuelve a iniciar sesión. El PIN no inicia sesión ni elimina factores de seguridad."));
    });

    app.post<{ Body: NativeExchangeBody }>("/v1/auth/native/exchange", {
      preHandler: limited(rateLimit, "native-exchange", 10, 60),
      schema: {
        body: {
          type: "object", additionalProperties: false,
          required: ["code", "codeVerifier"],
          properties: {
            code: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
            codeVerifier: { type: "string", pattern: "^[A-Za-z0-9._~-]{43,128}$" },
          },
        },
      },
    }, async (request, reply) => {
      const grant = await nativeAuth.exchange(request.body.code, request.body.codeVerifier);
      if (!grant) return reply.code(400).send({ error: "invalid_or_expired_code" });
      return reply.send({ sessionToken: grant.token, expiresAt: grant.expiresAt });
    });
  }

  if (accountPasskeys && nativeAuth) {
    app.get("/auth/passkeys.js", async (_request, reply) => {
      const script = await readFile(new URL("../web/passkeys-client.js", import.meta.url), "utf8");
      return reply.type("text/javascript; charset=utf-8").send(script);
    });

    app.post<{ Body: { csrf: string } }>("/auth/native/passkey/options", {
      bodyLimit: 1024,
      preHandler: limited(rateLimit, "passkey-login-options", 10, 60),
      schema: { body: { type: "object", additionalProperties: false, required: ["csrf"], properties: { csrf: { type: "string", minLength: 43, maxLength: 43 } } } },
    }, async (request, reply) => {
      const cookie = readCookie(request.headers.cookie, FLOW_COOKIE) ?? "";
      if (!await nativeAuth.isBrowserFlowValid(cookie, request.body.csrf)) return reply.code(400).send({ error: "invalid_or_expired_flow" });
      const options = await accountPasskeys.createLoginOptions(cookie, request.body.csrf);
      return options ? reply.send(options) : reply.code(400).send({ error: "invalid_or_expired_flow" });
    });

    app.post<{ Body: PasskeyLoginBody }>("/auth/native/passkey/verify", {
      bodyLimit: 24 * 1024,
      preHandler: limited(rateLimit, "passkey-login-verify", 10, 60),
      schema: {
        body: {
          type: "object", additionalProperties: false, required: ["csrf", "response"],
          properties: { csrf: { type: "string", minLength: 43, maxLength: 43 }, response: { type: "object", additionalProperties: true } },
        },
      },
    }, async (request, reply) => {
      const cookie = readCookie(request.headers.cookie, FLOW_COOKIE) ?? "";
      if (!request.body.response || !await nativeAuth.isBrowserFlowValid(cookie, request.body.csrf)) {
        return reply.code(400).send({ error: "invalid_or_expired_flow" });
      }
      const verified = await accountPasskeys.verifyLogin(cookie, request.body.csrf, request.body.response as never);
      if (!verified) {
        await nativeAuth.failPasskeyLogin(cookie, request.body.csrf);
        return reply.code(401).send({ error: "authentication_failed" });
      }
      const result = await nativeAuth.completePasskeyLogin({ cookieToken: cookie, csrfToken: request.body.csrf, accountId: verified.accountId });
      if (!result) return reply.code(401).send({ error: "authentication_failed" });
      if (result.kind === "mfa_required") return reply.send({ mfaRequired: true, email: result.email });
      reply.header("Set-Cookie", expiredFlowCookie());
      return reply.send({ redirect: nativeLoginUrl(result) });
    });

    app.post("/v1/auth/passkeys/manage-link", { preHandler: limited(rateLimit, "passkey-management-link", 5, 60) }, async (request, reply) => {
      const accountId = await dependencies.authenticate(request.headers.authorization);
      if (!accountId) return reply.code(401).send({ error: "unauthorized" });
      const ticket = await accountPasskeys.createManagementTicket(accountId, request.headers.authorization);
      if (!ticket) return reply.code(403).send({ error: "recent_auth_required" });
      return reply.code(201).send({ url: accountPasskeys.managementUrl(ticket) });
    });

    app.post<{ Body: { ticket: string } }>("/auth/passkeys/manage/redeem", {
      bodyLimit: 1024,
      preHandler: limited(rateLimit, "passkey-management-redeem", 5, 60),
      schema: { body: { type: "object", additionalProperties: false, required: ["ticket"], properties: { ticket: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" } } } },
    }, async (request, reply) => {
      const session = await accountPasskeys.consumeManagementTicket(request.body.ticket);
      if (!session) return reply.code(410).send({ error: "ticket_expired" });
      reply.header("Set-Cookie", [passkeySessionCookie(session.cookieToken), passkeyCsrfCookie(session.csrfToken)]);
      return reply.send({ csrf: session.csrfToken });
    });

    app.get("/auth/passkeys/manage", async (request, reply) => {
      const cookie = readCookie(request.headers.cookie, PASSKEY_SESSION_COOKIE) ?? "";
      const csrf = readCookie(request.headers.cookie, PASSKEY_CSRF_COOKIE) ?? "";
      const passkeys = await accountPasskeys.listManagementPasskeys(cookie, csrf);
      if (!passkeys) return reply.type("text/html; charset=utf-8").send(renderPasskeyBootstrapPage());
      return reply.type("text/html; charset=utf-8").send(renderPasskeyManagementPage(csrf, passkeys));
    });

    app.get("/auth/passkeys/manage/list", { preHandler: limited(rateLimit, "passkey-management-list", 30, 60) }, async (request, reply) => {
      const cookie = readCookie(request.headers.cookie, PASSKEY_SESSION_COOKIE) ?? "";
      const csrf = request.headers["x-csrf-token"];
      if (typeof csrf !== "string" || csrf !== readCookie(request.headers.cookie, PASSKEY_CSRF_COOKIE)) return reply.code(403).send({ error: "invalid_csrf" });
      const passkeys = await accountPasskeys.listManagementPasskeys(cookie, csrf);
      return passkeys ? reply.send(passkeys) : reply.code(401).send({ error: "session_expired" });
    });

    app.post<{ Body: PasskeyRegistrationBody }>("/auth/passkeys/manage/options", {
      bodyLimit: 1024,
      preHandler: limited(rateLimit, "passkey-registration-options", 5, 900),
      schema: {
        body: { type: "object", additionalProperties: false, required: ["csrf", "displayName"], properties: {
          csrf: { type: "string", minLength: 43, maxLength: 43 }, displayName: { type: "string", minLength: 1, maxLength: 80 },
        } },
      },
    }, async (request, reply) => {
      const cookie = readCookie(request.headers.cookie, PASSKEY_SESSION_COOKIE) ?? "";
      if (request.body.csrf !== readCookie(request.headers.cookie, PASSKEY_CSRF_COOKIE)
        || request.body.csrf !== request.headers["x-csrf-token"]) return reply.code(403).send({ error: "invalid_csrf" });
      const options = await accountPasskeys.createRegistrationOptions(cookie, request.body.csrf, request.body.displayName);
      return options ? reply.send(options) : reply.code(409).send({ error: "registration_not_allowed" });
    });

    app.post<{ Body: PasskeyVerifyRegistrationBody }>("/auth/passkeys/manage/register", {
      bodyLimit: 24 * 1024,
      preHandler: limited(rateLimit, "passkey-registration-verify", 5, 900),
      schema: { body: { type: "object", additionalProperties: false, required: ["csrf", "response"], properties: {
        csrf: { type: "string", minLength: 43, maxLength: 43 }, response: { type: "object", additionalProperties: true },
      } } },
    }, async (request, reply) => {
      const cookie = readCookie(request.headers.cookie, PASSKEY_SESSION_COOKIE) ?? "";
      if (request.body.csrf !== readCookie(request.headers.cookie, PASSKEY_CSRF_COOKIE)
        || request.body.csrf !== request.headers["x-csrf-token"]) return reply.code(403).send({ error: "invalid_csrf" });
      const saved = await accountPasskeys.verifyRegistration(cookie, request.body.csrf, request.body.response as never);
      return saved ? reply.code(201).send({ status: "saved" }) : reply.code(400).send({ error: "registration_failed" });
    });

    app.delete<{ Params: { id: string } }>("/auth/passkeys/manage/:id", {
      preHandler: limited(rateLimit, "passkey-management-delete", 5, 60),
      schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      const cookie = readCookie(request.headers.cookie, PASSKEY_SESSION_COOKIE) ?? "";
      const csrf = request.headers["x-csrf-token"];
      if (typeof csrf !== "string" || csrf !== readCookie(request.headers.cookie, PASSKEY_CSRF_COOKIE)) return reply.code(403).send({ error: "invalid_csrf" });
      const removed = await accountPasskeys.removeManagementPasskey(cookie, csrf, request.params.id);
      return removed ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
    });
  }

  if (accountMfa) {
    app.get("/v1/auth/mfa", { preHandler: limited(rateLimit, "mfa-status", 30, 60) }, async (request, reply) => {
      const accountId = await dependencies.authenticate(request.headers.authorization);
      if (!accountId) return reply.code(401).send({ error: "unauthorized" });
      return reply.send(await accountMfa.status(accountId));
    });

    app.post("/v1/auth/mfa/totp/enrollment", { preHandler: limited(rateLimit, "mfa-enroll-start", 3, 900) }, async (request, reply) => {
      const authorization = request.headers.authorization;
      const accountId = await dependencies.authenticate(authorization);
      if (!accountId) return reply.code(401).send({ error: "unauthorized" });
      const result = await accountMfa.startEnrollment(accountId, authorization);
      if (!result) return reply.code(409).send({ error: "recent_login_required_or_factor_exists" });
      return reply.send(result);
    });

    app.post<{ Body: { code: string } }>("/v1/auth/mfa/totp/enrollment/confirm", {
      preHandler: limited(rateLimit, "mfa-enroll-confirm", 10, 60),
      schema: { body: { type: "object", additionalProperties: false, required: ["code"], properties: { code: { type: "string", pattern: "^[0-9]{6}$" } } } },
    }, async (request, reply) => {
      const authorization = request.headers.authorization;
      const accountId = await dependencies.authenticate(authorization);
      if (!accountId) return reply.code(401).send({ error: "unauthorized" });
      const codes = await accountMfa.confirmEnrollment(accountId, authorization, request.body.code);
      if (!codes) return reply.code(400).send({ error: "invalid_or_expired_code" });
      return reply.send({ recoveryCodes: codes });
    });

    app.post("/v1/auth/mfa/totp/enrollment/complete", { preHandler: limited(rateLimit, "mfa-enroll-complete", 5, 60) }, async (request, reply) => {
      const authorization = request.headers.authorization;
      const accountId = await dependencies.authenticate(authorization);
      if (!accountId) return reply.code(401).send({ error: "unauthorized" });
      if (!await accountMfa.acknowledgeRecoveryCodes(accountId, authorization)) return reply.code(409).send({ error: "recent_login_required_or_no_pending_enrollment" });
      return reply.code(204).send();
    });

    app.delete("/v1/auth/mfa/totp/enrollment", { preHandler: limited(rateLimit, "mfa-enroll-cancel", 5, 60) }, async (request, reply) => {
      const authorization = request.headers.authorization;
      const accountId = await dependencies.authenticate(authorization);
      if (!accountId) return reply.code(401).send({ error: "unauthorized" });
      await accountMfa.cancelEnrollment(accountId, authorization);
      return reply.code(204).send();
    });

    app.post("/v1/auth/mfa/recovery-codes/rotate", { preHandler: limited(rateLimit, "mfa-recovery-rotate", 5, 60) }, async (request, reply) => {
      const authorization = request.headers.authorization;
      const accountId = await dependencies.authenticate(authorization);
      if (!accountId) return reply.code(401).send({ error: "unauthorized" });
      const codes = await accountMfa.rotateRecoveryCodes(accountId, authorization);
      if (!codes) return reply.code(409).send({ error: "recent_login_required_or_factor_disabled" });
      return reply.send({ recoveryCodes: codes });
    });

    app.delete("/v1/auth/mfa/totp", { preHandler: limited(rateLimit, "mfa-totp-disable", 5, 60) }, async (request, reply) => {
      const authorization = request.headers.authorization;
      const accountId = await dependencies.authenticate(authorization);
      if (!accountId) return reply.code(401).send({ error: "unauthorized" });
      if (!await accountMfa.disableTotp(accountId, authorization)) return reply.code(409).send({ error: "recent_login_required_or_factor_disabled" });
      return reply.code(204).send();
    });
  }

  if (emailAuth) {
    app.post<{ Body: RegistrationBody }>("/v1/auth/register", {
      preHandler: [limited(rateLimit, "api-register", 3, 900), limitedEmail(rateLimit, "auth-register-email", 3, 900)],
      schema: {
        body: {
          type: "object", additionalProperties: false,
          required: ["displayName", "email", "password"],
          properties: {
            displayName: { type: "string", minLength: 1, maxLength: 80 },
            email: { type: "string", minLength: 6, maxLength: 320 },
            password: { type: "string", minLength: 12, maxLength: 128 },
          },
        },
      },
    }, async (request, reply) => {
      const result = await emailAuth.register(request.body);
      if (result === "invalid_request") return reply.code(400).send({ error: "invalid_request" });
      return reply.code(202).send({ status: "accepted" });
    });

    app.post<{ Body: EmailBody }>("/v1/auth/verification/resend", {
      preHandler: [limited(rateLimit, "api-resend", 3, 900), limitedEmail(rateLimit, "auth-resend-email", 3, 900)],
      schema: {
        body: {
          type: "object", additionalProperties: false,
          required: ["email"], properties: { email: { type: "string", minLength: 6, maxLength: 320 } },
        },
      },
    }, async (request, reply) => {
      const result = await emailAuth.resendVerification(request.body.email);
      if (result === "invalid_request") return reply.code(400).send({ error: "invalid_request" });
      return reply.code(202).send({ status: "accepted" });
    });

    app.post<{ Body: EmailPinBody }>("/v1/auth/verification/confirm", {
      preHandler: [limited(rateLimit, "api-verify", 10, 60), limitedEmail(rateLimit, "auth-verify-email", 10, 300)],
      schema: {
        body: {
          type: "object", additionalProperties: false,
          required: ["email", "pin"],
          properties: {
            email: { type: "string", minLength: 6, maxLength: 320 },
            pin: { type: "string", pattern: "^[0-9]{6}$" },
          },
        },
      },
    }, async (request, reply) => {
      await emailAuth.verify(request.body.email, request.body.pin);
      // The same response for every well-formed request prevents email enumeration.
      return reply.code(202).send({ status: "accepted" });
    });

    app.post<{ Body: EmailBody }>("/v1/auth/password-reset/request", {
      preHandler: [limited(rateLimit, "password-reset-request", 3, 900), limitedEmail(rateLimit, "password-reset-request-email", 3, 900)],
      schema: { body: { type: "object", additionalProperties: false, required: ["email"], properties: { email: { type: "string", minLength: 6, maxLength: 320 } } } },
    }, async (request, reply) => {
      const result = await emailAuth.requestPasswordReset(request.body.email);
      if (result === "invalid_request") return reply.code(400).send({ error: "invalid_request" });
      return reply.code(202).send({ status: "accepted" });
    });

    app.post<{ Body: PasswordResetBody }>("/v1/auth/password-reset/confirm", {
      preHandler: [limited(rateLimit, "password-reset-confirm", 10, 60), limitedEmail(rateLimit, "password-reset-confirm-email", 10, 300)],
      schema: {
        body: {
          type: "object", additionalProperties: false, required: ["email", "pin", "password"],
          properties: {
            email: { type: "string", minLength: 6, maxLength: 320 },
            pin: { type: "string", pattern: "^[0-9]{6}$" },
            password: { type: "string", minLength: 12, maxLength: 128 },
          },
        },
      },
    }, async (request, reply) => {
      const result = await emailAuth.confirmPasswordReset(request.body.email, request.body.pin, request.body.password);
      if (result === "invalid_request") return reply.code(400).send({ error: "invalid_request" });
      // Same response for a missing account, incorrect/expired PIN and a successful reset.
      return reply.code(202).send({ status: "accepted" });
    });
  }

  app.get("/v1/preferences/current", { preHandler: limited(rateLimit, "preferences-read", 120, 60) }, async (request, reply) => {
    const accountId = await dependencies.authenticate(request.headers.authorization);
    if (!accountId) return reply.code(401).send({ error: "unauthorized" });
    const record = await dependencies.store.get(accountId);
    reply.header("ETag", `"${record.revision}"`);
    return record;
  });

  app.put("/v1/preferences/current", { preHandler: limited(rateLimit, "preferences-write", 30, 60) }, async (request, reply) => {
    const accountId = await dependencies.authenticate(request.headers.authorization);
    if (!accountId) return reply.code(401).send({ error: "unauthorized" });

    const expectedRevision = parseRevision(request.headers["if-match"]);
    const idempotencyKey = request.headers["idempotency-key"];
    if (expectedRevision === null) return reply.code(428).send({ error: "if_match_required" });
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return reply.code(400).send({ error: "invalid_idempotency_key" });
    }
    if (!validateSnapshot(request.body)) return reply.code(400).send({ error: "invalid_snapshot" });
    const snapshot = request.body as PreferenceSnapshot;
    if (!isSemanticallyValid(snapshot)) return reply.code(400).send({ error: "invalid_snapshot" });

    const result = await dependencies.store.put(accountId, expectedRevision, idempotencyKey, snapshot);
    if (result.kind === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    if (result.kind === "conflict") {
      reply.header("ETag", `"${result.revision}"`);
      return reply.code(412).send({ error: "revision_conflict", revision: result.revision });
    }
    if (result.kind === "idempotency_key_reused") return reply.code(409).send({ error: "idempotency_key_reused" });
    reply.header("ETag", `"${result.revision}"`);
    return reply.code(200).send({ snapshot: result.snapshot, revision: result.revision });
  });

  app.get<{ Querystring: { before?: string; limit?: string } }>("/v1/preferences/history", { preHandler: limited(rateLimit, "preferences-history-read", 60, 60) }, async (request, reply) => {
    const accountId = await dependencies.authenticate(request.headers.authorization);
    if (!accountId) return reply.code(401).send({ error: "unauthorized" });
    const before = request.query.before === undefined ? undefined : parsePathRevision(request.query.before);
    const limit = request.query.limit === undefined ? 25 : Number(request.query.limit);
    if ((request.query.before !== undefined && before === null) || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      return reply.code(400).send({ error: "invalid_history_query" });
    }
    const entries = await dependencies.store.listHistory(accountId, before ?? undefined, limit);
    return { entries, nextBefore: entries.length === limit ? entries.at(-1)?.revision ?? null : null };
  });

  app.delete<{ Params: { revision: string } }>("/v1/preferences/history/:revision", { preHandler: limited(rateLimit, "preferences-history-delete", 20, 60) }, async (request, reply) => {
    const accountId = await dependencies.authenticate(request.headers.authorization);
    if (!accountId) return reply.code(401).send({ error: "unauthorized" });
    const revision = parsePathRevision(request.params.revision);
    if (revision === null) return reply.code(400).send({ error: "invalid_revision" });
    const deleted = await dependencies.store.deleteHistory(accountId, revision);
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: "history_not_found" });
  });

  app.post<{ Params: { revision: string } }>("/v1/preferences/history/:revision/restore", { preHandler: limited(rateLimit, "preferences-history-restore", 15, 60) }, async (request, reply) => {
    const accountId = await dependencies.authenticate(request.headers.authorization);
    if (!accountId) return reply.code(401).send({ error: "unauthorized" });
    const revision = parsePathRevision(request.params.revision);
    const expectedRevision = parseRevision(request.headers["if-match"]);
    const idempotencyKey = request.headers["idempotency-key"];
    if (revision === null) return reply.code(400).send({ error: "invalid_revision" });
    if (expectedRevision === null) return reply.code(428).send({ error: "if_match_required" });
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return reply.code(400).send({ error: "invalid_idempotency_key" });
    }
    const historical = await dependencies.store.getHistory(accountId, revision);
    if (!historical?.snapshot) return reply.code(404).send({ error: "history_not_found" });
    const result = await dependencies.store.put(accountId, expectedRevision, idempotencyKey, historical.snapshot);
    if (result.kind === "unauthorized") return reply.code(401).send({ error: "unauthorized" });
    if (result.kind === "conflict") {
      reply.header("ETag", `"${result.revision}"`);
      return reply.code(412).send({ error: "revision_conflict", revision: result.revision });
    }
    if (result.kind === "idempotency_key_reused") return reply.code(409).send({ error: "idempotency_key_reused" });
    reply.header("ETag", `"${result.revision}"`);
    return reply.code(200).send({ snapshot: result.snapshot, revision: result.revision });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Error && "statusCode" in error && (error as Error & { statusCode?: number }).statusCode === 413) {
      return reply.code(413).send({ error: "payload_too_large" });
    }
    if (error instanceof Error && "statusCode" in error && (error as Error & { statusCode?: number }).statusCode === 400) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    return reply.code(500).send({ error: "internal_error" });
  });

  return app;
}

function limited(limiter: RequestRateLimiter, scope: string, maximum: number, windowSeconds: number) {
  return async (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    const allowed = await limiter.consume(scope, request.ip, maximum, windowSeconds);
    if (allowed) return;
    reply.header("Retry-After", String(windowSeconds));
    return reply.code(429).send({ error: "rate_limited" });
  };
}

function limitedEmail(limiter: RequestRateLimiter, scope: string, maximum: number, windowSeconds: number) {
  return async (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    const emailInput = (request.body as { email?: unknown } | null)?.email;
    if (await emailLimitExceeded(limiter, scope, emailInput, maximum, windowSeconds, reply)) {
      return reply.send({ error: "rate_limited" });
    }
  };
}

async function emailLimitExceeded(
  limiter: RequestRateLimiter,
  scope: string,
  emailInput: unknown,
  maximum: number,
  windowSeconds: number,
  reply: FastifyReply,
): Promise<boolean> {
  const email = normalizeEmail(emailInput);
  if (!email) return false;
  const allowed = await limiter.consume(scope, email, maximum, windowSeconds);
  if (allowed) return false;
  reply.header("Retry-After", String(windowSeconds)).code(429);
  return true;
}

function parseRevision(header: string | undefined): number | null {
  const match = header?.match(/^"(0|[1-9][0-9]*)"$/);
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) ? revision : null;
}

function parsePathRevision(value: string): number | null {
  if (!/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) ? revision : null;
}

const nativeLoginSchema = formSchema({
  csrf: { type: "string", minLength: 43, maxLength: 43 },
  email: { type: "string", minLength: 6, maxLength: 320 },
  password: { type: "string", minLength: 12, maxLength: 128 },
}, ["csrf", "email", "password"]);
const nativeMfaLoginSchema = formSchema({
  csrf: { type: "string", minLength: 43, maxLength: 43 },
  email: { type: "string", minLength: 6, maxLength: 320 },
  proof: { type: "string", pattern: "^(?:[0-9]{6}|[A-Fa-f0-9]{4}(?:-[A-Fa-f0-9]{4}){3})$" },
}, ["csrf", "email", "proof"]);
const nativeRegisterSchema = formSchema({
  csrf: { type: "string", minLength: 43, maxLength: 43 },
  displayName: { type: "string", minLength: 1, maxLength: 80 },
  email: { type: "string", minLength: 6, maxLength: 320 },
  password: { type: "string", minLength: 12, maxLength: 128 },
}, ["csrf", "displayName", "email", "password"]);
const nativeEmailSchema = formSchema({
  csrf: { type: "string", minLength: 43, maxLength: 43 },
  email: { type: "string", minLength: 6, maxLength: 320 },
}, ["csrf", "email"]);
const nativePinSchema = formSchema({
  csrf: { type: "string", minLength: 43, maxLength: 43 },
  email: { type: "string", minLength: 6, maxLength: 320 },
  pin: { type: "string", pattern: "^[0-9]{6}$" },
}, ["csrf", "email", "pin"]);
const nativePasswordResetSchema = formSchema({
  csrf: { type: "string", minLength: 43, maxLength: 43 },
  email: { type: "string", minLength: 6, maxLength: 320 },
  pin: { type: "string", pattern: "^[0-9]{6}$" },
  password: { type: "string", minLength: 12, maxLength: 128 },
}, ["csrf", "email", "pin", "password"]);

function formSchema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", additionalProperties: false, required, properties };
}

function renderAuthPage(csrfToken: string, notice = "", passkeysEnabled = false, googleEnabled = false): string {
  const csrf = escapeHtml(csrfToken);
  const safeNotice = escapeHtml(notice);
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acceso a Laural</title><link rel="stylesheet" href="/auth.css"></head>
<body><div class="shell"><header class="brand"><div class="mark" aria-hidden="true">L</div><div><div class="brand-name">Laural</div><div class="brand-caption">Cuenta y sincronización</div></div></header>
<main><h1>Inicia sesión en Laural</h1><p class="intro">Usa tu cuenta para continuar. La contraseña se introduce únicamente en esta página segura del navegador.</p>
<p class="notice" role="status">${safeNotice}</p>
${googleEnabled ? `<form action="/auth/native/google/start" method="post"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">Continuar con Google</button></form>` : ""}
${passkeysEnabled ? `<p class="notice" role="status" data-passkey-notice></p><button type="button" data-passkey-login>Iniciar sesión con passkey</button>
<form action="/auth/native/login/mfa" method="post" data-passkey-mfa hidden><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="username" required maxlength="320"></label>
<label>Código TOTP o de recuperación<input name="proof" autocomplete="one-time-code" required maxlength="19"></label><button type="submit">Verificar y continuar</button></form>` : ""}
<form action="/auth/native/login" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="username" required maxlength="320"></label>
<label>Contraseña<input name="password" type="password" autocomplete="current-password" required minlength="12" maxlength="128"></label>
<button type="submit">Iniciar sesión</button></form>
<details><summary>Restablecer contraseña</summary><p>El PIN permite cambiar la contraseña, pero no inicia sesión ni elimina passkeys o MFA. Después tendrás que iniciar sesión normalmente.</p>
<form action="/auth/native/password-reset/request" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="320"></label><button type="submit">Enviar PIN de recuperación</button></form>
<form action="/auth/native/password-reset/confirm" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="320"></label>
<label>PIN de seis dígitos<input name="pin" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label>
<label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label>
<button type="submit">Cambiar contraseña</button></form></details>
<details><summary>Crear una cuenta</summary><form action="/auth/native/register" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Nombre<input name="displayName" autocomplete="name" required minlength="1" maxlength="80"></label>
<label>Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="320"></label>
<label>Contraseña (mínimo 12 caracteres)<input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label>
<button type="submit">Crear cuenta y enviar PIN</button></form></details>
<details><summary>Verificar correo o reenviar PIN</summary><form action="/auth/native/verification/confirm" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="320"></label>
<label>PIN de seis dígitos<input name="pin" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label>
<button type="submit">Verificar correo</button></form>
<form action="/auth/native/verification/resend" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="320"></label>
<button type="submit">Reenviar PIN</button></form></details>
<p class="privacy">El PIN solo verifica el correo o permite cambiar la contraseña. No inicia sesión ni elimina passkeys o MFA. Las claves de tus proveedores no forman parte de esta cuenta.</p>
</main><footer>Laural · Acceso seguro desde navegador externo</footer>${passkeysEnabled ? '<script type="module" src="/auth/passkeys.js"></script>' : ""}</div></body></html>`;
}

function renderMfaPage(csrfToken: string, email: string, notice = ""): string {
  const csrf = escapeHtml(csrfToken);
  const safeEmail = escapeHtml(email);
  const safeNotice = escapeHtml(notice);
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verificación de seguridad · Laural</title><link rel="stylesheet" href="/auth.css"></head>
<body><div class="shell"><header class="brand"><div class="mark" aria-hidden="true">L</div><div><div class="brand-name">Laural</div><div class="brand-caption">Cuenta y sincronización</div></div></header>
<main><h1>Verifica tu identidad</h1><p class="intro">Introduce el código de tu aplicación autenticadora o uno de tus códigos de recuperación.</p>
<p class="notice" role="status">${safeNotice}</p>
<form action="/auth/native/login/mfa" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="username" required maxlength="320" value="${safeEmail}"></label>
<label>Código de autenticación o recuperación<input name="proof" inputmode="text" autocomplete="one-time-code" required maxlength="19" autofocus></label>
<button type="submit">Verificar y continuar</button></form>
<p class="privacy">Un código de recuperación se invalida al usarlo. El PIN de correo no sustituye este factor.</p>
</main><footer>Laural · Acceso seguro desde navegador externo</footer></div></body></html>`;
}

function redirectNativeLogin(reply: FastifyReply, result: Extract<LoginResult, { kind: "authorized" }>): FastifyReply {
  reply.header("Set-Cookie", expiredFlowCookie());
  return reply.code(303).header("Location", nativeLoginUrl(result)).send();
}

function nativeLoginUrl(result: Extract<LoginResult, { kind: "authorized" }>): string {
  const callback = new URL(result.redirectUri);
  callback.searchParams.set("code", result.code);
  callback.searchParams.set("state", result.state);
  return callback.href;
}

function passkeySessionCookie(token: string): string {
  return `${PASSKEY_SESSION_COOKIE}=${token}; Path=/; Max-Age=300; Secure; HttpOnly; SameSite=Strict`;
}

function passkeyCsrfCookie(token: string): string {
  return `${PASSKEY_CSRF_COOKIE}=${token}; Path=/; Max-Age=300; Secure; SameSite=Strict`;
}

function renderPasskeyBootstrapPage(): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Acceso seguro · Laural</title><link rel="stylesheet" href="/auth.css"></head><body><div class="shell"><main><h1>Gestión segura de passkeys</h1><p class="intro" data-passkey-bootstrap-notice>Validando el enlace de un solo uso…</p></main><footer>Laural · Gestión de passkeys</footer><script type="module" src="/auth/passkeys.js"></script></div></body></html>`;
}

function renderPasskeyManagementPage(csrfToken: string, passkeys: PasskeySummary[]): string {
  const csrf = escapeHtml(csrfToken);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Passkeys · Laural</title><link rel="stylesheet" href="/auth.css"></head><body><div class="shell"><header class="brand"><div class="mark" aria-hidden="true">L</div><div><div class="brand-name">Laural</div><div class="brand-caption">Seguridad de la cuenta</div></div></header><main><h1>Passkeys</h1><p class="intro">Añade una passkey para iniciar sesión sin contraseña. Si TOTP está activo, también tendrás que confirmarlo.</p><input type="hidden" name="csrf" value="${csrf}"><div data-passkey-management><label>Nombre para identificarla<input data-passkey-name maxlength="80" autocomplete="off" placeholder="Ej.: portátil personal"></label><button type="button" data-passkey-create>Añadir passkey</button><p class="notice" role="status" aria-live="polite" data-passkey-management-notice></p><div data-passkey-list>${passkeys.map((item) => `<div class="passkey-row"><span>${escapeHtml(item.name)} · añadida ${escapeHtml(new Date(item.createdAt).toLocaleDateString("es-ES"))}</span><button type="button" data-initial-passkey-id="${escapeHtml(item.id)}">Eliminar</button></div>`).join("")}</div></div><p class="privacy">La passkey permite iniciar sesión. No sustituye TOTP si está activado.</p></main><footer>Laural · Gestión de passkeys</footer><script type="module" src="/auth/passkeys.js"></script></div></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

function flowCookie(token: string): string {
  return `${FLOW_COOKIE}=${token}; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Strict`;
}

function expiredFlowCookie(): string {
  return `${FLOW_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}

function isSemanticallyValid(snapshot: PreferenceSnapshot): boolean {
  const ids = new Set<string>();
  for (const provider of snapshot.providers) {
    if (ids.has(provider.id)) return false;
    ids.add(provider.id);
    if (provider.customEndpoint !== undefined && !isAllowedEndpoint(provider.customEndpoint)) return false;
  }
  return snapshot.activeProviderId === null || ids.has(snapshot.activeProviderId);
}

function isAllowedEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return false;
    if (endpoint.protocol === "https:") return true;
    return endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  } catch {
    return false;
  }
}

export function snapshotDigest(snapshot: PreferenceSnapshot): string {
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
