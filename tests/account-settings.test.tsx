// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AccountSettings } from "../src/components/AccountSettings";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listenFails: false, onStatus: undefined as ((event: { payload: { status: string; message: string } }) => void) | undefined }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, callback: typeof mocks.onStatus) => {
    if (mocks.listenFails) throw new Error("listener unavailable");
    mocks.onStatus = callback ?? undefined;
    return () => { mocks.onStatus = undefined; };
  },
}));
vi.mock("../src/components/SettingsDialog", () => ({
  SettingsDialog: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
}));

let host: HTMLDivElement;
let root: Root;
const preferences = { themeId: "laurel", appearance: "dark" as const, updateMode: "manual" as const };
const renderAccountSettings = (onImported = vi.fn(), syncRiskAcknowledged = true, onAcknowledgeSyncRisk = vi.fn(() => true)) => <AccountSettings onClose={vi.fn()} preferences={preferences} onImported={onImported} onSyncSettled={vi.fn()} syncRiskAcknowledged={syncRiskAcknowledged} onAcknowledgeSyncRisk={onAcknowledgeSyncRisk} />;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.onStatus = undefined;
  mocks.listenFails = false;
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "account_session_status") return false;
    return undefined;
  });
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

test("inicia login en navegador y muestra el resultado de la sesión", async () => {
  await act(async () => root.render(renderAccountSettings()));
  const login = host.querySelector("button");
  expect(login?.textContent).toBe("Iniciar sesión");

  await act(async () => login?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("start_account_login");

  await act(async () => mocks.onStatus?.({ payload: { status: "waiting", message: "Completa el acceso en el navegador." } }));
  expect(host.querySelector("button")?.textContent).toBe("Esperando en el navegador…");
  await act(async () => mocks.onStatus?.({ payload: { status: "signed_in", message: "Sesión iniciada correctamente." } }));
  expect(host.textContent).toContain("Sesión iniciada correctamente.");
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toContain("Quitar cuenta de este equipo");
});

test("muestra sesiones activas y pide confirmación para revocar otra", async () => {
  const otherId = "d5363ea7-f6cb-4cca-8e03-85aa33089e7a";
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [
      { id: "d5363ea7-f6cb-4cca-8e03-85aa33089e7b", createdAt: "2026-11-21T10:00:00.000Z", expiresAt: "2026-12-21T10:00:00.000Z", current: true },
      { id: otherId, createdAt: "2026-11-20T10:00:00.000Z", expiresAt: "2026-12-20T10:00:00.000Z", current: false },
    ];
    if (command === "revoke_account_session") return true;
    return undefined;
  });
  vi.stubGlobal("confirm", vi.fn(() => true));
  await act(async () => root.render(renderAccountSettings()));
  expect(host.textContent).toContain("Este equipo");
  expect(host.textContent).toContain("Otro inicio de sesión");
  const revoke = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Revocar");
  await act(async () => revoke?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("revoke_account_session", { sessionId: otherId });
  expect(host.textContent).toContain("Sesión revocada");
  expect(host.textContent).not.toContain("Otro inicio de sesión");
});

test("revoca las demás sesiones sin desconectar este equipo", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [{ id: "d5363ea7-f6cb-4cca-8e03-85aa33089e7b", createdAt: "2026-11-21T10:00:00.000Z", expiresAt: "2026-12-21T10:00:00.000Z", current: true }];
    if (command === "revoke_other_account_sessions") return 4;
    return undefined;
  });
  vi.stubGlobal("confirm", vi.fn(() => true));
  await act(async () => root.render(renderAccountSettings()));
  const revokeAll = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Revocar las demás sesiones");
  await act(async () => revokeAll?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("revoke_other_account_sessions");
  expect(host.textContent).toContain("Se revocaron 4 sesiones");
  expect(host.textContent).toContain("Este equipo sigue conectado");
});

test("presenta errores de navegador y del almacén local", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return false;
    if (command === "start_account_login") throw new Error("browser unavailable");
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => host.querySelector<HTMLButtonElement>('button')?.click());
  expect(host.textContent).toContain("No se pudo abrir el navegador");

  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "clear_account_session") throw new Error("credential store unavailable");
    return undefined;
  });
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Quitar cuenta de este equipo")?.click());
  expect(host.textContent).toContain("No se pudo quitar la sesión");
});

test("informa si falla la lectura del almacén seguro", async () => {
  mocks.invoke.mockRejectedValue(new Error("credential store unavailable"));
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  expect(host.textContent).toContain("No se pudo consultar el almacén seguro de Windows");
});

