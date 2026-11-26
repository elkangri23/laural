// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AccountSettings } from "../src/components/AccountSettings";
import { LanguageProvider } from "../src/i18n";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenFails: false,
  onStatus: undefined as ((event: { payload: { status: string; message: string } }) => void) | undefined,
  listenImplementation: undefined as (((callback: typeof mocks.onStatus) => Promise<() => void>) | undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_event: string, callback: typeof mocks.onStatus) => {
    if (mocks.listenFails) return Promise.reject(new Error("listener unavailable"));
    if (mocks.listenImplementation) return mocks.listenImplementation(callback);
    mocks.onStatus = callback ?? undefined;
    return Promise.resolve(() => { mocks.onStatus = undefined; });
  },
}));
vi.mock("../src/components/ModalShell", () => ({
  ModalShell: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
}));

let host: HTMLDivElement;
let root: Root;
const preferences = { themeId: "laurel", appearance: "dark" as const, updateMode: "manual" as const, language: "es" as const };
const renderAccountSettings = (onImported = vi.fn(), syncRiskAcknowledged = true, onAcknowledgeSyncRisk = vi.fn(() => true)) => <LanguageProvider><AccountSettings onClose={vi.fn()} preferences={preferences} onImported={onImported} onSyncSettled={vi.fn()} syncRiskAcknowledged={syncRiskAcknowledged} onAcknowledgeSyncRisk={onAcknowledgeSyncRisk} /></LanguageProvider>;

beforeEach(() => {
  localStorage.setItem("laural.language.v1", "es");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.onStatus = undefined;
  mocks.listenFails = false;
  mocks.listenImplementation = undefined;
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "account_session_status") return false;
    return undefined;
  });
  host = document.createElement("div");
  root = createRoot(host);
});

test("localiza la interfaz de cuenta al inglés y conserva mensajes libres del servicio en español", async () => {
  localStorage.setItem("laural.language.v1", "en");
  await act(async () => root.render(renderAccountSettings()));
  expect(host.textContent).toContain("Account and sync");
  expect(host.textContent).toContain("Before syncing");
  expect(host.textContent).toContain("Sign in");
  expect(host.textContent).toContain("No account is connected.");

  await act(async () => mocks.onStatus?.({ payload: { status: "waiting", message: "Completa el acceso en el navegador." } }));
  expect(host.textContent).toContain("Completa el acceso en el navegador.");
});

test("localiza sesiones, passkeys y MFA en la vista de cuenta conectada", async () => {
  localStorage.setItem("laural.language.v1", "en");
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_account_passkeys_enabled") return true;
    if (command === "get_account_mfa_status") return { totpEnabled: true, recoveryCodesRemaining: 3, enrollmentPending: false };
    if (command === "list_account_sessions") return [];
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  expect(host.textContent).toContain("Cloud preference history");
  expect(host.textContent).toContain("Active sessions");
  expect(host.textContent).toContain("Passkeys");
  expect(host.textContent).toContain("Manage passkeys in browser");
  expect(host.textContent).toContain("Two-step authentication");
  expect(host.textContent).toContain("3 codes available");
  expect(host.textContent).toContain("Delete account and synced data");
  expect(host.textContent).toContain("Type ELIMINAR to confirm");
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

test("muestra passkeys habilitadas y abre la gestión en el navegador", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_account_passkeys_enabled") return true;
    if (command === "start_passkey_management") return undefined;
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));

  const manage = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Gestionar passkeys en el navegador");
  expect(manage).toBeDefined();
  expect(host.textContent).toContain("Si TOTP está activo");
  await act(async () => manage?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("start_passkey_management");
  expect(host.textContent).toContain("Se abrió la gestión segura de passkeys");
});

