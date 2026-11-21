import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { PreferenceSnapshot, PreferenceStore, ReadinessCheck, Authenticate } from "./contracts.js";
import type { EmailAuthService } from "./email-auth.js";
import snapshotSchema from "../../shared/preference-snapshot-v1.schema.json" with { type: "json" };

const BODY_LIMIT = 256 * 1024;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSnapshot = ajv.compile<PreferenceSnapshot>(snapshotSchema);

export type AppDependencies = {
  store: PreferenceStore;
  authenticate: Authenticate;
  checkReadiness: ReadinessCheck;
  emailAuth?: EmailAuthService;
};

type RegistrationBody = { displayName: string; email: string; password: string };
type EmailPinBody = { email: string; pin: string };
type EmailBody = { email: string };

export function createApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
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
  if (emailAuth) {
    app.post<{ Body: RegistrationBody }>("/v1/auth/register", {
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

  app.get("/v1/preferences/current", async (request, reply) => {
    const accountId = await dependencies.authenticate(request.headers.authorization);
    if (!accountId) return reply.code(401).send({ error: "unauthorized" });
    const record = await dependencies.store.get(accountId);
    reply.header("ETag", `"${record.revision}"`);
    return record;
  });

  app.put("/v1/preferences/current", async (request, reply) => {
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

function parseRevision(header: string | undefined): number | null {
  const match = header?.match(/^"(0|[1-9][0-9]*)"$/);
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) ? revision : null;
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
