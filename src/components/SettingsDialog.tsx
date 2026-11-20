import { useEffect, useRef, type ReactNode } from "react";

export function SettingsDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    title.current?.focus();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} className="appearance-dialog settings-dialog" aria-labelledby="settings-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <button className="dialog-close" aria-label="Cerrar configuración" onClick={onClose}>×</button>
    <h2 ref={title} id="settings-title" tabIndex={-1}>Configuración</h2>
    {children}
  </dialog>;
}
