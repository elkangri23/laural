import { useEffect, useRef, type ReactNode } from "react";

type ModalShellProps = {
  children: ReactNode;
  onClose: () => void;
  title: string;
  className?: string;
};

export function ModalShell({
  children,
  onClose,
  title,
  className = "appearance-dialog modal-shell",
}: ModalShellProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    heading.current?.focus();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={className}
      aria-labelledby="modal-shell-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <button className="dialog-close" aria-label={`Cerrar ${title.toLowerCase()}`} onClick={onClose}>×</button>
      <h2 ref={heading} id="modal-shell-title" tabIndex={-1}>{title}</h2>
      {children}
    </dialog>
  );
}
