import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { PreferenceSnapshot, PreferenceStore, ReadinessCheck, Authenticate, RevokeSession } from "./contracts.js";
import type { EmailAuthService } from "./email-auth.js";
import { NativeAuthService, validateNativeFlowParameters } from "./native-auth.js";
import type { RequestRateLimiter } from "./request-rate-limit.js";
import snapshotSchema from "../../shared/preference-snapshot-v1.schema.json" with { type: "json" };

const BODY_LIMIT = 256 * 1024;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSnapshot = ajv.compile<PreferenceSnapshot>(snapshotSchema);

export type AppDependencies = {
  store: PreferenceStore;
  authenticate: Authenticate;
  revokeSession: RevokeSession;
  checkReadiness: ReadinessCheck;
  emailAuth?: EmailAuthService;
  nativeAuth?: NativeAuthService;
  requestRateLimiter: RequestRateLimiter;
};

type RegistrationBody = { displayName: string; email: string; password: string };
type EmailPinBody = { email: string; pin: string };
type EmailBody = { email: string };
type NativeLoginBody = { csrf: string; email: string; password: string };
type NativeRegisterBody = RegistrationBody & { csrf: string };
type NativePinBody = EmailPinBody & { csrf: string };
type NativeEmailBody = EmailBody & { csrf: string };
type NativeStartQuery = { redirect_uri: string; state: string; code_challenge: string; code_challenge_method: "S256" };
type NativeExchangeBody = { code: string; codeVerifier: string };

const FLOW_COOKIE = "__Host-laural-flow";

export function createApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT, trustProxy: ["127.0.0.1", "::1"] });
  const rateLimit = dependencies.requestRateLimiter;

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Security-Policy", "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
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

  app.post("/v1/auth/session/revoke", { preHandler: limited(rateLimit, "session-revoke", 10, 60) }, async (request, reply) => {
    const authorization = request.headers.authorization;
    const accountId = await dependencies.authenticate(authorization);
    if (!accountId || !await dependencies.revokeSession(accountId, authorization)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.code(204).send();
  });

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
      return reply.type("text/html; charset=utf-8").send(renderAuthPage(credentials.csrfToken));
    });

    app.get("/auth.css", async (_request, reply) => {
      const stylesheet = await readFile(new URL("../web/auth.css", import.meta.url), "utf8");
      return reply.type("text/css; charset=utf-8").send(stylesheet);
    });

    app.post<{ Body: NativeLoginBody }>("/auth/native/login", {
      preHandler: limited(rateLimit, "native-login", 10, 60),
      schema: { body: nativeLoginSchema },
    }, async (request, reply) => {
      const cookieToken = readCookie(request.headers.cookie, FLOW_COOKIE);
      const result = await nativeAuth.login({
        cookieToken: cookieToken ?? "",
        csrfToken: request.body.csrf,
        email: request.body.email,
        password: request.body.password,
      });
      if (!result) return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "No se pudo iniciar sesión. Revisa los datos y que el correo esté verificado."));
      const callback = new URL(result.redirectUri);
      callback.searchParams.set("code", result.code);
      callback.searchParams.set("state", result.state);
      reply.header("Set-Cookie", expiredFlowCookie());
      return reply.code(303).header("Location", callback.href).send();
    });

    app.post<{ Body: NativeRegisterBody }>("/auth/native/register", {
      preHandler: limited(rateLimit, "native-register", 3, 900),
      schema: { body: nativeRegisterSchema },
    }, async (request, reply) => {
      if (!await nativeAuth.isBrowserFlowValid(readCookie(request.headers.cookie, FLOW_COOKIE), request.body.csrf)) {
        return reply.code(400).type("text/html; charset=utf-8").send(renderAuthPage("", "La sesión de autenticación caducó. Vuelve a iniciar el proceso en Laural."));
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
      await emailAuth.verify(request.body.email, request.body.pin);
      return reply.type("text/html; charset=utf-8").send(renderAuthPage(request.body.csrf, "Solicitud procesada. Si el PIN era correcto, ya puedes probar a iniciar sesión."));
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

  if (emailAuth) {
    app.post<{ Body: RegistrationBody }>("/v1/auth/register", {
      preHandler: limited(rateLimit, "api-register", 3, 900),
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
      preHandler: limited(rateLimit, "api-resend", 3, 900),
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
      preHandler: limited(rateLimit, "api-verify", 10, 60),
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

function parseRevision(header: string | undefined): number | null {
  const match = header?.match(/^"(0|[1-9][0-9]*)"$/);
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) ? revision : null;
}

const nativeLoginSchema = formSchema({
  csrf: { type: "string", minLength: 43, maxLength: 43 },
  email: { type: "string", minLength: 6, maxLength: 320 },
  password: { type: "string", minLength: 12, maxLength: 128 },
}, ["csrf", "email", "password"]);
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

function formSchema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", additionalProperties: false, required, properties };
}

function renderAuthPage(csrfToken: string, notice = ""): string {
  const csrf = escapeHtml(csrfToken);
  const safeNotice = escapeHtml(notice);
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acceso a Laural</title><link rel="stylesheet" href="/auth.css"></head>
<body><div class="shell"><header class="brand"><div class="mark" aria-hidden="true">L</div><div><div class="brand-name">Laural</div><div class="brand-caption">Cuenta y sincronización</div></div></header>
<main><h1>Inicia sesión en Laural</h1><p class="intro">Usa tu cuenta para continuar. La contraseña se introduce únicamente en esta página segura del navegador.</p>
<p class="notice" role="status">${safeNotice}</p>
<form action="/auth/native/login" method="post"><input type="hidden" name="csrf" value="${csrf}">
<label>Correo electrónico<input name="email" type="email" autocomplete="username" required maxlength="320"></label>
<label>Contraseña<input name="password" type="password" autocomplete="current-password" required minlength="12" maxlength="128"></label>
<button type="submit">Iniciar sesión</button></form>
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
<p class="privacy">El PIN solo verifica el correo. No inicia sesión ni elimina passkeys o MFA. Las claves de tus proveedores no forman parte de esta cuenta.</p>
</main><footer>Laural · Acceso seguro desde navegador externo</footer></div></body></html>`;
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
