import type { ReactNode } from "react";
import { BackupRetentionControl } from "./BackupRetentionControl";
import { useLanguage } from "../i18n";

export type ExecutionMode = "review" | "rules" | "automatic";

type AgentSettingsProps = {
  mode: ExecutionMode;
  onModeChange: (mode: ExecutionMode) => void;
  rules: string;
  onRulesChange: (rules: string) => void;
  onSaveRules: () => void;
  backupRetention: number | null;
  onBackupRetentionChange: (days: number | null) => void;
  powerShellPredictionEnabled: boolean;
  onPowerShellPredictionChange: (enabled: boolean) => void;
  policyNotice: string;
  children?: ReactNode;
};

export function AgentSettings({
  mode,
  onModeChange,
  rules,
  onRulesChange,
  onSaveRules,
  backupRetention,
  onBackupRetentionChange,
  powerShellPredictionEnabled,
  onPowerShellPredictionChange,
  policyNotice,
  children,
}: AgentSettingsProps) {
  const { messages } = useLanguage();
  const text = messages.agentSettings;

  return (
    <div className="agent-settings-content">
      <div className="agent-policy-panel">
        <label>{text.permissions}
          <select value={mode} onChange={(event) => onModeChange(event.currentTarget.value as ExecutionMode)}>
            <option value="review">{text.review}</option>
            <option value="rules">{text.rules}</option>
            <option value="automatic">{text.automatic}</option>
          </select>
        </label>
        {mode === "rules" && <div className="rules-editor">
          <textarea value={rules} onChange={(event) => onRulesChange(event.currentTarget.value)} placeholder={text.rulesPlaceholder} aria-label={text.allowedCommands} rows={3} />
          <button type="button" onClick={onSaveRules}>{text.saveRules}</button>
        </div>}
        <BackupRetentionControl value={backupRetention} onChange={onBackupRetentionChange} />
        <label className="powershell-prediction-setting">
          <input type="checkbox" checked={powerShellPredictionEnabled} onChange={(event) => onPowerShellPredictionChange(event.currentTarget.checked)} />
          <span><strong>{text.predictionTitle}</strong><small>{text.predictionDescription}</small></span>
        </label>
        {policyNotice && <span className="policy-notice">{policyNotice}</span>}
        <p>{text.fileChangesApproval}</p>
        <p>{text.shellSafety}</p>
      </div>
      {children}
    </div>
  );
}