test("oculta la gestión de passkeys cuando el servicio las mantiene desactivadas", async () => {
  mocks.invoke.mockImplementation(async (command: string) => command === "account_session_status" ? true : command === "get_account_passkeys_enabled" ? false : undefined);
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  expect(host.textContent).not.toContain("Gestionar passkeys en el navegador");
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
  let cleanupAttempts = 0;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled: false, recoveryCodesRemaining: 0, enrollmentPending: false };
    if (command === "delete_account") return { sessionCredentialCleared: false, syncStateCleared: false };
    if (command === "clear_deleted_account_local_data") {
      expect(deletionAttempted).toBe(true);
      cleanupAttempts += 1;
      if (cleanupAttempts === 1) return { sessionCredentialCleared: false, syncStateCleared: true };
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
  expect(host.textContent).toContain("Aún queda algún dato local pendiente de limpieza");
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
  const local = { schemaVersion: 1, preferences, activeProviderId: "local", providers: [{ id: "local", kind: "ollama", name: "Ollama", model: "qwen", customEndpoint: undefined }, { id: "other", kind: "lmstudio", name: "LM Studio", model: "llama", customEndpoint: undefined }] };
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

test("consulta, restaura como nueva revisión y elimina versiones cloud", async () => {
  const snapshot = { schemaVersion: 1, preferences, activeProviderId: null, providers: [] };
  const imported = { preferences, activeProvider: null, providers: [], backupPath: "C:/Laural/backup.laural", backupEncrypted: false, backupContainsApiKeys: false };
  vi.stubGlobal("confirm", vi.fn(() => true));
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "read_remote_preference_history") return { entries: [{ revision: 4, createdAt: "2026-11-22T12:00:00.000Z" }], nextBefore: null };
    if (command === "read_remote_preferences") return { snapshot, revision: 7 };
    if (command === "restore_remote_preference_history") return { snapshot, revision: 8 };
    if (command === "apply_remote_preference_snapshot") return imported;
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  const history = host.querySelector<HTMLElement>("[aria-labelledby='preference-history-title']");
  await act(async () => history?.querySelector<HTMLButtonElement>("button")?.click());
  expect(host.textContent).toContain("Versión 4");
  await act(async () => [...(history?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent === "Restaurar")?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("restore_remote_preference_history", { revision: 4, currentRevision: 7 });
  expect(mocks.invoke).toHaveBeenCalledWith("apply_remote_preference_snapshot", expect.objectContaining({ snapshot, revision: 8 }));
  expect(host.textContent).toContain("Versión 4 restaurada como revisión 8");

  await act(async () => [...(history?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent === "Eliminar")?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("delete_remote_preference_history", { revision: 4 });
  expect([...(history?.querySelectorAll("strong") ?? [])].map((item) => item.textContent)).not.toContain("Versión 4");
});

test("comunica fallos de lectura de sesiones, MFA y disponibilidad de passkeys", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return { invalid: true };
    if (command === "get_account_mfa_status") throw new Error("mfa unavailable");
    if (command === "get_account_passkeys_enabled") throw new Error("passkeys unavailable");
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  expect(host.textContent).toContain("No se pudo consultar la lista de sesiones");
  expect(host.textContent).toContain("No se pudo consultar la seguridad de la cuenta");
  expect(host.textContent).not.toContain("Gestionar passkeys en el navegador");
});

test("reacciona a una actualización del riesgo de sincronización", async () => {
  await act(async () => root.render(renderAccountSettings(vi.fn(), false)));
  expect(host.textContent).toContain("Entiendo que la pérdida total del VPS");
  await act(async () => root.render(<LanguageProvider><AccountSettings onClose={vi.fn()} preferences={preferences} onImported={vi.fn()} onSyncSettled={vi.fn()} syncRiskAcknowledged onAcknowledgeSyncRisk={() => true} /></LanguageProvider>));
  expect(host.textContent).toContain("Riesgo revisado en este equipo");
});

test("presenta los errores de gestión de passkeys según el tipo de error", async () => {
  let failure: unknown = new Error("WebAuthn unavailable");
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_account_passkeys_enabled") return true;
    if (command === "start_passkey_management") throw failure;
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  const manage = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Gestionar passkeys en el navegador");
  await act(async () => manage?.click());
  expect(host.textContent).toContain("No se pudo abrir la gestión de passkeys");
  failure = "Gestión bloqueada por el servicio";
  await act(async () => manage?.click());
  expect(host.textContent).toContain("Gestión bloqueada por el servicio");
});

test("muestra fallos al iniciar TOTP y al verificar un código", async () => {
  let enrollmentStarted = false;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled: false, recoveryCodesRemaining: 0, enrollmentPending: false };
    if (command === "start_totp_enrollment") {
      if (!enrollmentStarted) throw new Error("recent login required");
      return { secret: "JBSWY3DPEHPK3PXP", provisioningUri: "otpauth://totp/Laural:test" };
    }
    if (command === "confirm_totp_enrollment") throw "invalid TOTP";
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  const configure = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Configurar TOTP")?.click();
  await act(async () => configure());
  expect(host.textContent).toContain("No se pudo iniciar TOTP");
  enrollmentStarted = true;
  await act(async () => configure());
  const code = host.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(code, "123456");
    code.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Verificar y mostrar códigos")?.click());
  expect(host.textContent).toContain("El código no es válido");
});

test("trata los fallos de rotación, confirmación, copia y cancelación TOTP", async () => {
  let completeFails = true;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled: true, recoveryCodesRemaining: 3, enrollmentPending: false };
    if (command === "rotate_account_recovery_codes") return ["1111-2222-3333-4444"];
    if (command === "complete_totp_enrollment" && completeFails) throw new Error("completion unavailable");
    if (command === "cancel_totp_enrollment") throw new Error("cancel unavailable");
    return undefined;
  });
  const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("clipboard unavailable"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Renovar códigos de recuperación")?.click());
  await act(async () => host.querySelector<HTMLInputElement>('.account-recovery-confirm input')?.click());
  const click = async (label: string) => act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label)?.click());
  await click("Copiar códigos");
  expect(host.textContent).toContain("Códigos copiados");
  await click("Copiar códigos");
  expect(host.textContent).toContain("Selecciona y copia los códigos manualmente");
  await click("Confirmar y renovar");
  expect(host.textContent).toContain("No se pudo confirmar");
  completeFails = false;
  await click("Cancelar");
  expect(host.textContent).toContain("No se pudo cancelar el cambio de TOTP");
});

