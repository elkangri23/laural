import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../i18n";

type GitStatus = { root: string; branch: string; changes: { code: string; path: string }[] };
type GitDiff = { content: string; truncated: boolean };

export function GitPanel({ projectPath, onClose, onOpenProject, onIncludeDiff }: { projectPath: string | null; onClose: () => void; onOpenProject: () => void; onIncludeDiff: (content: string, truncated: boolean) => void }) {
  const { messages } = useLanguage();
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
      setError(typeof reason === "string" ? reason : messages.git.readError);
    } finally {
      setBusy(false);
    }
  }, [messages.git.readError, projectPath]);

  useEffect(() => {
    dialogRef.current?.focus();
    void refresh();
  }, [refresh]);

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="git-panel-dialog" role="dialog" aria-modal="true" aria-labelledby="git-panel-title" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <header className="git-panel-header">
        <div><p className="eyebrow">{messages.git.project}</p><h2 id="git-panel-title">{messages.git.title}</h2></div>
        <div className="git-panel-actions"><button className="small-action" onClick={() => void refresh()} disabled={!projectPath || busy}>{busy ? messages.git.refreshing : messages.git.refresh}</button><button className="dialog-close" onClick={onClose} aria-label={messages.git.close}>×</button></div>
      </header>
      {projectPath ? <>
        <p className="git-panel-root" title={status?.root ?? projectPath}>{status?.root ?? projectPath}</p>
        {error && <p className="git-panel-error" role="alert">{error}</p>}
        {status && <>
          <div className="git-branch-row"><span>{messages.git.branch}</span><code>{status.branch || messages.git.detached}</code><span className="git-change-count">{messages.git.changes.replace("{count}", String(status.changes.length))}</span></div>
          <div className="git-changes" aria-label={messages.git.files}>
            {status.changes.length === 0 ? <p className="git-empty">{messages.git.clean}</p> : status.changes.map((change, index) => <div className="git-change" key={`${change.code}-${change.path}-${index}`}><code>{change.code || "M"}</code><span title={change.path}>{change.path}</span></div>)}
          </div>
        </>}
        <section className="git-diff-section"><div className="git-diff-heading"><h3>{messages.git.diff}</h3><span>{messages.git.readOnly}</span></div>
          {diff?.truncated && <p className="git-panel-warning">{messages.git.largeDiff}</p>}
          {diff ? <pre className="git-diff-content">{diff.content || messages.git.noDiff}</pre> : !error && <p className="git-empty">{messages.git.loading}</p>}
          {diff?.content && <button className="action-primary git-include-diff" onClick={() => onIncludeDiff(diff.content, diff.truncated)}>{messages.git.includeDiff}</button>}
        </section>
        <p className="git-panel-note">{messages.git.note}</p>
      </> : <div className="git-no-project"><p>{messages.git.noProject}</p><button className="action-primary" onClick={onOpenProject}>{messages.git.openProject}</button></div>}
    </section>
  </div>;
}
