import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SettingsDialog } from "./SettingsDialog";

type AuthStatus = { status: "waiting" | "signed_in" | "error"; message: string };

export function AccountSettings({ onClose }: { onClose: () => void }) {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listenerReady, setListenerReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [message, setMessage] = useState("Comprobando la sesión local…");

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<AuthStatus>("account-auth-status", ({ payload }) => {
      if (disposed) return;
      setBusy(payload.status === "waiting");
      if (payload.status === "signed_in") setConnected(true);
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

  return <SettingsDialog onClose={onClose}>
    <section className="account-settings" aria-labelledby="account-settings-title">
      <p className="eyebrow">CUENTA</p>
      <h3 id="account-settings-title">Cuenta y sincronización</h3>
      <p className="dialog-copy">Conecta una cuenta desde el navegador. La sesión se guarda en el almacén seguro de Windows y nunca se entrega al WebView.</p>
      <p className="form-message" role="status" aria-live="polite">{message}</p>
      {connected
        ? <button className="secondary-button" onClick={() => void removeLocalSession()} disabled={busy}>Quitar cuenta de este equipo</button>
        : <button className="primary-button" onClick={() => void beginLogin()} disabled={busy || !listenerReady || !sessionReady}>{busy ? "Esperando en el navegador…" : "Iniciar sesión"}</button>}
      <p className="dialog-copy account-note">El servicio de cuentas aún está en preparación y no se ha publicado. La sincronización de preferencias tampoco está activa. Al quitar la cuenta aquí, el servidor puede mantener la sesión válida hasta 30 días; la revocación remota se añadirá en otra etapa.</p>
    </section>
  </SettingsDialog>;
}
