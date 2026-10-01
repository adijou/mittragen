import { useEffect, useRef, type ReactNode } from "react";

export function FinanceDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="finance-dialog" aria-labelledby="finance-dialog-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id="finance-dialog-title">{title}</h2><button type="button" aria-label="Schliessen" disabled={busy} onClick={onClose}>×</button></header>
    {children}
  </dialog>;
}
