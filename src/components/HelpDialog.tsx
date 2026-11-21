type HelpDialogProps = {
  onClose: () => void;
  onConfigureProvider: () => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
};

export function HelpDialog({ onClose, onConfigureProvider, onOpenSettings, onOpenPalette }: HelpDialogProps) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="provider-dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <button className="dialog-close" onClick={onClose} aria-label="Cerrar ayuda">×</button>
      <div className="dialog-mark"><HelpIcon /></div>
      <p className="eyebrow">CENTRO DE AYUDA</p>
      <h2 id="help-title">¿En qué podemos ayudarte?</h2>
      <p className="dialog-copy">Accede rápidamente a las funciones principales de Laural.</p>
      <div className="help-actions">
        <button className="settings-link" onClick={onConfigureProvider}>Conectar un modelo <span>Ollama, LM Studio o API compatible</span></button>
        <button className="settings-link" onClick={onOpenSettings}>Abrir configuración <span>Apariencia, seguridad y actualizaciones</span></button>
        <button className="settings-link" onClick={onOpenPalette}>Buscar acciones <span>Paleta de comandos · Ctrl + K</span></button>
      </div>
      <div className="help-shortcuts"><strong>Atajos</strong><span><kbd>Ctrl</kbd> + <kbd>K</kbd> abrir la paleta</span><span><kbd>Ctrl</kbd> + <kbd>`</kbd> alternar terminal</span></div>
    </section>
  </div>;
}

export function HelpIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.3"/><path d="M7.8 7.5a2.3 2.3 0 1 1 3.8 1.7c-.9.7-1.6 1.2-1.6 2.6M10 14.5v.1"/></svg>; }