test("informa si no se puede escuchar el resultado del login", async () => {
  mocks.invoke.mockReturnValue(new Promise(() => undefined));
  mocks.listenFails = true;
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  expect(host.textContent).toContain("No se pudo escuchar el resultado");
});

test("cierra sesión local e informa si no puede confirmar la revocación remota", async () => {
  mocks.invoke.mockImplementation(async (command: string) => command === "account_session_status");
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Quitar cuenta de este equipo")?.click());

  expect(mocks.invoke).toHaveBeenCalledWith("clear_account_session");
  expect(host.textContent).toContain("No se pudo confirmar la revocación remota");
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toContain("Iniciar sesión");
});

test("confirma el cierre remoto cuando el servidor revoca la sesión", async () => {
  mocks.invoke.mockImplementation(async (command: string) => command === "account_session_status" ? true : command === "clear_account_session");
  const disconnected = vi.fn();
  window.addEventListener("laural:account-disconnected", disconnected);
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Quitar cuenta de este equipo")?.click());

  expect(host.textContent).toContain("el servidor confirmó que ya no es válida");
  expect(disconnected).toHaveBeenCalledOnce();
  window.removeEventListener("laural:account-disconnected", disconnected);
});

test("el borrado de cuenta exige la frase exacta y conserva las preferencias locales", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled: false, recoveryCodesRemaining: 0, enrollmentPending: false };
    if (command === "delete_account") return { sessionCredentialCleared: true, syncStateCleared: true };
    return undefined;
  });
  vi.stubGlobal("confirm", vi.fn(() => true));
  const disconnected = vi.fn();
  window.addEventListener("laural:account-disconnected", disconnected);
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  expect(host.textContent).toContain("No elimina la configuración ni las claves guardadas en este equipo");
  const deleteButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Eliminar definitivamente mi cuenta");
  expect(deleteButton?.disabled).toBe(true);

  const input = host.querySelector<HTMLInputElement>(".account-delete input");
  await act(async () => {
    if (input) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "ELIMINAR");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  expect(deleteButton?.disabled).toBe(false);
  await act(async () => deleteButton?.click());

  expect(mocks.invoke).toHaveBeenCalledWith("delete_account", { confirmation: "ELIMINAR" });
  expect(host.textContent).toContain("La cuenta y sus datos sincronizados se borraron");
  expect(disconnected).toHaveBeenCalledOnce();
  window.removeEventListener("laural:account-disconnected", disconnected);
});

test("permite reintentar la limpieza local después de borrar la cuenta", async () => {
  let deletionAttempted = false;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled: false, recoveryCodesRemaining: 0, enrollmentPending: false };
    if (command === "delete_account") return { sessionCredentialCleared: false, syncStateCleared: false };
    if (command === "clear_deleted_account_local_data") {
      expect(deletionAttempted).toBe(true);
      return { sessionCredentialCleared: true, syncStateCleared: true };
    }
    return undefined;
  });
  vi.stubGlobal("confirm", vi.fn(() => true));
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  const input = host.querySelector<HTMLInputElement>(".account-delete input");
  await act(async () => {
    if (input) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "ELIMINAR");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await act(async () => {
    [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Eliminar definitivamente mi cuenta")?.click();
  });
  deletionAttempted = true;
  expect(host.textContent).toContain("puedes volver a intentarlo aquí");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Reintentar limpieza local")?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("clear_deleted_account_local_data");
  expect(host.textContent).toContain("Limpieza local completada");
});

