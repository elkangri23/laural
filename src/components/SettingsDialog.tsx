import { useEffect, useRef, type ReactNode } from "react";

export function SettingsDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} className="appearance-dialog settings-dialog" aria-labelledby="settings-title" onCancel={onClose}>
    <button className="dialog-close" aria-label="Cerrar configuración" onClick={onClose}>×</button>
    <h2 id="settings-title">Configuración</h2>
    {children}
  </dialog>;
}
