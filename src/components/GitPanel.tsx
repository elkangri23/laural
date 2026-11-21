import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type GitStatus = { root: string; branch: string; changes: { code: string; path: string }[] };
type GitDiff = { content: string; truncated: boolean };

export function GitPanel({ projectPath, onClose, onOpenProject, onIncludeDiff }: { projectPath: string | null; onClose: () => void; onOpenProject: () => void; onIncludeDiff: (content: string, truncated: boolean) => void }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    setBusy(true);
    setError("");
    try {
      const [nextStatus, nextDiff] = await Promise.all([
        invoke<GitStatus>("get_git_status", { projectPath }),
        invoke<GitDiff>("get_git_diff", { projectPath }),
      ]);
      setStatus(nextStatus);
      setDiff(nextDiff);
    } catch (reason) {
      setStatus(null);
      setDiff(null);
      setError(typeof reason === "string" ? reason : "No se pudo leer el repositorio.");
    } finally {
      setBusy(false);
    }
  }, [projectPath]);

  useEffect(() => {
    dialogRef.current?.focus();
    void refresh();
  }, [refresh]);

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="git-panel-dialog" role="dialog" aria-modal="true" aria-labelledby="git-panel-title" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <header className="git-panel-header">
        <div><p className="eyebrow">PROYECTO</p><h2 id="git-panel-title">Panel Git</h2></div>
        <div className="git-panel-actions"><button className="small-action" onClick={() => void refresh()} disabled={!projectPath || busy}>{busy ? "Actualizando…" : "Actualizar"}</button><button className="dialog-close" onClick={onClose} aria-label="Cerrar panel Git">×</button></div>
      </header>
      {projectPath ? <>
        <p className="git-panel-root" title={status?.root ?? projectPath}>{status?.root ?? projectPath}</p>
        {error && <p className="git-panel-error" role="alert">{error}</p>}
        {status && <>
          <div className="git-branch-row"><span>Rama</span><code>{status.branch || "HEAD separado"}</code><span className="git-change-count">{status.changes.length} cambios</span></div>
          <div className="git-changes" aria-label="Archivos modificados">
            {status.changes.length === 0 ? <p className="git-empty">El repositorio está limpio.</p> : status.changes.map((change, index) => <div className="git-change" key={`${change.code}-${change.path}-${index}`}><code>{change.code || "M"}</code><span title={change.path}>{change.path}</span></div>)}
          </div>
        </>}
        <section className="git-diff-section"><div className="git-diff-heading"><h3>Diff</h3><span>Solo lectura</span></div>
          {diff?.truncated && <p className="git-panel-warning">El diff es grande; se muestra solo una parte.</p>}
          {diff ? <pre className="git-diff-content">{diff.content || "No hay cambios preparados ni sin preparar."}</pre> : !error && <p className="git-empty">Cargando cambios…</p>}
          {diff?.content && <button className="action-primary git-include-diff" onClick={() => onIncludeDiff(diff.content, diff.truncated)}>Incluir diff en el contexto</button>}
        </section>
        <p className="git-panel-note">Laural no modifica ni prepara archivos. El diff solo se comparte con el modelo si eliges incluirlo y enviar una consulta.</p>
      </> : <div className="git-no-project"><p>Abre una carpeta de proyecto para consultar su estado Git.</p><button className="action-primary" onClick={onOpenProject}>Abrir proyecto</button></div>}
    </section>
  </div>;
}
