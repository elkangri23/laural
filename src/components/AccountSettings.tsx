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

  useEffect(() => setRiskAcknowledged(syncRiskAcknowledged), [syncRiskAcknowledged]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<AuthStatus>("account-auth-status", ({ payload }) => {
      if (disposed) return;
      setBusy(payload.status === "waiting");
      if (payload.status === "signed_in") {
        setConnected(true);
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

  async function removeLocalSession() {
    setBusy(true);
    try {
      await invoke("clear_account_session");
      setConnected(false);
      setMessage("Se quitó la sesión guardada en este equipo. El servidor puede aceptarla hasta que caduque; la revocación remota está pendiente.");
    } catch {
      setMessage("No se pudo quitar la sesión del almacén seguro de Windows.");
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
        </>
        : <button className="primary-button" onClick={() => void beginLogin()} disabled={busy || !listenerReady || !sessionReady}>{busy ? "Esperando en el navegador…" : "Iniciar sesión"}</button>}
      {connected && <p className="dialog-copy account-note">Solo se sincronizan las preferencias permitidas y los perfiles de proveedor. Las claves API permanecen en el almacén seguro de este equipo. Los endpoints personalizados solo se incluyen si activaste compartirlos en cada perfil.</p>}
      {connected && <p className="dialog-copy account-note">Al quitar la cuenta aquí, el servidor puede mantener la sesión válida hasta 30 días; la revocación remota se añadirá en otra etapa.</p>}
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