test("activa TOTP solo después de verificar el código y confirmar que guardó la recuperación", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled: false, recoveryCodesRemaining: 0, enrollmentPending: false };
    if (command === "start_totp_enrollment") return { secret: "JBSWY3DPEHPK3PXP", provisioningUri: "otpauth://totp/Laural:test?secret=JBSWY3DPEHPK3PXP" };
    if (command === "confirm_totp_enrollment") return ["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"];
    if (command === "complete_totp_enrollment") return undefined;
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Configurar TOTP")?.click());
  expect(host.querySelectorAll<HTMLInputElement>("input[readonly]")[1]?.value).toBe("JBSWY3DPEHPK3PXP");
  const codeInput = host.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]');
  await act(async () => {
    if (codeInput) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(codeInput, "123456");
      codeInput.dispatchEvent(new Event("input", { bubbles: true }));
      codeInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Verificar y mostrar códigos")?.click());
  expect(host.textContent).toContain("AAAA-BBBB-CCCC-DDDD");
  expect(mocks.invoke).toHaveBeenCalledWith("confirm_totp_enrollment", { code: "123456" });
  const activate = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Confirmar y activar TOTP");
  expect(activate?.disabled).toBe(true);
  const checkbox = host.querySelector<HTMLInputElement>('.account-recovery-confirm input');
  await act(async () => { if (checkbox) checkbox.click(); });
  await act(async () => activate?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("complete_totp_enrollment");
});

test("mantiene los códigos antiguos durante la rotación y confirma antes de activarlos", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled: true, recoveryCodesRemaining: 4, enrollmentPending: false };
    if (command === "rotate_account_recovery_codes") return ["1111-2222-3333-4444", "5555-6666-7777-8888"];
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Renovar códigos de recuperación")?.click());
  expect(host.textContent).toContain("Los anteriores siguen activos hasta que confirmes");
  expect(host.textContent).toContain("1111-2222-3333-4444");
  const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Confirmar y renovar");
  expect(confirm?.disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('.account-recovery-confirm input')?.click());
  await act(async () => confirm?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("complete_totp_enrollment");
  expect(host.textContent).toContain("Códigos renovados");
});

test("permite cancelar un enrolamiento pendiente y presenta errores de seguridad", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled: false, recoveryCodesRemaining: 0, enrollmentPending: true };
    if (command === "cancel_totp_enrollment") return undefined;
    if (command === "start_totp_enrollment") throw new Error("recent session required");
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  expect(host.textContent).toContain("Hay una configuración pendiente");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancelar configuración pendiente")?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("cancel_totp_enrollment");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Reiniciar configuración")?.click());
  expect(host.textContent).toContain("No se pudo iniciar TOTP");
});

test("compara el snapshot y ofrece elección sin revelar los cambios", async () => {
  const local = { schemaVersion: 1, preferences, activeProviderId: "local", providers: [{ id: "local", kind: "ollama", name: "Ollama", model: "qwen", customEndpoint: undefined }] };
  const cloud = { ...local, preferences: { ...preferences, themeId: "ocean" } };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_preference_snapshot") return local;
    if (command === "read_remote_preferences") return { snapshot: cloud, revision: 7 };
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => host.querySelector<HTMLButtonElement>("button")?.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.click());
  expect(host.textContent).toContain("no coincide");
  expect(host.textContent).not.toContain("ocean");
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toContain("Usar este equipo");
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toContain("Usar la nube");
});

test("bloquea la sincronización hasta aceptar el riesgo del VPS", async () => {
  const onAcknowledge = vi.fn(() => true);
  mocks.invoke.mockImplementation(async (command: string) => command === "account_session_status");
  await act(async () => root.render(renderAccountSettings(vi.fn(), false, onAcknowledge)));

  expect(host.textContent).toContain("una pérdida total del VPS puede borrar tus datos sincronizados");
  expect(host.textContent).toContain("no hay cifrado de extremo a extremo");
  const syncButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora");
  expect(syncButton?.disabled).toBe(true);
  await act(async () => syncButton?.click());
  expect(mocks.invoke).not.toHaveBeenCalledWith("read_remote_preferences");

  const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
  await act(async () => { if (checkbox) checkbox.click(); });
  const acceptButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Aceptar riesgo y habilitar sincronización");
  expect(acceptButton?.disabled).toBe(false);
  await act(async () => acceptButton?.click());
  expect(onAcknowledge).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Riesgo revisado en este equipo");
  expect([...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.disabled).toBe(false);
});

test("aplica la configuración cloud mediante Rust y comunica la copia local", async () => {
  const snapshot = { schemaVersion: 1, preferences, activeProviderId: null, providers: [] };
  const imported = { preferences, activeProvider: null, providers: [], backupPath: "C:/Laural/transfer-backups/configuracion.laural", backupEncrypted: false, backupContainsApiKeys: false };
  const onImported = vi.fn();
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_preference_snapshot") return snapshot;
    if (command === "read_remote_preferences") return { snapshot: { ...snapshot, preferences: { ...preferences, themeId: "ocean" } }, revision: 3 };
    if (command === "apply_remote_preference_snapshot") return imported;
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings(onImported)));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Usar la nube")?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("apply_remote_preference_snapshot", expect.objectContaining({ snapshot: expect.objectContaining({ preferences: expect.objectContaining({ themeId: "ocean" }) }) }));
  expect(onImported).toHaveBeenCalledWith(imported);
  expect(host.textContent).toContain(imported.backupPath);
});
