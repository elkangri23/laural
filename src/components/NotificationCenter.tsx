type NotificationCenterProps = {
  syncNotice: string | null;
  onClose: () => void;
  onOpenUpdates: () => void;
  onOpenAccount: () => void;
};

export function NotificationCenter({ syncNotice, onClose, onOpenUpdates, onOpenAccount }: NotificationCenterProps) {
  return <div className="dialog-backdrop notification-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="provider-dialog notification-dialog" role="dialog" aria-modal="true" aria-labelledby="notifications-title">
      <button className="dialog-close" onClick={onClose} aria-label="Cerrar notificaciones">×</button>
      <div className="dialog-mark"><BellIcon /></div>
      <p className="eyebrow">CENTRO DE NOTIFICACIONES</p>
      <h2 id="notifications-title">Notificaciones</h2>
      <div className="notification-list" aria-live="polite">
        {syncNotice ? <article className="notification-item"><strong>Sincronización</strong><p>{syncNotice}</p><button className="action-quiet" onClick={() => { onClose(); onOpenAccount(); }}>Revisar configuración de la cuenta</button></article> : <p className="notification-empty">No tienes avisos nuevos.</p>}
        <article className="notification-item update-notification"><strong>Actualizaciones</strong><p>Laural comprueba nuevas versiones cada seis horas. También puedes buscar una actualización ahora.</p><button className="action-quiet" onClick={() => { onClose(); onOpenUpdates(); }}>Ver actualizaciones y versión</button></article>
      </div>
    </section>
  </div>;
}

export function BellIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 8a5.5 5.5 0 0 0-11 0c0 6-2 6-2 7.5h15C17.5 14 15.5 14 15.5 8ZM8 18h4"/></svg>; }
