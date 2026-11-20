import { getVersion } from "@tauri-apps/api/app";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { SettingsDialog } from "./SettingsDialog";

type UpdateMode = "manual" | "automatic";
type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";
const PREFERENCE_KEY = "laural.update-mode.v1";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function readMode(): UpdateMode | null {
  const saved = localStorage.getItem(PREFERENCE_KEY);
  return saved === "manual" || saved === "automatic" ? saved : null;
}

export function formatDownloadProgress(downloaded: number, total: number | null): string {
  if (total === null || total <= 0) return `${Math.round(downloaded / 1024)} KB descargados`;
  return `${Math.min(100, Math.round((downloaded / total) * 100))}%`;
}

export function UpdateManager({ settingsOpen, onSettingsOpen, onSettingsClose }: { settingsOpen: boolean; onSettingsOpen: () => void; onSettingsClose: () => void }) {
  const [mode, setMode] = useState<UpdateMode | null>(readMode);
  const [version, setVersion] = useState("…");
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [availableVersion, setAvailableVersion] = useState("");
  const [progress, setProgress] = useState("");
  const [progressValue, setProgressValue] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const updateRef = useRef<Update | null>(null);
  const checkingRef = useRef(false);

  const chooseMode = useCallback((next: UpdateMode) => {
    localStorage.setItem(PREFERENCE_KEY, next);
    setMode(next);
  }, []);

  const installAvailable = useCallback(async (update: Update) => {
    setStatus("installing");
    setMessage("La app se cerrará para aplicar la actualización y volverá a abrirse.");
    await update.install({ restartAfterInstall: true });
  }, []);

  const downloadUpdate = useCallback(async (update: Update, automatic: boolean) => {
    setStatus("downloading");
    setProgress("");
    setProgressValue(0);
    setMessage(automatic ? "Descargando e instalando la actualización automáticamente…" : "Descargando actualización…");
    let downloaded = 0;
    let total: number | null = null;
    const onEvent = (event: DownloadEvent) => {
      if (event.event === "Started") total = event.data.contentLength ?? null;
      if (event.event === "Progress") downloaded += event.data.chunkLength;
      if (event.event !== "Finished") {
        setProgress(formatDownloadProgress(downloaded, total));
        setProgressValue(total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null);
      }
    };
    await update.download(onEvent);
    setProgress("100%");
    setProgressValue(100);
    if (automatic) {
      await installAvailable(update);
    } else {
      setStatus("ready");
      setMessage(`La versión ${update.version} está lista para instalar.`);
    }
  }, [installAvailable]);

  const checkForUpdates = useCallback(async (automatic = false) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setStatus("checking");
    setMessage("Buscando actualizaciones…");
    try {
      const previous = updateRef.current;
      updateRef.current = null;
      if (previous) await previous.close();
      const update = await check({ timeout: 15_000 });
      if (!update) {
        setStatus("idle");
        setAvailableVersion("");
        setMessage("Tienes la versión más reciente.");
        return;
      }
      updateRef.current = update;
      setAvailableVersion(update.version);
      setStatus("available");
      setMessage(`Hay una actualización disponible: ${update.version}.`);
      if (automatic) await downloadUpdate(update, true);
    } catch {
      setStatus("error");
      setMessage("No se pudo comprobar o descargar la actualización. Comprueba la conexión e inténtalo de nuevo.");
    } finally {
      checkingRef.current = false;
    }
  }, [downloadUpdate]);

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => setVersion("Desarrollo"));
  }, []);

  useEffect(() => {
    if (!mode) return;
    void checkForUpdates(mode === "automatic");
    const timer = window.setInterval(() => void checkForUpdates(mode === "automatic"), CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [checkForUpdates, mode]);

  useEffect(() => () => {
    const update = updateRef.current;
    if (update) void update.close();
  }, []);

  const hasUpdate = status === "available" || status === "downloading" || status === "ready" || status === "installing";
  const isFirstRun = mode === null;

  return <>
    {hasUpdate && !settingsOpen && <button className="update-notice" onClick={onSettingsOpen} aria-label={`Actualización disponible, versión ${availableVersion}`}>
      <span className="update-notice-dot" /> Actualización {status === "ready" ? "lista" : "disponible"} · {availableVersion}
    </button>}
    {(settingsOpen || isFirstRun) && <SettingsDialog onClose={() => { if (isFirstRun) chooseMode("manual"); else onSettingsClose(); }}>
      {isFirstRun ? <section className="update-settings" aria-labelledby="update-first-run-title">
        <p className="eyebrow">PRIMER INICIO</p>
        <h3 id="update-first-run-title">¿Cómo quieres recibir actualizaciones?</h3>
        <p className="dialog-copy">Laural consulta las publicaciones oficiales de GitHub cada seis horas. La primera comprobación se realiza al abrir la aplicación.</p>
        <button className="settings-link" onClick={() => chooseMode("manual")}>Avisarme y decidir cuándo instalar <span>Recomendado</span></button>
        <button className="settings-link" onClick={() => chooseMode("automatic")}>Descargar e instalar automáticamente <span>Puede cerrar terminales abiertas</span></button>
        <p className="update-security-note">Las descargas se verifican con firma criptográfica antes de instalarse.</p>
      </section> : <section className="update-settings" aria-labelledby="update-settings-title">
        <p className="eyebrow">APLICACIÓN</p>
        <h3 id="update-settings-title">Actualizaciones</h3>
        <p className="update-version">Versión instalada <strong>{version}</strong></p>
        <label className="update-mode-label">Instalación de actualizaciones
          <select value={mode ?? "manual"} onChange={(event) => chooseMode(event.currentTarget.value as UpdateMode)}>
            <option value="manual">Avisarme y decidir cuándo instalar</option>
            <option value="automatic">Descargar e instalar automáticamente</option>
          </select>
        </label>
        {mode === "automatic" && <p className="update-security-note">La instalación automática cierra Laural y reinicia la app; guarda el trabajo de tus terminales antes de dejarla activa.</p>}
        <p className="update-message" role="status">{message || "Las actualizaciones se consultan cada seis horas."}</p>
        {progress && status === "downloading" && <progress className="update-progress" aria-label={`Progreso de descarga: ${progress}`} value={progressValue ?? undefined} max="100" />}
        <div className="update-actions">
          <button className="secondary-button" onClick={() => void checkForUpdates(false)} disabled={status === "checking" || status === "downloading" || status === "installing"}>Buscar ahora</button>
          {status === "available" && <button className="primary-button" onClick={() => { const update = updateRef.current; if (update) void downloadUpdate(update, false).catch(() => { setStatus("error"); setMessage("No se pudo descargar la actualización."); }); }}>Descargar {availableVersion}</button>}
          {status === "ready" && <button className="primary-button" onClick={() => { const update = updateRef.current; if (update) void installAvailable(update).catch(() => { setStatus("error"); setMessage("No se pudo iniciar el instalador."); }); }}>Instalar y reiniciar</button>}
        </div>
      </section>}
    </SettingsDialog>}
  </>;
}
