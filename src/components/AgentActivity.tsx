import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type ActivityEntry = {
  timestampMs: number;
  action: string;
  outcome: string;
};

const actionLabels: Record<string, string> = {
  comando: "Comando del agente",
  archivo: "Cambio de archivo",
  restauración: "Restauración de archivo",
  "limpieza de copias": "Limpieza de copias",
};

export function AgentActivity() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  async function refresh() {
    try {
      setEntries(await invoke<ActivityEntry[]>("get_agent_activity"));
      setError("");
    } catch {
      setError("No se pudo cargar el historial local.");
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
      setError("No se pudo borrar el historial local.");
    }
    setConfirmClear(false);
  }

  return <section className="agent-activity" aria-labelledby="agent-activity-title">
    <div className="agent-activity-heading">
      <strong id="agent-activity-title">Actividad del agente</strong>
      <button className="action-quiet" onClick={() => void refresh()}>Actualizar</button>
    </div>
    <p>Registro local acotado. Guarda el tipo de acción, el resultado y la hora; nunca comandos, rutas, prompts, salida de terminal ni claves.</p>
    {error && <p role="status" className="policy-notice">{error}</p>}
    {entries.length === 0 ? <p className="agent-activity-empty">Todavía no hay actividad registrada.</p> : <ol className="agent-activity-list" aria-label="Últimos eventos del agente">
      {entries.map((entry, index) => <li key={`${entry.timestampMs}-${index}`}>
        <span>{actionLabels[entry.action] ?? "Acción del agente"}<small>{entry.outcome}</small></span>
        <ActivityTime timestamp={entry.timestampMs} />
      </li>)}
    </ol>}
    {confirmClear ? <div className="agent-activity-confirm" role="group" aria-label="Confirmar borrado del historial">
      <span>¿Borrar el historial de actividad?</span>
      <button className="action-quiet" onClick={() => setConfirmClear(false)}>Cancelar</button>
      <button className="action-quiet" onClick={() => void clear()}>Sí, borrar</button>
    </div> : <button className="action-quiet" onClick={() => setConfirmClear(true)} disabled={entries.length === 0 && !error}>Borrar historial</button>}
  </section>;
}

function ActivityTime({ timestamp }: { timestamp: number }) {
  const date = new Date(timestamp);
  const iso = Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  return <time dateTime={iso}>{iso ? date.toLocaleString() : "Hora no válida"}</time>;
}
