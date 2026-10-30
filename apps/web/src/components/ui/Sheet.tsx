import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useModal, type DialogProps } from './Dialog';
import styles from './Sheet.module.css';

/** A modal panel for details beside a list: a side sheet from tablet up, a bottom sheet on phones. Same API as `Dialog`. */
export function Sheet({ open, onClose, title, children }: DialogProps) {
  const { t } = useTranslation();
  const { ref, onCancel } = useModal(open, onClose);
  const titleId = useId();

  return (
    <dialog ref={ref} className={styles.sheet} aria-labelledby={titleId} onCancel={onCancel}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <button type="button" className={styles.close} aria-label={t('common.close')} onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className={styles.body}>{children}</div>
    </dialog>
  );
}
