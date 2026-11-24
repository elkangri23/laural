import { describe, expect, it } from "vitest";
import { buildNextStatus, isValidStatus } from "../scripts/watch-status.mjs";

const operational = {
  state: "operational",
  summary: "Servicio de sincronización en funcionamiento. Registro abierto.",
  updatedAt: "2026-11-24T07:55:19Z",
  components: [
    { id: "api", state: "operational", summary: "API en funcionamiento." },
    { id: "sync", state: "operational", summary: "Sincronización de preferencias activa." },
    { id: "email", state: "operational", summary: "Correo de verificación configurado con Resend." },
  ],
  notices: [],
};

const notice = {
  kind: "incident",
  title: "Incidencia",
  message: "Estamos revisando un problema.",
  updatedAt: "2026-11-24T10:00:00Z",
};

describe("watch-status", () => {
  it("no republica cuando todo sigue operativo", () => {
    const result = buildNextStatus(operational, { kind: "operational" });
    expect(result.changed).toBe(false);
    expect(result.status).toBe(operational);
  });

  it("publica degradado cuando la API responde pero no está lista", () => {
    const current = { ...operational, notices: [notice] };
    const result = buildNextStatus(current, { kind: "degraded", reason: "ready" });
    expect(result.changed).toBe(true);
    expect(result.status.state).toBe("degraded");
    expect(result.status.summary).toContain("problemas");
    expect(result.status.components.find((c) => c.id === "email")).toEqual(
      operational.components[2],
    );
    expect(result.status.notices).toEqual([notice]);
  });

  it("publica degradado cuando la API no responde", () => {
    const result = buildNextStatus(operational, { kind: "down" });
    expect(result.changed).toBe(true);
    expect(result.status.state).toBe("degraded");
    expect(result.status.summary).toContain("no responde");
    expect(result.status.components.find((c) => c.id === "api")?.summary).toBe("La API no responde.");
  });

  it("recupera a operativo cuando la API vuelve", () => {
    const degraded = buildNextStatus(operational, { kind: "down" }).status;
    const result = buildNextStatus(degraded, { kind: "operational" });
    expect(result.changed).toBe(true);
    expect(result.status.state).toBe("operational");
    expect(result.status.summary).toBe(operational.summary);
  });

  it("no toca el estado de mantenimiento", () => {
    const current = { ...operational, state: "maintenance", summary: "Mantenimiento programado." };
    const result = buildNextStatus(current, { kind: "down" });
    expect(result.changed).toBe(false);
    expect(result.status).toBe(current);
  });

  it("reconstruye el documento cuando el fichero actual no es válido", () => {
    const result = buildNextStatus(null, { kind: "operational" });
    expect(result.changed).toBe(true);
    expect(result.status.state).toBe("operational");
    expect(result.status.components.find((c) => c.id === "email")?.state).toBe("unknown");
    expect(result.status.notices).toEqual([]);
  });

  it("valida el documento con las reglas del esquema", () => {
    expect(isValidStatus(operational)).toBe(true);
    expect(isValidStatus({ ...operational, state: "caído" })).toBe(false);
    expect(isValidStatus({ ...operational, components: operational.components.slice(0, 2) })).toBe(false);
    expect(isValidStatus({ ...operational, summary: "x".repeat(241) })).toBe(false);
    expect(isValidStatus({ ...operational, extra: true })).toBe(false);
    expect(isValidStatus({ ...operational, updatedAt: "ayer" })).toBe(false);
    expect(isValidStatus({ ...operational, notices: [{ ...notice, kind: "aviso" }] })).toBe(false);
  });
});
