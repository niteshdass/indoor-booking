import { useEffect, useId, useRef, type ReactNode, type SyntheticEvent } from 'react';
import styles from './Dialog.module.css';

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

/**
 * A native modal `<dialog>` driven by `open`: opens with `showModal`, closes on Escape through `onClose`, and hands
 * focus back to whatever opened it. `Dialog` and `Sheet` share it and differ only in layout.
 */
export function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
    } else if (!open && el.open) {
      if (typeof el.close === 'function') el.close();
      else el.removeAttribute('open');
      opener.current?.focus();
      opener.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Fallback where native <dialog> does not emit `cancel` on Escape (e.g. jsdom); onClose is idempotent.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onCancel = (e: SyntheticEvent) => {
    e.preventDefault(); // parent owns `open`; it closes via onClose
    onClose();
  };

  return { ref, onCancel };
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const { ref, onCancel } = useModal(open, onClose);
  const titleId = useId();

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onCancel={onCancel}>
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      {children}
    </dialog>
  );
}
