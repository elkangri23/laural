import { getVersion } from "@tauri-apps/api/app";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { ModalShell } from "./ModalShell";
import { useLanguage } from "../i18n";

type UpdateMode = "manual" | "automatic";
type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";
const PREFERENCE_KEY = "laural.update-mode.v1";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function readMode(): UpdateMode | null {
  const saved = localStorage.getItem(PREFERENCE_KEY);
  return saved === "manual" || saved === "automatic" ? saved : null;
}

export function formatDownloadProgress(downloaded: number, total: number | null, language: "es" | "en" = "es"): string {
  if (total === null || total <= 0) return `${Math.round(downloaded / 1024)} ${language === "en" ? "KB downloaded" : "KB descargados"}`;
  return `${Math.min(100, Math.round((downloaded / total) * 100))}%`;
}

export function UpdateManager({ settingsOpen, onSettingsOpen, onSettingsClose }: { settingsOpen: boolean; onSettingsOpen: () => void; onSettingsClose: () => void }) {
  const { language, messages } = useLanguage();
  const updateText = messages.updates;
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
    window.dispatchEvent(new Event("laural:update-mode-changed"));
  }, []);

  const installAvailable = useCallback(async (update: Update) => {
    setStatus("installing");
    setMessage(updateText.installing);
    await update.install({ restartAfterInstall: true });
  }, [updateText.installing]);

  const downloadUpdate = useCallback(async (update: Update, automatic: boolean) => {
    setStatus("downloading");
    setProgress("");
    setProgressValue(0);
    setMessage(automatic ? updateText.downloadingAutomatic : updateText.downloading);
    let downloaded = 0;
    let total: number | null = null;
    const onEvent = (event: DownloadEvent) => {
      if (event.event === "Started") total = event.data.contentLength ?? null;
      if (event.event === "Progress") downloaded += event.data.chunkLength;
      if (event.event !== "Finished") {
        setProgress(formatDownloadProgress(downloaded, total, language));
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
      setMessage(updateText.ready.replace("{version}", update.version));
    }
  }, [installAvailable, language, updateText.downloading, updateText.downloadingAutomatic, updateText.ready]);

  const checkForUpdates = useCallback(async (automatic = false) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setStatus("checking");
    setMessage(updateText.checking);
    try {
      const previous = updateRef.current;
      updateRef.current = null;
      if (previous) await previous.close();
      const update = await check({ timeout: 15_000 });
      if (!update) {
        setStatus("idle");
        setAvailableVersion("");
        setMessage(updateText.latest);
        return;
      }
      updateRef.current = update;
      setAvailableVersion(update.version);
      setStatus("available");
      setMessage(updateText.available.replace("{version}", update.version));
      if (automatic) await downloadUpdate(update, true);
    } catch {
      setStatus("error");
      setMessage(updateText.failedCheck);
    } finally {
      checkingRef.current = false;
    }
  }, [downloadUpdate, updateText.available, updateText.checking, updateText.failedCheck, updateText.latest]);

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => setVersion(updateText.developmentVersion));
  }, [updateText.developmentVersion]);

  useEffect(() => {
    const refreshPreference = () => setMode(readMode());
    window.addEventListener("laural:update-mode-changed", refreshPreference);
    return () => window.removeEventListener("laural:update-mode-changed", refreshPreference);
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
    {hasUpdate && !settingsOpen && <button className="update-notice" onClick={onSettingsOpen} aria-label={updateText.noticeA11y.replace("{version}", availableVersion)}>
      <span className="update-notice-dot" /> {updateText.noticePrefix} {status === "ready" ? updateText.noticeReady : updateText.noticeAvailable} · {availableVersion}
    </button>}
    {(settingsOpen || isFirstRun) && <ModalShell title={isFirstRun ? updateText.firstRunQuestion : updateText.title} onClose={() => { if (isFirstRun) chooseMode("manual"); else onSettingsClose(); }}>
      {isFirstRun ? <section className="update-settings" aria-labelledby="update-first-run-title">
        <p className="eyebrow">{updateText.firstRun}</p>
        <h3 id="update-first-run-title">{updateText.firstRunQuestion}</h3>
        <p className="dialog-copy">{updateText.firstRunIntro}</p>
        <button className="settings-link" onClick={() => chooseMode("manual")}>{updateText.manualChoice} <span>{updateText.recommended}</span></button>
        <button className="settings-link" onClick={() => chooseMode("automatic")}>{updateText.automaticChoice} <span>{updateText.mayCloseTerminals}</span></button>
        <p className="update-security-note">{updateText.signatureNote}</p>
      </section> : <section className="update-settings" aria-labelledby="update-settings-title">
        <p className="eyebrow">{updateText.application}</p>
        <h3 id="update-settings-title">{updateText.title}</h3>
        <p className="update-version">{updateText.installedVersion} <strong>{version}</strong></p>
        <label className="update-mode-label">{updateText.installMode}
          <select value={mode!} onChange={(event) => chooseMode(event.currentTarget.value as UpdateMode)}>
            <option value="manual">{updateText.manualChoice}</option>
            <option value="automatic">{updateText.automaticChoice}</option>
          </select>
        </label>
        {mode === "automatic" && <p className="update-security-note">{updateText.autoRestartWarning}</p>}
        <p className="update-message" role="status">{message || updateText.checkEverySixHours}</p>
        {progress && status === "downloading" && <progress className="update-progress" aria-label={updateText.downloadProgress.replace("{progress}", progress)} value={progressValue ?? undefined} max="100" />}
        <div className="update-actions">
          <button className="secondary-button" onClick={() => void checkForUpdates(mode === "automatic")} disabled={status === "checking" || status === "downloading" || status === "installing"}>{updateText.checkNow}</button>
          {status === "available" && <button className="primary-button" onClick={() => void downloadUpdate(updateRef.current!, false).catch(() => { setStatus("error"); setMessage(updateText.failedDownload); })}>{updateText.download.replace("{version}", availableVersion)}</button>}
          {status === "ready" && <button className="primary-button" onClick={() => void installAvailable(updateRef.current!).catch(() => { setStatus("error"); setMessage(updateText.failedInstaller); })}>{updateText.installRestart}</button>}
        </div>
      </section>}
    </ModalShell>}
  </>;
}