test("desactivar TOTP respeta la cancelación del usuario y comunica fallos", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled: true, recoveryCodesRemaining: 3, enrollmentPending: false };
    if (command === "disable_account_totp") throw new Error("recent login required");
    return undefined;
  });
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal("confirm", confirm);
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  const disable = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Desactivar TOTP")?.click();
  await act(async () => disable());
  expect(mocks.invoke).not.toHaveBeenCalledWith("disable_account_totp");
  await act(async () => disable());
  expect(host.textContent).toContain("No se pudo desactivar TOTP");
});

test("cancela el enrolamiento activo y permite volver a iniciar sesión desde la sección de borrado", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled: false, recoveryCodesRemaining: 0, enrollmentPending: false };
    if (command === "start_totp_enrollment") return { secret: "JBSWY3DPEHPK3PXP", provisioningUri: "otpauth://totp/Laural:test" };
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Configurar TOTP")?.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancelar")?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("cancel_totp_enrollment");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Volver a iniciar sesión")?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("start_account_login");
});

test("revisa la frase y la confirmación antes de eliminar la cuenta", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled: false, recoveryCodesRemaining: 0, enrollmentPending: false };
    return undefined;
  });
  vi.stubGlobal("confirm", vi.fn(() => false));
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  const deleteInput = host.querySelector<HTMLInputElement>(".account-delete input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(deleteInput, "ELIMINAR");
    deleteInput.dispatchEvent(new Event("input", { bubbles: true }));
    deleteInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Eliminar definitivamente mi cuenta")?.click());
  expect(mocks.invoke).not.toHaveBeenCalledWith("delete_account", expect.anything());
});

test("reconoce una configuración idéntica y detecta si cambió durante la comparación", async () => {
  const snapshot = { schemaVersion: 1, preferences, activeProviderId: null, providers: [] };
  let confirmed = true;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_preference_snapshot") return snapshot;
    if (command === "read_remote_preferences") return { snapshot, revision: 12 };
    if (command === "confirm_remote_preferences") return confirmed;
    return undefined;
  });
  const settled = vi.fn();
  await act(async () => root.render(<LanguageProvider><AccountSettings onClose={vi.fn()} preferences={preferences} onImported={vi.fn()} onSyncSettled={settled} syncRiskAcknowledged onAcknowledgeSyncRisk={() => true} /></LanguageProvider>));
  const sync = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.click();
  await act(async () => sync());
  expect(host.textContent).toContain("y la nube coinciden");
  expect(settled).toHaveBeenCalledOnce();
  confirmed = false;
  await act(async () => sync());
  expect(host.textContent).toContain("La nube cambió durante la comparación");
});

test("ofrece subir cuando la nube está vacía y maneja conflictos al conservar el equipo", async () => {
  const snapshot = { schemaVersion: 1, preferences, activeProviderId: null, providers: [] };
  let writeStatus: "saved" | "conflict" = "conflict";
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_preference_snapshot") return snapshot;
    if (command === "read_remote_preferences") return { snapshot: null, revision: 0 };
    if (command === "write_remote_preferences") return { status: writeStatus };
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  const sync = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.click();
  await act(async () => sync());
  expect(host.textContent).toContain("La nube aún no tiene una configuración");
  expect(host.textContent).toContain("Subir esta configuración");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Subir esta configuración")?.click());
  expect(host.textContent).toContain("La nube cambió desde la última consulta");
  writeStatus = "saved";
  await act(async () => sync());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Subir esta configuración")?.click());
  expect(host.textContent).toContain("ya está sincronizada");
});

