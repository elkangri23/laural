import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SettingsDialog } from "./SettingsDialog";

type AuthStatus = { status: "waiting" | "signed_in" | "error"; message: string };
type Preferences = { themeId: string; appearance: "dark" | "light"; updateMode: "manual" | "automatic" };
type Snapshot = {
  schemaVersion: number;
  preferences: Preferences;
  activeProviderId: string | null;
  providers: { id: string; kind: string; name: string; model: string; customEndpoint?: string }[];
};
type Remote = { snapshot: Snapshot | null; revision: number };
type AccountSession = { id: string; createdAt: string; expiresAt: string; current: boolean };
type AccountMfaStatus = { totpEnabled: boolean; recoveryCodesRemaining: number; enrollmentPending: boolean };
type TotpEnrollment = { secret: string; provisioningUri: string };
type ImportResult = { preferences: Preferences; activeProvider: { id: string; providerKind: string; name: string; baseUrl: string; model: string; hasApiKey: boolean; shareCustomEndpoint: boolean } | null; providers: { id: string; providerKind: string; name: string; baseUrl: string; model: string; hasApiKey: boolean; shareCustomEndpoint: boolean }[]; backupPath: string; backupEncrypted: boolean; backupContainsApiKeys: boolean };

export function AccountSettings({ onClose, preferences, onImported, onSyncSettled, syncRiskAcknowledged, onAcknowledgeSyncRisk }: { onClose: () => void; preferences: Preferences; onImported: (result: ImportResult) => void; onSyncSettled: () => void; syncRiskAcknowledged: boolean; onAcknowledgeSyncRisk: () => boolean }) {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listenerReady, setListenerReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [message, setMessage] = useState("Comprobando la sesión local…");
  const [remote, setRemote] = useState<Remote | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const [riskChecked, setRiskChecked] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(syncRiskAcknowledged);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [sessionsMessage, setSessionsMessage] = useState("");
  const [mfaStatus, setMfaStatus] = useState<AccountMfaStatus | null>(null);
  const [passkeysEnabled, setPasskeysEnabled] = useState(false);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryAction, setRecoveryAction] = useState<"enrollment" | "rotation" | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [mfaMessage, setMfaMessage] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [deleteCleanupPending, setDeleteCleanupPending] = useState(false);

  useEffect(() => setRiskAcknowledged(syncRiskAcknowledged), [syncRiskAcknowledged]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<AuthStatus>("account-auth-status", ({ payload }) => {
      if (disposed) return;
      setBusy(payload.status === "waiting");
      if (payload.status === "signed_in") {
        setConnected(true);
        void loadAccountSessions();
        void loadAccountMfa();
        void loadPasskeysAvailability();
        window.dispatchEvent(new Event("laural:account-connected"));
      }
      setMessage(payload.message);
    }).then((stopListening) => {
      if (disposed) stopListening();
      else {
        unlisten = stopListening;
        setListenerReady(true);
      }
    }).catch(() => {
      if (!disposed) setMessage("No se pudo escuchar el resultado del inicio de sesión.");
    });

    void invoke<boolean>("account_session_status").then((hasSession) => {
      if (!disposed) {
        setConnected(hasSession);
        setMessage(hasSession ? "Hay una sesión guardada en este equipo." : "No hay ninguna cuenta conectada.");
        setSessionReady(true);
        if (hasSession) {
          void loadAccountSessions();
          void loadAccountMfa();
          void loadPasskeysAvailability();
        }
      }
    }).catch(() => {
      if (!disposed) {
        setMessage("No se pudo consultar el almacén seguro de Windows.");
        setSessionReady(true);
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function beginLogin() {
    setBusy(true);
    setMessage("Abriendo el navegador seguro…");
    try {
      await invoke("start_account_login");
    } catch {
      setBusy(false);
      setMessage("No se pudo abrir el navegador. Comprueba la configuración del equipo e inténtalo de nuevo.");
    }
  }

  async function loadAccountSessions() {
    setSessionsMessage("Consultando sesiones…");
    try {
      const result = await invoke<AccountSession[]>("list_account_sessions");
      if (!Array.isArray(result)) throw new Error("Invalid sessions response");
      setSessions(result);
      setSessionsMessage(result.length ? "" : "No hay sesiones activas.");
    } catch {
      setSessionsMessage("No se pudo consultar la lista de sesiones. Comprueba la conexión e inténtalo de nuevo.");
    }
  }

  async function loadAccountMfa() {
    try {
      setMfaStatus(await invoke<AccountMfaStatus>("get_account_mfa_status"));
    } catch {
      setMfaStatus(null);
      setMfaMessage("No se pudo consultar la seguridad de la cuenta.");
    }
  }

  async function loadPasskeysAvailability() {
    try {
      setPasskeysEnabled(await invoke<boolean>("get_account_passkeys_enabled"));
    } catch {
      setPasskeysEnabled(false);
    }
  }

  async function managePasskeys() {
    setBusy(true);
    try {
      await invoke("start_passkey_management");
      setMfaMessage("Se abrió la gestión segura de passkeys en el navegador.");
    } catch (error) {
      setMfaMessage(typeof error === "string" ? error : "No se pudo abrir la gestión de passkeys.");
    } finally {
      setBusy(false);
    }
  }

  async function startTotpEnrollment() {
    setBusy(true);
    setMfaMessage("");
    try {
      setEnrollment(await invoke<TotpEnrollment>("start_totp_enrollment"));
      setRecoveryCodes([]);
      setRecoveryAction(null);
      setMfaCode("");
    } catch {
      setMfaMessage("No se pudo iniciar TOTP. Inicia sesión de nuevo y vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmTotpEnrollment() {
    setBusy(true);
    setMfaMessage("");
    try {
      setRecoveryCodes(await invoke<string[]>("confirm_totp_enrollment", { code: mfaCode }));
      setRecoveryAction("enrollment");
      setRecoverySaved(false);
      setMfaCode("");
    } catch {
      setMfaMessage("El código no es válido o la sesión reciente ha caducado. Comprueba el código e inicia sesión de nuevo si es necesario.");
    } finally {
      setBusy(false);
    }
  }

  async function rotateRecoveryCodes() {
    setBusy(true);
    setMfaMessage("");
    try {
      setRecoveryCodes(await invoke<string[]>("rotate_account_recovery_codes"));
      setRecoveryAction("rotation");
      setRecoverySaved(false);
    } catch {
      setMfaMessage("No se pudieron renovar los códigos. Inicia sesión de nuevo y vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  async function finishRecoveryCodes() {
    if (!recoverySaved) return;
    setBusy(true);
    setMfaMessage("");
    try {
      await invoke("complete_totp_enrollment");
      setEnrollment(null);
      setRecoveryCodes([]);
      setRecoveryAction(null);
      await loadAccountMfa();
      await loadAccountSessions();
      setMfaMessage(recoveryAction === "rotation" ? "Códigos renovados. Las sesiones de otros equipos se revocaron." : "TOTP activado. Las sesiones de otros equipos se revocaron.");
    } catch {
      setMfaMessage("No se pudo confirmar. Conserva esta pantalla y vuelve a intentarlo; los códigos anteriores siguen activos hasta confirmar.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelTotpEnrollment() {
    setBusy(true);
    try {
      await invoke("cancel_totp_enrollment");
      setEnrollment(null);
      setRecoveryCodes([]);
      setRecoveryAction(null);
      setRecoverySaved(false);
      await loadAccountMfa();
    } catch {
      setMfaMessage("No se pudo cancelar el cambio de TOTP.");
    } finally {
      setBusy(false);
    }
  }

  async function disableTotp() {
    if (!window.confirm("Se desactivará la verificación TOTP y se eliminarán los códigos de recuperación. ¿Quieres continuar?")) return;
    setBusy(true);
    try {
      await invoke("disable_account_totp");
      setMfaMessage("TOTP desactivado. Las sesiones de otros equipos se revocaron.");
      await loadAccountMfa();
      await loadAccountSessions();
    } catch {
      setMfaMessage("No se pudo desactivar TOTP. Inicia sesión de nuevo y vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  async function copyRecoveryCodes() {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setMfaMessage("Códigos copiados. Guárdalos en un lugar seguro.");
    } catch {
      setMfaMessage("No se pudieron copiar. Selecciona y copia los códigos manualmente.");
    }
  }

  async function revokeAccountSession(session: AccountSession) {
    if (session.current || !window.confirm("¿Revocar esta sesión? El dispositivo tendrá que iniciar sesión de nuevo.")) return;
    setBusy(true);
    try {
      const revoked = await invoke<boolean>("revoke_account_session", { sessionId: session.id });
      if (!revoked) {
        setSessionsMessage("La sesión ya no estaba activa o no se pudo revocar.");
        return;
      }
      setSessions((current) => current.filter(({ id }) => id !== session.id));
      setSessionsMessage("Sesión revocada. El dispositivo deberá iniciar sesión de nuevo.");
    } catch {
      setSessionsMessage("No se pudo revocar la sesión. Comprueba la conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeOtherSessions() {
    if (!window.confirm("Se cerrarán las demás sesiones de esta cuenta. Este equipo seguirá conectado. Los otros dispositivos tendrán que iniciar sesión de nuevo.")) return;
    setBusy(true);
    try {
      const revoked = await invoke<number>("revoke_other_account_sessions");
      await loadAccountSessions();
      setSessionsMessage(revoked === 1
        ? "Se revocó 1 sesión. Este equipo sigue conectado."
        : `Se revocaron ${revoked} sesiones. Este equipo sigue conectado.`);
    } catch {
      setSessionsMessage("No se pudieron revocar las demás sesiones. Comprueba la conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function removeLocalSession() {
    setBusy(true);
    try {
      const remotelyRevoked = await invoke<boolean>("clear_account_session");
      setConnected(false);
      setMfaStatus(null);
      setEnrollment(null);
      setRecoveryCodes([]);
      window.dispatchEvent(new Event("laural:account-disconnected"));
      setMessage(remotelyRevoked
        ? "Sesión cerrada en este equipo; el servidor confirmó que ya no es válida."
        : "Sesión quitada de este equipo. No se pudo confirmar la revocación remota; el servidor podría aceptarla hasta su vencimiento.");
    } catch {
      setMessage("No se pudo quitar la sesión del almacén seguro de Windows.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (deleteConfirmation !== "ELIMINAR") return;
    if (!window.confirm("Se borrarán definitivamente la cuenta, sus preferencias en la nube, las sesiones y los factores. La configuración local y las claves de proveedores se conservarán. ¿Quieres continuar?")) return;
    setBusy(true);
    setDeleteMessage("");
    try {
      const result = await invoke<{ sessionCredentialCleared: boolean; syncStateCleared: boolean }>("delete_account", { confirmation: deleteConfirmation });
      setConnected(false);
      setSessions([]);
      setMfaStatus(null);
      setEnrollment(null);
      setRecoveryCodes([]);
      setDeleteConfirmation("");
      window.dispatchEvent(new Event("laural:account-disconnected"));
      setDeleteCleanupPending(!result.sessionCredentialCleared || !result.syncStateCleared);
      setDeleteMessage(result.sessionCredentialCleared && result.syncStateCleared
        ? "La cuenta y sus datos sincronizados se borraron. La configuración local y las claves de proveedores se conservaron."
        : "La cuenta ya se borró del servidor. No se pudo limpiar todo el estado local; puedes volver a intentarlo aquí.");
    } catch (error) {
      setDeleteMessage(typeof error === "string" ? error : "No se pudo confirmar el borrado. Comprueba la conexión antes de volver a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  async function retryDeletedAccountCleanup() {
    setBusy(true);
    try {
      const result = await invoke<{ sessionCredentialCleared: boolean; syncStateCleared: boolean }>("clear_deleted_account_local_data");
      const pending = !result.sessionCredentialCleared || !result.syncStateCleared;
      setDeleteCleanupPending(pending);
      setDeleteMessage(pending
        ? "Aún queda algún dato local pendiente de limpieza. Vuelve a intentarlo o revisa el almacén seguro de Windows."
        : "Limpieza local completada. La configuración y las claves de proveedores se conservaron.");
    } catch {
      setDeleteMessage("No se pudo completar la limpieza local. Vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  function snapshotPreferences(): Preferences {
    return {
      themeId: localStorage.getItem("laural.theme") ?? preferences.themeId,
      appearance: localStorage.getItem("laural.appearance") === "light" ? "light" : "dark",
      updateMode: localStorage.getItem("laural.update-mode.v1") === "automatic" ? "automatic" : "manual",
    };
  }

  async function readLocalSnapshot() {
    return invoke<Snapshot>("get_preference_snapshot", { preferences: snapshotPreferences() });
  }

  async function refreshComparison() {
    if (!riskAcknowledged) return;
    setBusy(true);
    setRemote(null);
    try {
      const [local, cloud] = await Promise.all([
        readLocalSnapshot(),
        invoke<Remote>("read_remote_preferences"),
      ]);
      setRemote(cloud);
      setHasConflict(Boolean(cloud.snapshot && !snapshotsMatch(local, cloud.snapshot)));
      if (!cloud.snapshot) setMessage("La nube aún no tiene una configuración sincronizada. Puedes subir la de este equipo.");
      else if (snapshotsMatch(local, cloud.snapshot)) {
        const confirmed = await invoke<boolean>("confirm_remote_preferences", { snapshot: local, revision: cloud.revision });
        if (!confirmed) {
          setRemote(null);
          setMessage("La nube cambió durante la comparación. Vuelve a sincronizar para elegir con el estado actualizado.");
          return;
        }
        onSyncSettled();
        setMessage("La configuración local y la nube coinciden.");
      }
      else setMessage("La configuración local y la nube no coincide. ¿Cuál quieres conservar?");
    } catch (error) {
      setMessage(typeof error === "string" ? error : "No se pudo consultar la sincronización.");
    } finally {
      setBusy(false);
    }
  }

  async function keepLocal() {
    if (!riskAcknowledged) return;
    setBusy(true);
    setMessage("Guardando la configuración de este equipo en la nube…");
    try {
      const local = await readLocalSnapshot();
      const result = await invoke<{ status: "saved" | "conflict"; revision?: number }>("write_remote_preferences", { snapshot: local, revision: remote?.revision ?? 0 });
      if (result.status === "conflict") {
        setMessage("La nube cambió desde la última consulta. Vuelve a comparar para elegir qué configuración conservar.");
        setRemote(null);
        setHasConflict(false);
      } else {
        setRemote({ snapshot: local, revision: result.revision ?? (remote?.revision ?? 0) + 1 });
        setHasConflict(false);
        onSyncSettled();
        setMessage("La configuración de este equipo ya está sincronizada.");
      }
    } catch (error) {
      setMessage(typeof error === "string" ? error : "No se pudo sincronizar la configuración local.");
    } finally {
      setBusy(false);
    }
  }

  async function keepCloud() {
    if (!riskAcknowledged) return;
    if (!remote?.snapshot) return;
    setBusy(true);
    setMessage("Creando una copia local y aplicando la configuración de la nube…");
    try {
      const result = await invoke<ImportResult & { backupPath: string }>("apply_remote_preference_snapshot", {
        snapshot: remote.snapshot,
        revision: remote.revision,
        currentPreferences: snapshotPreferences(),
      });
      onImported(result);
      setHasConflict(false);
      onSyncSettled();
      setMessage(`Configuración aplicada. Copia local guardada en: ${result.backupPath}`);
    } catch (error) {
      setMessage(typeof error === "string" ? error : "No se pudo aplicar la configuración de la nube.");
    } finally {
      setBusy(false);
    }
  }

  return <SettingsDialog onClose={onClose}>
    <section className="account-settings" aria-labelledby="account-settings-title">
      <p className="eyebrow">CUENTA</p>
      <h3 id="account-settings-title">Cuenta y sincronización</h3>
      <p className="dialog-copy">Conecta una cuenta desde el navegador. La sesión se guarda en el almacén seguro de Windows y nunca se entrega al WebView.</p>
      <div className="sync-risk-notice" role="note" aria-label="Riesgo de sincronización">
        <strong>Antes de sincronizar</strong>
        <p>La configuración permitida se guardará en el VPS del servicio. No hay copias de desastre fuera de ese servidor: una pérdida total del VPS puede borrar tus datos sincronizados. El operador del VPS puede leer esta configuración; no hay cifrado de extremo a extremo. Las claves API nunca se sincronizan. Conserva una exportación local si necesitas otra copia.</p>
        {riskAcknowledged
          ? <p className="sync-risk-accepted">Riesgo revisado en este equipo.</p>
          : <>
            <label><input type="checkbox" checked={riskChecked} onChange={(event) => setRiskChecked(event.currentTarget.checked)} /> Entiendo que la pérdida total del VPS puede borrar los datos sincronizados.</label>
            <button className="secondary-button" disabled={!riskChecked} onClick={() => {
              if (onAcknowledgeSyncRisk()) setRiskAcknowledged(true);
              else setMessage("No se pudo guardar la aceptación en este equipo. La sincronización sigue bloqueada.");
            }}>Aceptar riesgo y habilitar sincronización</button>
          </>}
      </div>
      <p className="form-message" role="status" aria-live="polite">{message}</p>
      {connected
        ? <>
          <div className="account-sync-actions">
            <button className="primary-button" onClick={() => void refreshComparison()} disabled={busy || !riskAcknowledged}>Sincronizar ahora</button>
            {remote && <>
              {remote.snapshot && hasConflict && <button className="secondary-button" onClick={() => void keepLocal()} disabled={busy || !riskAcknowledged}>Usar este equipo</button>}
              {remote.snapshot && hasConflict && <button className="secondary-button" onClick={() => void keepCloud()} disabled={busy || !riskAcknowledged}>Usar la nube</button>}
              {!remote.snapshot && <button className="secondary-button" onClick={() => void keepLocal()} disabled={busy || !riskAcknowledged}>Subir esta configuración</button>}
            </>}
          </div>
          <button className="secondary-button" onClick={() => void removeLocalSession()} disabled={busy}>Quitar cuenta de este equipo</button>
          <div className="account-sessions" aria-labelledby="account-sessions-title">
            <div className="account-sessions-heading">
              <h4 id="account-sessions-title">Sesiones activas</h4>
              <button className="secondary-button" onClick={() => void loadAccountSessions()} disabled={busy}>Actualizar</button>
            </div>
            <button className="secondary-button" onClick={() => void revokeOtherSessions()} disabled={busy}>Revocar las demás sesiones</button>
            {sessionsMessage && <p className="dialog-copy" role="status" aria-live="polite">{sessionsMessage}</p>}
            {sessions.length > 0 && <ul className="account-session-list">
              {sessions.map((session) => <li key={session.id}>
                <div>
                  <strong>{session.current ? "Este equipo" : "Otro inicio de sesión"}</strong>
                  <span>Iniciada: {new Date(session.createdAt).toLocaleString()}</span>
                  <span>Caduca: {new Date(session.expiresAt).toLocaleString()}</span>
                </div>
                {!session.current && <button className="secondary-button" onClick={() => void revokeAccountSession(session)} disabled={busy}>Revocar</button>}
              </li>)}
            </ul>}
          </div>
          <section className="account-mfa" aria-labelledby="account-mfa-title">
            {passkeysEnabled && <section aria-labelledby="account-passkeys-title">
              <h4 id="account-passkeys-title">Passkeys</h4>
              <p className="dialog-copy">Inicia sesión sin contraseña con una clave de acceso de tu dispositivo o gestor. Si TOTP está activo, también se pedirá ese código.</p>
              <button className="secondary-button" disabled={busy} onClick={() => void managePasskeys()}>Gestionar passkeys en el navegador</button>
            </section>}
            <h4 id="account-mfa-title">Autenticación en dos pasos</h4>
            <p className="dialog-copy">Protege el inicio de sesión con una aplicación TOTP. Para cambiar esta opción debes haber iniciado sesión en los últimos diez minutos.</p>
            {mfaMessage && <p className="form-message" role="status" aria-live="polite">{mfaMessage}</p>}
            {!mfaStatus && <p className="dialog-copy">Consultando el estado de seguridad…</p>}
            {mfaStatus && !enrollment && recoveryCodes.length === 0 && <>
              <p className="account-mfa-status">Estado: <strong>{mfaStatus.totpEnabled ? "Activado" : "Desactivado"}</strong>{mfaStatus.totpEnabled && ` · ${mfaStatus.recoveryCodesRemaining} códigos disponibles`}</p>
              {mfaStatus.enrollmentPending && !mfaStatus.totpEnabled && <p className="dialog-copy">Hay una configuración pendiente que no se activó. Puedes reiniciarla o cancelarla.</p>}
              {!mfaStatus.totpEnabled
                ? <div className="account-sync-actions">
                  <button className="secondary-button" disabled={busy} onClick={() => void startTotpEnrollment()}>{mfaStatus.enrollmentPending ? "Reiniciar configuración" : "Configurar TOTP"}</button>
                  {mfaStatus.enrollmentPending && <button className="secondary-button" disabled={busy} onClick={() => void cancelTotpEnrollment()}>Cancelar configuración pendiente</button>}
                </div>
                : <div className="account-sync-actions">
                  <button className="secondary-button" disabled={busy} onClick={() => void rotateRecoveryCodes()}>Renovar códigos de recuperación</button>
                  <button className="secondary-button" disabled={busy} onClick={() => void disableTotp()}>Desactivar TOTP</button>
                </div>}
            </>}
            {enrollment && recoveryCodes.length === 0 && <div className="account-mfa-enrollment">
              <p>1. Añade la cuenta a tu aplicación autenticadora mediante este URI o introduce manualmente la clave.</p>
              <label>URI de configuración<input readOnly value={enrollment.provisioningUri} /></label>
              <label>Clave manual<input readOnly value={enrollment.secret} /></label>
              <label>Código de seis dígitos<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.currentTarget.value.replace(/\D/gu, "").slice(0, 6))} /></label>
              <div className="account-sync-actions">
                <button className="secondary-button" disabled={busy || mfaCode.length !== 6} onClick={() => void confirmTotpEnrollment()}>Verificar y mostrar códigos</button>
                <button className="secondary-button" disabled={busy} onClick={() => void cancelTotpEnrollment()}>Cancelar</button>
              </div>
            </div>}
            {recoveryCodes.length > 0 && <div className="account-recovery-codes">
              <p>{recoveryAction === "rotation" ? "Guarda los nuevos códigos. Los anteriores siguen activos hasta que confirmes que los has guardado." : "Guarda estos códigos ahora. Solo se muestran una vez y se activarán al confirmar que los has guardado."}</p>
              <pre aria-label="Códigos de recuperación">{recoveryCodes.join("\n")}</pre>
              <button className="secondary-button" disabled={busy} onClick={() => void copyRecoveryCodes()}>Copiar códigos</button>
              <label className="account-recovery-confirm"><input type="checkbox" checked={recoverySaved} onChange={(event) => setRecoverySaved(event.currentTarget.checked)} /> He guardado los códigos en un lugar seguro</label>
              <div className="account-sync-actions">
                <button className="primary-button" disabled={busy || !recoverySaved} onClick={() => void finishRecoveryCodes()}>Confirmar y {recoveryAction === "rotation" ? "renovar" : "activar TOTP"}</button>
                <button className="secondary-button" disabled={busy} onClick={() => void cancelTotpEnrollment()}>Cancelar</button>
              </div>
            </div>}
          </section>
        </>
        : <button className="primary-button" onClick={() => void beginLogin()} disabled={busy || !listenerReady || !sessionReady}>{busy ? "Esperando en el navegador…" : "Iniciar sesión"}</button>}
      {connected && <p className="dialog-copy account-note">Solo se sincronizan las preferencias permitidas y los perfiles de proveedor. Las claves API permanecen en el almacén seguro de este equipo. Los endpoints personalizados solo se incluyen si activaste compartirlos en cada perfil.</p>}
      {connected && <p className="dialog-copy account-note">Al quitar la cuenta, Laural intenta revocar la sesión del servidor y borra siempre la credencial de este equipo. Si no hay conexión, la sesión remota puede seguir válida hasta su vencimiento.</p>}
      {connected && <section className="account-delete" aria-labelledby="account-delete-title">
        <h4 id="account-delete-title">Eliminar cuenta y datos sincronizados</h4>
        <p className="dialog-copy">El borrado es definitivo. Elimina tu cuenta, su configuración en la nube, sesiones y factores de seguridad. No elimina la configuración ni las claves guardadas en este equipo. Para confirmar, inicia sesión de nuevo dentro de los diez minutos anteriores y escribe <strong>ELIMINAR</strong>.</p>
        <div className="account-sync-actions">
          <button className="secondary-button" disabled={busy} onClick={() => void beginLogin()}>Volver a iniciar sesión</button>
        </div>
        <label>Escribe ELIMINAR para confirmar<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.currentTarget.value)} autoComplete="off" maxLength={8} /></label>
        <button className="danger-button" disabled={busy || deleteConfirmation !== "ELIMINAR"} onClick={() => void deleteAccount()}>Eliminar definitivamente mi cuenta</button>
      </section>}
      {deleteMessage && <p className="form-message" role="status" aria-live="polite">{deleteMessage}</p>}
      {deleteCleanupPending && <button className="secondary-button" disabled={busy} onClick={() => void retryDeletedAccountCleanup()}>Reintentar limpieza local</button>}
    </section>
  </SettingsDialog>;
}

function snapshotsMatch(left: Snapshot, right: Snapshot) {
  return JSON.stringify(normalizeSnapshot(left)) === JSON.stringify(normalizeSnapshot(right));
}

function normalizeSnapshot(snapshot: Snapshot) {
  return {
    ...snapshot,
    providers: [...snapshot.providers].sort((left, right) => left.id.localeCompare(right.id)),
  };
}
