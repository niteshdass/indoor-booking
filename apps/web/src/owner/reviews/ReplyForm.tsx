import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { REVIEW_REPLY_MAX } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Textarea';
import { errorMessage } from '../../lib/errors';
import styles from './reviews.module.css';

export type ReplyFormProps = { initial: string; onSave: (text: string) => Promise<void>; onCancel: () => void };

/** Inline reply editor for one review. The page closes it once `onSave` resolves. */
export function ReplyForm({ initial, onSave, onCancel }: ReplyFormProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const empty = text.trim().length === 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || empty) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(text.trim());
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)}>
      <Textarea
        label={t('owner.reviews.replyField')}
        value={text}
        maxLength={REVIEW_REPLY_MAX}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        hint={t('owner.reviews.replyCount', { n: text.length })}
      />
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      <div className={styles.actions}>
        <Button type="submit" loading={busy} disabled={empty}>
          {t('owner.reviews.replySave')}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          {t('owner.reviews.cancel')}
        </Button>
      </div>
    </form>
  );
}