test("muestra errores al comparar, escribir en nube y aplicar el snapshot remoto", async () => {
  const snapshot = { schemaVersion: 1, preferences, activeProviderId: null, providers: [] };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_preference_snapshot") return snapshot;
    if (command === "read_remote_preferences") throw new Error("cloud unavailable");
    if (command === "write_remote_preferences") throw "write denied";
    if (command === "apply_remote_preference_snapshot") throw "apply rejected";
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  const sync = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.click();
  await act(async () => sync());
  expect(host.textContent).toContain("No se pudo consultar la sincronización");

  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_preference_snapshot") return snapshot;
    if (command === "read_remote_preferences") return { snapshot: null, revision: 0 };
    if (command === "write_remote_preferences") throw "write denied";
    if (command === "apply_remote_preference_snapshot") throw "apply rejected";
    return undefined;
  });
  await act(async () => sync());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Subir esta configuración")?.click());
  expect(host.textContent).toContain("write denied");

  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_preference_snapshot") return snapshot;
    if (command === "read_remote_preferences") return { snapshot: { ...snapshot, preferences: { ...preferences, themeId: "ocean" } }, revision: 3 };
    if (command === "apply_remote_preference_snapshot") throw "apply rejected";
    return undefined;
  });
  await act(async () => sync());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Usar la nube")?.click());
  expect(host.textContent).toContain("apply rejected");
});

test("carga el historial vacío, añade páginas y muestra errores del servicio", async () => {
  let page = 0;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "read_remote_preference_history") {
      page += 1;
      if (page === 1) return { entries: [], nextBefore: 10 };
      if (page === 2) return { entries: [{ revision: 9, createdAt: "2026-11-22T12:00:00.000Z" }], nextBefore: null };
      throw new Error("history unavailable");
    }
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  const history = host.querySelector<HTMLElement>("[aria-labelledby='preference-history-title']")!;
  const refresh = () => history.querySelector<HTMLButtonElement>("button")?.click();
  await act(async () => refresh());
  expect(history.textContent).toContain("No hay versiones anteriores guardadas");
  await act(async () => [...history.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Ver versiones anteriores")?.click());
  expect(history.textContent).toContain("Versión 9");
  await act(async () => refresh());
  expect(host.textContent).toContain("No se pudo consultar el historial de la nube");
});

test("restaurar una versión distingue fallos antes y después de modificar la nube", async () => {
  let stage: "read" | "restore" | "apply" = "read";
  vi.stubGlobal("confirm", vi.fn(() => true));
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "read_remote_preference_history") return { entries: [{ revision: 5, createdAt: "2026-11-22T12:00:00.000Z" }], nextBefore: null };
    if (command === "read_remote_preferences") {
      if (stage === "read") throw new Error("offline");
      return { snapshot: { schemaVersion: 1, preferences, activeProviderId: null, providers: [] }, revision: 8 };
    }
    if (command === "restore_remote_preference_history") {
      if (stage === "restore") throw new Error("revision conflict");
      return { snapshot: { schemaVersion: 1, preferences, activeProviderId: null, providers: [] }, revision: 9 };
    }
    if (command === "apply_remote_preference_snapshot" && stage === "apply") throw new Error("backup unavailable");
    return { preferences, activeProvider: null, providers: [], backupPath: "C:/backup.laural", backupEncrypted: false, backupContainsApiKeys: false };
  });
  await act(async () => root.render(renderAccountSettings()));
  const history = host.querySelector<HTMLElement>("[aria-labelledby='preference-history-title']")!;
  await act(async () => history.querySelector<HTMLButtonElement>("button")?.click());
  const restore = () => [...history.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Restaurar")?.click();
  await act(async () => restore());
  expect(host.textContent).toContain("offline");
  stage = "restore";
  await act(async () => restore());
  expect(host.textContent).toContain("revision conflict");
  stage = "apply";
  await act(async () => restore());
  expect(host.textContent).toContain("La nube ya restauró la versión");
});

