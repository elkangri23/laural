import { useLanguage } from "../i18n";

type BackupRetentionControlProps = {
  value: number | null;
  onChange: (value: number | null) => void;
};

export function BackupRetentionControl({ value, onChange }: BackupRetentionControlProps) {
  const { messages } = useLanguage();
  return <>
    <label>{messages.backups.label}
      <select aria-label={messages.backups.aria} value={value ?? "none"} onChange={(event) => onChange(event.currentTarget.value === "none" ? null : Number(event.currentTarget.value))}>
        <option value="none">{messages.backups.unlimited}</option>
        {[5, 10, 20, 50, 100].map((count) => <option key={count} value={count}>{count} {messages.backups.count}</option>)}
      </select>
    </label>
    <p>{messages.backups.description}</p>
  </>;
}
