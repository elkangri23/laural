import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { themes } from "../themes";
import { ModalShell } from "./ModalShell";
import { useLanguage } from "../i18n";

type TransferPreferences = {
  themeId: string;
  appearance: "dark" | "light";
  updateMode: "manual" | "automatic";
  language?: "es" | "en";
};

type TransferPreview = {
  preferences: TransferPreferences;
  activeProviderId: string | null;
  providers: Array<{ id: string; providerKind: string; name: string; baseUrl: string; model: string; hasApiKey: boolean; shareCustomEndpoint: boolean }>;
  containsApiKeys: boolean;
};

export type ConfigurationImportResult = {
  preferences: TransferPreferences & { language: "es" | "en" };
  activeProvider: { id: string; providerKind: string; name: string; baseUrl: string; model: string; hasApiKey: boolean; shareCustomEndpoint: boolean } | null;
  providers: Array<{ id: string; providerKind: string; name: string; baseUrl: string; model: string; hasApiKey: boolean; shareCustomEndpoint: boolean }>;
  backupPath: string;
  backupEncrypted: boolean;
  backupContainsApiKeys: boolean;
};

export function ConfigurationTransfer({
  preferences,
  onClose,
  onImported,
}: {
  preferences: TransferPreferences;
  onClose: () => void;
  onImported: (result: ConfigurationImportResult) => void;
}) {
  const { messages } = useLanguage();
  const transferText = messages.transfer;
  const [includeApiKeys, setIncludeApiKeys] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportConfirmation, setExportConfirmation] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [strategy, setStrategy] = useState<"merge" | "replace">("merge");
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function exportSettings() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (includeApiKeys && exportPassword !== exportConfirmation) {
        throw new Error(transferText.mismatch);
      }
      if (includeApiKeys && exportPassword.trim().length < 12) {
        throw new Error(transferText.weakPassword);
      }
      const destination = await save({
        defaultPath: transferText.defaultFileName,
        filters: [{ name: transferText.fileType, extensions: ["laural"] }],
      });
      if (!destination) return;
      await invoke("export_configuration", {
        destination,
        preferences,
        includeApiKeys,
        password: includeApiKeys ? exportPassword : null,
      });
      setNotice(includeApiKeys
        ? transferText.exportWithKeys
        : transferText.exportWithoutKeys);
      setExportPassword("");
      setExportConfirmation("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function chooseImportFile() {
    setError("");
    setNotice("");
    setPreview(null);
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: transferText.fileType, extensions: ["laural"] }],
    });
    if (typeof selected === "string") setSourcePath(selected);
  }

  async function previewImport() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await invoke<TransferPreview>("preview_configuration", {
        source: sourcePath,
        password: importPassword || null,
      });
      if (!themes.some((theme) => theme.id === result.preferences.themeId)) {
        throw new Error(transferText.unknownTheme);
      }
      setPreview(result);
    } catch (reason) {
      setPreview(null);
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      localStorage.setItem("laural.transfer-check", "ok");
      localStorage.removeItem("laural.transfer-check");
      const result = await invoke<ConfigurationImportResult>("import_configuration", {
        source: sourcePath,
        password: importPassword || null,
        strategy,
        currentPreferences: preferences,
      });
      if (!themes.some((theme) => theme.id === result.preferences.themeId)) {
        throw new Error(transferText.unavailableTheme);
      }
      onImported(result);
      setImportPassword("");
      setPreview(null);
      setSourcePath("");
      setNotice(`${transferText.importedBackup} ${result.backupEncrypted ? transferText.encryptedBackup : transferText.clearBackup}: ${result.backupPath}`);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return <ModalShell onClose={onClose} title={transferText.title}>
    <section className="transfer-settings" aria-labelledby="transfer-title">
      <p className="eyebrow">{transferText.eyebrow}</p>
      <h3 id="transfer-title">{transferText.heading}</h3>
      <p className="dialog-copy">{transferText.introduction}</p>

      <div className="transfer-card">
        <strong>{transferText.export}</strong>
        <label className="transfer-check"><input type="checkbox" checked={includeApiKeys} onChange={(event) => setIncludeApiKeys(event.currentTarget.checked)} /> {transferText.includeApiKeys}</label>
        {includeApiKeys && <>
          <p className="transfer-security-note">{transferText.encryptionNote}</p>
          <label className="form-label">{transferText.filePassword}
            <input type="password" autoComplete="new-password" value={exportPassword} onChange={(event) => setExportPassword(event.currentTarget.value)} />
          </label>
          <label className="form-label">{transferText.repeatPassword}
            <input type="password" autoComplete="new-password" value={exportConfirmation} onChange={(event) => setExportConfirmation(event.currentTarget.value)} />
          </label>
        </>}
        <button className="primary-button" onClick={() => void exportSettings()} disabled={busy}>{busy ? transferText.preparing : transferText.exportFile}</button>
      </div>

      <div className="transfer-card">
        <strong>{transferText.import}</strong>
        <button className="secondary-button" onClick={() => void chooseImportFile()} disabled={busy}>{sourcePath ? transferText.chooseOtherFile : transferText.chooseFile}</button>
        {sourcePath && <span className="transfer-file-name">{sourcePath.split(/[\\/]/).pop()}</span>}
        <label className="form-label">{transferText.protectedPassword}
          <input type="password" autoComplete="current-password" value={importPassword} onChange={(event) => { setImportPassword(event.currentTarget.value); setPreview(null); }} />
        </label>
        {sourcePath && <button className="secondary-button" onClick={() => void previewImport()} disabled={busy}>{transferText.validatePreview}</button>}
        {preview && <>
          <div className="transfer-preview" role="status">
            <strong>{transferText.preview}</strong>
            <span>{themes.find((theme) => theme.id === preview.preferences.themeId)?.name} · {preview.preferences.appearance === "dark" ? transferText.dark : transferText.light}</span>
            <span>{preview.providers.length} {transferText.providerProfiles} · {preview.containsApiKeys ? transferText.encryptedKeys : transferText.noKeys}</span>
            {preview.providers.map((provider) => <span key={provider.id}>{provider.name} · {provider.model} · {provider.baseUrl}{provider.hasApiKey ? ` · ${transferText.includedKey}` : ""}</span>)}
          </div>
          <label className="form-label">{transferText.profileImport}
            <select value={strategy} onChange={(event) => setStrategy(event.currentTarget.value as "merge" | "replace")}>
              <option value="merge">{transferText.merge}</option>
              <option value="replace">{transferText.replace}</option>
            </select>
          </label>
          {strategy === "replace" && <p className="transfer-security-note">{transferText.replaceWarning}</p>}
          <button className="primary-button" onClick={() => void applyImport()} disabled={busy}>{busy ? transferText.importing : transferText.applyImport}</button>
        </>}
      </div>

      {error && <p className="form-message error" role="alert">{error}</p>}
      {notice && <p className="form-message success" role="status">{notice}</p>}
    </section>
  </ModalShell>;
}