test("confirma el borrado de una revisión antes de eliminarla y comunica errores", async () => {
  const confirmation = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal("confirm", confirmation);
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "read_remote_preference_history") return { entries: [{ revision: 2, createdAt: "2026-11-22T12:00:00.000Z" }], nextBefore: null };
    if (command === "delete_remote_preference_history") throw "delete denied";
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  const history = host.querySelector<HTMLElement>("[aria-labelledby='preference-history-title']")!;
  await act(async () => history.querySelector<HTMLButtonElement>("button")?.click());
  const remove = () => [...history.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Eliminar")?.click();
  await act(async () => remove());
  expect(mocks.invoke).not.toHaveBeenCalledWith("delete_remote_preference_history", { revision: 2 });
  await act(async () => remove());
  expect(host.textContent).toContain("delete denied");
});

test("cubre respuestas fallidas y confirmadas al gestionar sesiones", async () => {
  let revokeOthersCalls = 0;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [{ id: "other", createdAt: "2026-11-20T10:00:00.000Z", expiresAt: "2026-12-20T10:00:00.000Z", current: false }];
    if (command === "revoke_account_session") {
      if (mocks.invoke.mock.calls.filter(([name]) => name === command).length === 2) throw new Error("network failure");
      return false;
    }
    if (command === "revoke_other_account_sessions") {
      revokeOthersCalls += 1;
      if (revokeOthersCalls === 2) throw new Error("network failure");
      return 1;
    }
    return undefined;
  });
  vi.stubGlobal("confirm", vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValue(true));
  await act(async () => root.render(renderAccountSettings()));

  const click = async (label: string) => act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label)?.click());
  await click("Revocar");
  expect(mocks.invoke).not.toHaveBeenCalledWith("revoke_account_session", { sessionId: "other" });
  await click("Revocar");
  expect(host.textContent).toContain("ya no estaba activa");
  await click("Revocar");
  expect(host.textContent).toContain("No se pudo revocar la sesión");

  const sessionSection = host.querySelector<HTMLElement>("[aria-labelledby='account-sessions-title']")!;
  await act(async () => sessionSection.querySelector<HTMLButtonElement>(".account-sessions-heading button")?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("list_account_sessions");
  await click("Revocar las demás sesiones");
  expect(host.textContent).toContain("Se revocó 1 sesión");
  await click("Revocar las demás sesiones");
  expect(mocks.invoke.mock.calls.filter(([name]) => name === "revoke_other_account_sessions")).toHaveLength(1);
  await click("Revocar las demás sesiones");
  expect(host.textContent).toContain("No se pudieron revocar las demás sesiones");
});

test("renovar y desactivar TOTP comunica fallos y éxito", async () => {
  let rotationFails = true;
  let totpEnabled = true;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled, recoveryCodesRemaining: 2, enrollmentPending: false };
    if (command === "rotate_account_recovery_codes") {
      if (rotationFails) throw new Error("recent login required");
      return ["1111-2222-3333-4444"];
    }
    if (command === "disable_account_totp") { totpEnabled = false; return undefined; }
    return undefined;
  });
  vi.stubGlobal("confirm", vi.fn(() => true));
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  const click = async (label: string) => act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label)?.click());

  await click("Renovar códigos de recuperación");
  expect(host.textContent).toContain("No se pudieron renovar los códigos");
  rotationFails = false;
  await click("Renovar códigos de recuperación");
  expect(host.textContent).toContain("1111-2222-3333-4444");
  await click("Cancelar");
  await click("Desactivar TOTP");
  expect(host.textContent).toContain("TOTP desactivado");
});

