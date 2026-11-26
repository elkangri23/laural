import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "../i18n";

export type PaletteCommand = { id: string; command: string; shell: string; terminalId: string };
export type PaletteAction = { id: string; label: string; description: string; run: () => void };

type CommandPaletteProps = {
  commands: PaletteCommand[];
  actions: PaletteAction[];
  view?: "all" | "history";
  onClose: () => void;
};

export function CommandPalette({ commands, actions, view = "all", onClose }: CommandPaletteProps) {
  const { language, messages } = useLanguage();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const [manualCopyCommand, setManualCopyCommand] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase(language);
  const filteredActions = useMemo(() => view === "history" ? [] : actions.filter((action) =>
    `${action.label} ${action.description}`.toLocaleLowerCase(language).includes(normalizedQuery)), [actions, language, normalizedQuery, view]);
  const filteredCommands = useMemo(() => [...commands].reverse().filter((item) =>
    `${item.command} ${item.shell}`.toLocaleLowerCase(language).includes(normalizedQuery)).slice(0, 20), [commands, language, normalizedQuery]);
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
      setNotice(messages.palette.copied);
    } catch {
      setManualCopyCommand(item.command);
      setNotice(messages.palette.clipboardError);
    }
  }

  return <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="palette-title" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <h2 id="palette-title" className="sr-only">{view === "history" ? messages.palette.historyTitle : messages.palette.title}</h2>
      <label className="palette-search"><span aria-hidden="true">⌕</span><input ref={inputRef} role="combobox" aria-expanded={resultCount > 0} aria-controls="palette-results" aria-activedescendant={resultCount > 0 ? `palette-result-${selectedIndex}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setNotice(""); }} onKeyDown={handleSearchKeyDown} placeholder={view === "history" ? messages.palette.searchHistory : messages.palette.searchAll} aria-label={view === "history" ? messages.palette.searchHistory.replace("…", "") : messages.palette.searchAll.replace("…", "")} /><kbd>↑ ↓ · Enter · Esc</kbd></label>
      <div className="palette-results" id="palette-results">
        {filteredActions.length > 0 && <>
          <p className="palette-group-label">{messages.palette.actions}</p>
          {filteredActions.map((action, index) => <button className="palette-result" data-selected={selectedIndex === index} id={`palette-result-${index}`} key={action.id} onMouseEnter={() => setSelectedIndex(index)} onClick={() => { action.run(); onClose(); }}><span className="palette-result-icon">↗</span><span><strong>{action.label}</strong><small>{action.description}</small></span><kbd>↵</kbd></button>)}
        </>}
        {filteredCommands.length > 0 && <>
          <p className="palette-group-label">{messages.palette.recent} <span>{messages.palette.sessionOnly}</span></p>
          {filteredCommands.map((item, index) => {
            const resultIndex = filteredActions.length + index;
            return <button className="palette-result palette-command" data-selected={selectedIndex === resultIndex} id={`palette-result-${resultIndex}`} key={item.id} onMouseEnter={() => setSelectedIndex(resultIndex)} onClick={() => void copyCommand(item)}><span className="palette-result-icon">&gt;_</span><span><code>{item.command}</code><small>{item.shell} · {messages.palette.copyReview}</small></span><kbd>⧉</kbd></button>;
          })}
        </>}
        {filteredActions.length === 0 && filteredCommands.length === 0 && <p className="palette-empty">{view === "history" && !query.trim() ? messages.palette.emptyHistory : messages.palette.noResults.replace("{query}", query)}</p>}
      </div>
      <footer className="palette-footer"><span>{notice || messages.palette.noExecution}{manualCopyCommand && <code className="palette-fallback-command">{manualCopyCommand}</code>}</span><button onClick={onClose}>{messages.palette.close}</button></footer>
    </section>
  </div>;
}
