import { useLanguage } from "../i18n";

type HelpDialogProps = {
  onClose: () => void;
  onConfigureProvider: () => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
};

export function HelpDialog({ onClose, onConfigureProvider, onOpenSettings, onOpenPalette }: HelpDialogProps) {
  const { messages } = useLanguage();
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="provider-dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <button className="dialog-close" onClick={onClose} aria-label={messages.help.close}>×</button>
      <div className="dialog-mark"><HelpIcon /></div>
      <p className="eyebrow">{messages.help.eyebrow}</p>
      <h2 id="help-title">{messages.help.title}</h2>
      <p className="dialog-copy">{messages.help.description}</p>
      <div className="help-actions">
        <button className="settings-link" onClick={onConfigureProvider}>{messages.help.connect}<span>{messages.help.providers}</span></button>
        <button className="settings-link" onClick={onOpenSettings}>{messages.help.settings}<span>{messages.help.settingsInfo}</span></button>
        <button className="settings-link" onClick={onOpenPalette}>{messages.help.search}<span>{messages.help.searchInfo}</span></button>
      </div>
      <div className="help-shortcuts"><strong>{messages.help.shortcuts}</strong><span><kbd>Ctrl</kbd> + <kbd>K</kbd> {messages.help.openPalette}</span><span><kbd>Ctrl</kbd> + <kbd>`</kbd> {messages.help.toggleTerminal}</span></div>
    </section>
  </div>;
}

export function HelpIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.3"/><path d="M7.8 7.5a2.3 2.3 0 1 1 3.8 1.7c-.9.7-1.6 1.2-1.6 2.6M10 14.5v.1"/></svg>; }