test("mantiene bloqueada la sincronización si no puede guardar la aceptación de riesgo", async () => {
  const acknowledge = vi.fn(() => false);
  mocks.invoke.mockImplementation(async (command: string) => command === "account_session_status");
  await act(async () => root.render(renderAccountSettings(vi.fn(), false, acknowledge)));
  const checkbox = host.querySelector<HTMLInputElement>('.sync-risk-notice input[type="checkbox"]')!;
  await act(async () => checkbox.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Aceptar riesgo y habilitar sincronización")?.click());
  expect(host.textContent).toContain("La sincronización sigue bloqueada");
  expect([...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.disabled).toBe(true);
});

test("permite conservar el equipo tras un conflicto con la nube", async () => {
  const snapshot = { schemaVersion: 1, preferences, activeProviderId: null, providers: [] };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_preference_snapshot") return snapshot;
    if (command === "read_remote_preferences") return { snapshot: { ...snapshot, preferences: { ...preferences, themeId: "ocean" } }, revision: 4 };
    if (command === "write_remote_preferences") return { status: "saved", revision: 5 };
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Usar este equipo")?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("write_remote_preferences", expect.objectContaining({ revision: 4 }));
  expect(host.textContent).toContain("La configuración de este equipo ya está sincronizada");
});

test("muestra los errores de borrado remoto y reintento de limpieza local", async () => {
  let deleteAttempt = 0;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled: false, recoveryCodesRemaining: 0, enrollmentPending: false };
    if (command === "delete_account") {
      deleteAttempt += 1;
      if (deleteAttempt === 1) throw "delete temporarily unavailable";
      if (deleteAttempt === 2) throw new Error("network unavailable");
      return { sessionCredentialCleared: false, syncStateCleared: false };
    }
    if (command === "clear_deleted_account_local_data") throw new Error("credential store unavailable");
    return undefined;
  });
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
  vi.stubGlobal("confirm", confirm);
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  const input = host.querySelector<HTMLInputElement>(".account-delete input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "ELIMINAR");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const remove = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Eliminar definitivamente mi cuenta")?.click();
  await act(async () => remove());
  expect(mocks.invoke).not.toHaveBeenCalledWith("delete_account", expect.anything());
  await act(async () => remove());
  expect(host.textContent).toContain("delete temporarily unavailable");
  await act(async () => remove());
  expect(host.textContent).toContain("No se pudo confirmar el borrado");
  await act(async () => remove());
  expect(host.textContent).toContain("No se pudo limpiar todo el estado local");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Reintentar limpieza local")?.click());
  expect(host.textContent).toContain("No se pudo completar la limpieza local");
});

test("cierra correctamente listener y lectura de sesión que terminan después del desmontaje", async () => {
  let resolveListen: ((stop: () => void) => void) | undefined;
  let resolveSession: ((status: boolean) => void) | undefined;
  let savedListener: typeof mocks.onStatus;
  const stop = vi.fn();
  mocks.listenImplementation = async (callback) => {
    savedListener = callback;
    return new Promise((resolve) => { resolveListen = resolve; });
  };
  mocks.invoke.mockImplementation((command: string) => command === "account_session_status"
    ? new Promise((resolve) => { resolveSession = resolve; })
    : Promise.resolve(undefined));

  await act(async () => root.render(renderAccountSettings()));
  await act(async () => root.unmount());
  await act(async () => {
    savedListener?.({ payload: { status: "signed_in", message: "late" } });
    resolveListen?.(stop);
    resolveSession?.(true);
    await Promise.resolve();
  });
  expect(stop).toHaveBeenCalledOnce();
  expect(host.textContent).toBe("");
  root = createRoot(host);
});

test("ignora errores del listener y sesión que llegan tras desmontar Cuenta", async () => {
  let rejectListen: ((error: Error) => void) | undefined;
  let rejectSession: ((error: Error) => void) | undefined;
  mocks.listenImplementation = async () => new Promise((_resolve, reject) => { rejectListen = reject; });
  mocks.invoke.mockImplementation((command: string) => command === "account_session_status"
    ? new Promise((_resolve, reject) => { rejectSession = reject; })
    : Promise.resolve(undefined));

  await act(async () => root.render(renderAccountSettings()));
  await act(async () => root.unmount());
  await act(async () => {
    rejectListen?.(new Error("late listener failure"));
    rejectSession?.(new Error("late session failure"));
    await Promise.resolve();
  });
  expect(host.textContent).toBe("");
  root = createRoot(host);
});

