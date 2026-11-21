import { useEffect, useMemo, useRef, useState } from "react";

export type PaletteCommand = { id: string; command: string; shell: string; terminalId: string };
export type PaletteAction = { id: string; label: string; description: string; run: () => void };

type CommandPaletteProps = {
  commands: PaletteCommand[];
  actions: PaletteAction[];
  view?: "all" | "history";
  onClose: () => void;
};

export function CommandPalette({ commands, actions, view = "all", onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const [manualCopyCommand, setManualCopyCommand] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const filteredActions = useMemo(() => view === "history" ? [] : actions.filter((action) =>
    `${action.label} ${action.description}`.toLocaleLowerCase("es").includes(normalizedQuery)), [actions, normalizedQuery, view]);
  const filteredCommands = useMemo(() => [...commands].reverse().filter((item) =>
    `${item.command} ${item.shell}`.toLocaleLowerCase("es").includes(normalizedQuery)).slice(0, 20), [commands, normalizedQuery]);
  const resultCount = filteredActions.length + filteredCommands.length;

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSelectedIndex(0); }, [normalizedQuery]);
  useEffect(() => {
    document.getElementById(`palette-result-${selectedIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (resultCount > 0) {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setSelectedIndex((current) => (current + direction + resultCount) % resultCount);
      }
      return;
    }
    if (event.key !== "Enter" || resultCount === 0) return;
    event.preventDefault();
    if (selectedIndex < filteredActions.length) {
      filteredActions[selectedIndex].run();
      onClose();
      return;
    }
    const commandIndex = selectedIndex - filteredActions.length;
    const command = filteredCommands[commandIndex];
    if (command) void copyCommand(command);
  }

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
      <h2 id="palette-title" className="sr-only">{view === "history" ? "Historial de comandos" : "Paleta de comandos"}</h2>
      <label className="palette-search"><span aria-hidden="true">⌕</span><input ref={inputRef} role="combobox" aria-expanded={resultCount > 0} aria-controls="palette-results" aria-activedescendant={resultCount > 0 ? `palette-result-${selectedIndex}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setNotice(""); }} onKeyDown={handleSearchKeyDown} placeholder={view === "history" ? "Buscar comandos recientes…" : "Buscar acciones e historial…"} aria-label={view === "history" ? "Buscar comandos recientes" : "Buscar acciones e historial"} /><kbd>↑ ↓ · Enter · Esc</kbd></label>
      <div className="palette-results" id="palette-results">
        {filteredActions.length > 0 && <>
          <p className="palette-group-label">ACCIONES</p>
          {filteredActions.map((action, index) => <button className="palette-result" data-selected={selectedIndex === index} id={`palette-result-${index}`} key={action.id} onMouseEnter={() => setSelectedIndex(index)} onClick={() => { action.run(); onClose(); }}><span className="palette-result-icon">↗</span><span><strong>{action.label}</strong><small>{action.description}</small></span><kbd>↵</kbd></button>)}
        </>}
        {filteredCommands.length > 0 && <>
          <p className="palette-group-label">COMANDOS RECIENTES <span>Solo en esta sesión</span></p>
          {filteredCommands.map((item, index) => {
            const resultIndex = filteredActions.length + index;
            return <button className="palette-result palette-command" data-selected={selectedIndex === resultIndex} id={`palette-result-${resultIndex}`} key={item.id} onMouseEnter={() => setSelectedIndex(resultIndex)} onClick={() => void copyCommand(item)}><span className="palette-result-icon">&gt;_</span><span><code>{item.command}</code><small>{item.shell} · Copiar para revisar y pegar</small></span><kbd>⧉</kbd></button>;
          })}
        </>}
        {filteredActions.length === 0 && filteredCommands.length === 0 && <p className="palette-empty">{view === "history" && !query.trim() ? "Todavía no hay comandos recientes en esta sesión." : `No hay resultados para «${query}».`}</p>}
      </div>
      <footer className="palette-footer"><span>{notice || "Los comandos no se ejecutan desde esta paleta."}{manualCopyCommand && <code className="palette-fallback-command">{manualCopyCommand}</code>}</span><button onClick={onClose}>Cerrar</button></footer>
    </section>
  </div>;
}
