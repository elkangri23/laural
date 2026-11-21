import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { themes } from "../themes";
import { SettingsDialog } from "./SettingsDialog";

type TransferPreferences = {
  themeId: string;
  appearance: "dark" | "light";
  updateMode: "manual" | "automatic";
};

type TransferPreview = {
  preferences: TransferPreferences;
  activeProviderId: string | null;
  providers: Array<{ id: string; name: string; baseUrl: string; model: string; hasApiKey: boolean }>;
  containsApiKeys: boolean;
};

export type ConfigurationImportResult = {
  preferences: TransferPreferences;
  activeProvider: { id: string; name: string; baseUrl: string; model: string; hasApiKey: boolean } | null;
  providers: Array<{ id: string; name: string; baseUrl: string; model: string; hasApiKey: boolean }>;
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
        throw new Error("Las contraseñas no coinciden.");
      }
      if (includeApiKeys && exportPassword.trim().length < 12) {
        throw new Error("Usa una contraseña de al menos 12 caracteres para cifrar las claves.");
      }
      const destination = await save({
        defaultPath: "Laural-configuracion.laural",
        filters: [{ name: "Configuración de Laural", extensions: ["laural"] }],
      });
      if (!destination) return;
      await invoke("export_configuration", {
        destination,
        preferences,
        includeApiKeys,
        password: includeApiKeys ? exportPassword : null,
      });
      setNotice(includeApiKeys
        ? "Configuración exportada. Las claves están cifradas con tu contraseña."
        : "Configuración exportada sin incluir claves API.");
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
      filters: [{ name: "Configuración de Laural", extensions: ["laural"] }],
    });
    if (typeof selected === "string") setSourcePath(selected);
  }

  async function previewImport() {
    if (!sourcePath) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await invoke<TransferPreview>("preview_configuration", {
        source: sourcePath,
        password: importPassword || null,
      });
      if (!themes.some((theme) => theme.id === result.preferences.themeId)) {
        throw new Error("El archivo usa un tema que esta versión de Laural no reconoce.");
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
    if (!preview || !sourcePath) return;
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
        throw new Error("El tema importado no está disponible en esta versión.");
      }
      onImported(result);
      setImportPassword("");
      setPreview(null);
      setSourcePath("");
      setNotice(`Configuración importada. Copia previa${result.backupEncrypted ? " cifrada con la misma contraseña del archivo" : " sin claves API"}: ${result.backupPath}`);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return <SettingsDialog onClose={onClose}>
    <section className="transfer-settings" aria-labelledby="transfer-title">
      <p className="eyebrow">PORTABILIDAD LOCAL</p>
      <h3 id="transfer-title">Exportar e importar configuración</h3>
      <p className="dialog-copy">El archivo contiene preferencias y perfiles de proveedor. No incluye chats, terminales, proyectos ni reglas del agente.</p>

      <div className="transfer-card">
        <strong>Exportar</strong>
        <label className="transfer-check"><input type="checkbox" checked={includeApiKeys} onChange={(event) => setIncludeApiKeys(event.currentTarget.checked)} /> Incluir claves API</label>
        {includeApiKeys && <>
          <p className="transfer-security-note">Las claves nunca se exportan en texto plano. Guárdalas con una contraseña que puedas recordar; Laural no podrá recuperarla.</p>
          <label className="form-label">Contraseña del archivo
            <input type="password" autoComplete="new-password" value={exportPassword} onChange={(event) => setExportPassword(event.currentTarget.value)} />
          </label>
          <label className="form-label">Repite la contraseña
            <input type="password" autoComplete="new-password" value={exportConfirmation} onChange={(event) => setExportConfirmation(event.currentTarget.value)} />
          </label>
        </>}
        <button className="primary-button" onClick={() => void exportSettings()} disabled={busy}>{busy ? "Preparando…" : "Exportar archivo"}</button>
      </div>

      <div className="transfer-card">
        <strong>Importar</strong>
        <button className="secondary-button" onClick={() => void chooseImportFile()} disabled={busy}>{sourcePath ? "Elegir otro archivo" : "Elegir archivo .laural"}</button>
        {sourcePath && <span className="transfer-file-name">{sourcePath.split(/[\\/]/).pop()}</span>}
        <label className="form-label">Contraseña del archivo, si está protegido
          <input type="password" autoComplete="current-password" value={importPassword} onChange={(event) => { setImportPassword(event.currentTarget.value); setPreview(null); }} />
        </label>
        {sourcePath && <button className="secondary-button" onClick={() => void previewImport()} disabled={busy}>Validar y previsualizar</button>}
        {preview && <>
          <div className="transfer-preview" role="status">
            <strong>Vista previa</strong>
            <span>{themes.find((theme) => theme.id === preview.preferences.themeId)?.name} · {preview.preferences.appearance === "dark" ? "Oscuro" : "Claro"}</span>
            <span>{preview.providers.length} perfiles de proveedor · {preview.containsApiKeys ? "incluye claves cifradas" : "sin claves"}</span>
            {preview.providers.map((provider) => <span key={provider.id}>{provider.name} · {provider.model} · {provider.baseUrl}{provider.hasApiKey ? " · clave incluida" : ""}</span>)}
          </div>
          <label className="form-label">Importación de perfiles
            <select value={strategy} onChange={(event) => setStrategy(event.currentTarget.value as "merge" | "replace")}>
              <option value="merge">Fusionar perfiles</option>
              <option value="replace">Reemplazar perfiles guardados</option>
            </select>
          </label>
          {strategy === "replace" && <p className="transfer-security-note">Los perfiles que no estén en el archivo se quitarán. Las claves afectadas necesitan una copia protegida antes del cambio.</p>}
          <button className="primary-button" onClick={() => void applyImport()} disabled={busy}>{busy ? "Importando…" : "Aplicar importación"}</button>
        </>}
      </div>

      {error && <p className="form-message error" role="alert">{error}</p>}
      {notice && <p className="form-message success" role="status">{notice}</p>}
    </section>
  </SettingsDialog>;
}
