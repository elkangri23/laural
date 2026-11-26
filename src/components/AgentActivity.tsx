import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../i18n";

type ActivityEntry = {
  timestampMs: number;
  action: string;
  outcome: string;
};

export function AgentActivity() {
  const { language, messages } = useLanguage();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  async function refresh() {
    try {
      setEntries(await invoke<ActivityEntry[]>("get_agent_activity"));
      setError("");
    } catch {
      setError(messages.activity.loadError);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function clear() {
    try {
      await invoke("clear_agent_activity");
      setEntries([]);
      setError("");
    } catch {
      setError(messages.activity.clearError);
    }
    setConfirmClear(false);
  }

  return <section className="agent-activity" aria-labelledby="agent-activity-title">
    <div className="agent-activity-heading">
      <strong id="agent-activity-title">{messages.activity.title}</strong>
      <button className="action-quiet" onClick={() => void refresh()}>{messages.activity.refresh}</button>
    </div>
    <p>{messages.activity.description}</p>
    {error && <p role="status" className="policy-notice">{error}</p>}
    {entries.length === 0 ? <p className="agent-activity-empty">{messages.activity.empty}</p> : <ol className="agent-activity-list" aria-label={messages.activity.latest}>
      {entries.map((entry, index) => <li key={`${entry.timestampMs}-${index}`}>
        <span>{activityActionLabel(entry.action, messages.activity.actions)}<small>{entry.outcome}</small></span>
        <ActivityTime timestamp={entry.timestampMs} language={language} invalidTime={messages.activity.invalidTime} />
      </li>)}
    </ol>}
    {confirmClear ? <div className="agent-activity-confirm" role="group" aria-label={messages.activity.confirmClear}>
      <span>{messages.activity.confirmClear}</span>
      <button className="action-quiet" onClick={() => setConfirmClear(false)}>{messages.activity.cancel}</button>
      <button className="action-quiet" onClick={() => void clear()}>{messages.activity.confirm}</button>
    </div> : <button className="action-quiet" onClick={() => setConfirmClear(true)} disabled={entries.length === 0 && !error}>{messages.activity.clear}</button>}
  </section>;
}

function activityActionLabel(action: string, labels: { command: string; file: string; restore: string; cleanup: string; other: string }) {
  const key = action === "comando" ? "command" : action === "archivo" ? "file" : action === "restauración" ? "restore" : action === "limpieza de copias" ? "cleanup" : "other";
  return labels[key];
}

function ActivityTime({ timestamp, language, invalidTime }: { timestamp: number; language: string; invalidTime: string }) {
  const date = new Date(timestamp);
  const iso = Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  return <time dateTime={iso}>{iso ? date.toLocaleString(language) : invalidTime}</time>;
}