test("mantiene las guardas de sincronización aunque se fuerce el click de controles deshabilitados", async () => {
  const snapshot = { schemaVersion: 1, preferences, activeProviderId: null, providers: [] };
  const cloud = { ...snapshot, preferences: { ...preferences, themeId: "ocean" } };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_preference_snapshot") return snapshot;
    if (command === "read_remote_preferences") return { snapshot: cloud, revision: 4 };
    if (command === "read_remote_preference_history") return { entries: [{ revision: 3, createdAt: "2026-11-22T12:00:00.000Z" }], nextBefore: null };
    return undefined;
  });
  const settings = (syncRiskAcknowledged: boolean) => <LanguageProvider><AccountSettings onClose={vi.fn()} preferences={preferences} onImported={vi.fn()} onSyncSettled={vi.fn()} syncRiskAcknowledged={syncRiskAcknowledged} onAcknowledgeSyncRisk={vi.fn(() => true)} /></LanguageProvider>;
  await act(async () => root.render(settings(true)));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  mocks.invoke.mockClear();
  const click = async (button: HTMLButtonElement | null) => act(async () => {
    if (button) { button.disabled = false; button.click(); }
  });
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.click());
  const history = host.querySelector<HTMLElement>("[aria-labelledby='preference-history-title']")!;
  await act(async () => history.querySelector<HTMLButtonElement>(".account-sessions-heading button")?.click());
  await act(async () => root.render(settings(false)));

  await click([...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora") ?? null);
  await click([...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Usar este equipo") ?? null);
  await click([...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Usar la nube") ?? null);
  const currentHistory = host.querySelector<HTMLElement>("[aria-labelledby='preference-history-title']")!;
  await click(currentHistory.querySelector<HTMLButtonElement>(".account-sessions-heading button"));
  await click([...currentHistory.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Restaurar") ?? null);

  expect(mocks.invoke).toHaveBeenCalledTimes(3);
  expect(mocks.invoke).not.toHaveBeenCalledWith("write_remote_preferences", expect.anything());
  expect(mocks.invoke).not.toHaveBeenCalledWith("apply_remote_preference_snapshot", expect.anything());
  expect(mocks.invoke).not.toHaveBeenCalledWith("restore_remote_preference_history", expect.anything());
});

test("la comparación y el historial siguen bloqueados hasta aceptar el riesgo", async () => {
  mocks.invoke.mockImplementation(async (command: string) => command === "account_session_status" ? true : undefined);
  await act(async () => root.render(renderAccountSettings(vi.fn(), false)));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  mocks.invoke.mockClear();

  const sync = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")!;
  const history = host.querySelector<HTMLElement>("[aria-labelledby='preference-history-title']")!;
  const refresh = history.querySelector<HTMLButtonElement>(".account-sessions-heading button")!;
  expect(sync.disabled).toBe(true);
  expect(refresh.disabled).toBe(true);
  expect(host.textContent).not.toContain("Riesgo revisado en este equipo");
  await act(async () => {
    sync.disabled = false;
    sync.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    refresh.disabled = false;
    refresh.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(mocks.invoke).not.toHaveBeenCalledWith("get_preference_snapshot", expect.anything());
  expect(mocks.invoke).not.toHaveBeenCalledWith("read_remote_preferences");
  expect(mocks.invoke).not.toHaveBeenCalledWith("read_remote_preference_history", expect.anything());
});

test("no finaliza TOTP ni elimina la cuenta sin sus confirmaciones internas", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "list_account_sessions") return [];
    if (command === "get_account_mfa_status") return { totpEnabled: true, recoveryCodesRemaining: 2, enrollmentPending: false };
    if (command === "rotate_account_recovery_codes") return ["1111-2222-3333-4444"];
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Renovar códigos de recuperación")?.click());
  const finish = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Confirmar y renovar")!;
  expect(finish.disabled).toBe(true);
  await act(async () => { finish.disabled = false; finish.click(); });
  expect(mocks.invoke).not.toHaveBeenCalledWith("complete_totp_enrollment");

  const remove = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Eliminar definitivamente mi cuenta")!;
  expect(remove.disabled).toBe(true);
  await act(async () => { remove.disabled = false; remove.click(); });
  expect(mocks.invoke).not.toHaveBeenCalledWith("delete_account", expect.anything());
});

test("sincroniza apariencia e instalación locales y distingue fallos de sincronización", async () => {
  localStorage.setItem("laural.appearance", "light");
  localStorage.setItem("laural.update-mode.v1", "automatic");
  const snapshot = { schemaVersion: 1, preferences, activeProviderId: null, providers: [] };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_preference_snapshot") return snapshot;
    if (command === "read_remote_preferences") return { snapshot: { ...snapshot, preferences: { ...preferences, themeId: "ocean" } }, revision: 2 };
    if (command === "write_remote_preferences") throw new Error("cloud write failed");
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sincronizar ahora")?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("get_preference_snapshot", { preferences: { themeId: "laurel", appearance: "light", updateMode: "automatic", language: "es" } });
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Usar este equipo")?.click());
  expect(host.textContent).toContain("No se pudo sincronizar la configuración local");
});

test("restaurar el historial distingue nube vacía, versión vacía y fallo local", async () => {
  let attempt = 0;
  const restoredSnapshot = { schemaVersion: 1, preferences, activeProviderId: null, providers: [] };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "read_remote_preference_history") return { entries: [{ revision: 7, createdAt: "2026-11-22T12:00:00.000Z" }], nextBefore: null };
    if (command === "read_remote_preferences") {
      attempt += 1;
      return attempt === 1 ? { snapshot: null, revision: 0 } : { snapshot: restoredSnapshot, revision: 8 };
    }
    if (command === "restore_remote_preference_history") return attempt === 2
      ? { snapshot: null, revision: 9 }
      : { snapshot: restoredSnapshot, revision: 10 };
    if (command === "apply_remote_preference_snapshot") throw { code: "LOCAL_APPLY_FAILED" };
    return undefined;
  });
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
  vi.stubGlobal("confirm", confirm);
  await act(async () => root.render(renderAccountSettings()));
  const history = host.querySelector<HTMLElement>("[aria-labelledby='preference-history-title']")!;
  await act(async () => history.querySelector<HTMLButtonElement>(".account-sessions-heading button")?.click());
  const restore = () => [...history.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Restaurar")?.click();

  await act(async () => restore());
  expect(mocks.invoke).not.toHaveBeenCalledWith("restore_remote_preference_history", expect.anything());
  await act(async () => restore());
  expect(host.textContent).toContain("La nube no contiene una configuración actual");
  await act(async () => restore());
  expect(host.textContent).toContain("La versión restaurada está vacía");
  await act(async () => restore());
  expect(host.textContent).toContain("este equipo no pudo aplicarla");
  expect(host.textContent).toContain("No se pudo aplicar la configuración local");
});

test("conserva el mensaje libre del backend al fallar la aplicación tras restaurar la nube", async () => {
  const restoredSnapshot = { schemaVersion: 1, preferences, activeProviderId: null, providers: [] };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "read_remote_preference_history") return { entries: [{ revision: 3, createdAt: "2026-11-22T12:00:00.000Z" }], nextBefore: null };
    if (command === "read_remote_preferences") return { snapshot: restoredSnapshot, revision: 4 };
    if (command === "restore_remote_preference_history") return { snapshot: restoredSnapshot, revision: 5 };
    if (command === "apply_remote_preference_snapshot") throw "No se pudo aplicar en este dispositivo";
    return undefined;
  });
  vi.stubGlobal("confirm", vi.fn(() => true));
  await act(async () => root.render(renderAccountSettings()));
  const history = host.querySelector<HTMLElement>("[aria-labelledby='preference-history-title']")!;
  await act(async () => history.querySelector<HTMLButtonElement>(".account-sessions-heading button")?.click());
  await act(async () => [...history.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Restaurar")?.click());

  expect(host.textContent).toContain("La nube ya restauró la versión");
  expect(host.textContent).toContain("No se pudo aplicar en este dispositivo");
});

test("conserva mensajes del servicio y normaliza errores de comparación, aplicación e historial", async () => {
  let comparison = 0;
  const snapshot = { schemaVersion: 1, preferences, activeProviderId: null, providers: [] };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "get_preference_snapshot") return snapshot;
    if (command === "read_remote_preferences") {
      comparison += 1;
      if (comparison === 1) throw "servidor temporalmente ocupado";
      return { snapshot: { ...snapshot, preferences: { ...preferences, themeId: "ocean" } }, revision: 5 };
    }
    if (command === "apply_remote_preference_snapshot") throw new Error("apply transport failed");
    if (command === "read_remote_preference_history") throw "historial no disponible";
    return undefined;
  });
  await act(async () => root.render(renderAccountSettings()));
  const click = async (label: string) => act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label)?.click());

  await click("Sincronizar ahora");
  expect(host.textContent).toContain("servidor temporalmente ocupado");
  await click("Sincronizar ahora");
  await click("Usar la nube");
  expect(host.textContent).toContain("No se pudo aplicar la configuración de la nube");
  const history = host.querySelector<HTMLElement>("[aria-labelledby='preference-history-title']")!;
  await act(async () => history.querySelector<HTMLButtonElement>(".account-sessions-heading button")?.click());
  expect(host.textContent).toContain("historial no disponible");
});

test("normaliza un error de transporte al eliminar una revisión del historial", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "account_session_status") return true;
    if (command === "read_remote_preference_history") return { entries: [{ revision: 6, createdAt: "2026-11-22T12:00:00.000Z" }], nextBefore: null };
    if (command === "delete_remote_preference_history") throw new Error("history delete failed");
    return undefined;
  });
  vi.stubGlobal("confirm", vi.fn(() => true));
  await act(async () => root.render(renderAccountSettings()));
  const history = host.querySelector<HTMLElement>("[aria-labelledby='preference-history-title']")!;
  await act(async () => history.querySelector<HTMLButtonElement>(".account-sessions-heading button")?.click());
  await act(async () => [...history.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Eliminar")?.click());
  expect(host.textContent).toContain("No se pudo eliminar la versión");
});
