import { useEffect, useMemo, useRef, useState } from "react";

export type PaletteCommand = { id: string; command: string; shell: string; terminalId: string };
export type PaletteAction = { id: string; label: string; description: string; run: () => void };

type CommandPaletteProps = {
  commands: PaletteCommand[];
  actions: PaletteAction[];
  onClose: () => void;
};

export function CommandPalette({ commands, actions, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [manualCopyCommand, setManualCopyCommand] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const filteredActions = useMemo(() => actions.filter((action) =>
    `${action.label} ${action.description}`.toLocaleLowerCase("es").includes(normalizedQuery)), [actions, normalizedQuery]);
  const filteredCommands = useMemo(() => [...commands].reverse().filter((item) =>
    `${item.command} ${item.shell}`.toLocaleLowerCase("es").includes(normalizedQuery)).slice(0, 20), [commands, normalizedQuery]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function copyCommand(item: PaletteCommand) {
    try {
      await navigator.clipboard.writeText(item.command);
      setManualCopyCommand("");
      setNotice("Comando copiado. Revísalo antes de pegarlo en la terminal.");
    } catch {
      setManualCopyCommand(item.command);
      setNotice("No se pudo acceder al portapapeles. Selecciona y copia el comando manualmente.");
    }
  }

  return <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="palette-title" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <h2 id="palette-title" className="sr-only">Paleta de comandos</h2>
      <label className="palette-search"><span aria-hidden="true">⌕</span><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setNotice(""); }} placeholder="Buscar acciones e historial…" aria-label="Buscar acciones e historial" /><kbd>Esc</kbd></label>
      <div className="palette-results">
        {filteredActions.length > 0 && <>
          <p className="palette-group-label">ACCIONES</p>
          {filteredActions.map((action) => <button className="palette-result" key={action.id} onClick={() => { action.run(); onClose(); }}><span className="palette-result-icon">↗</span><span><strong>{action.label}</strong><small>{action.description}</small></span><kbd>↵</kbd></button>)}
        </>}
        {filteredCommands.length > 0 && <>
          <p className="palette-group-label">COMANDOS RECIENTES <span>Solo en esta sesión</span></p>
          {filteredCommands.map((item) => <button className="palette-result palette-command" key={item.id} onClick={() => void copyCommand(item)}><span className="palette-result-icon">&gt;_</span><span><code>{item.command}</code><small>{item.shell} · Copiar para revisar y pegar</small></span><kbd>⧉</kbd></button>)}
        </>}
        {filteredActions.length === 0 && filteredCommands.length === 0 && <p className="palette-empty">No hay resultados para «{query}».</p>}
      </div>
      <footer className="palette-footer"><span>{notice || "Los comandos no se ejecutan desde esta paleta."}{manualCopyCommand && <code className="palette-fallback-command">{manualCopyCommand}</code>}</span><button onClick={onClose}>Cerrar</button></footer>
    </section>
  </div>;
}
