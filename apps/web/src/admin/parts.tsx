import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrencyAmount, OwnerStatus, PlatformLogJson } from '@booking/shared';
import type { TFunction } from 'i18next';
import { Badge, type Tone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { formatDate, formatTime, money } from '../lib/format';
import styles from './admin.module.css';

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** An instant as a date in the viewer's zone (admins look across every venue's zone). */
export const day = (iso: string, lang: string) => formatDate(iso, localZone(), lang);
export const timeOf = (iso: string, lang: string) => formatTime(iso, localZone(), lang);
export const dayTime = (iso: string, lang: string) => `${formatDate(iso, localZone(), lang)} ${formatTime(iso, localZone(), lang)}`;

/** "BDT 1,200 · USD 40", or a dash when nothing was earned. */
export const earnedText = (earned: CurrencyAmount[], lang: string) =>
  earned.length === 0 ? '—' : earned.map((e) => money(e.amount, e.currency, lang)).join(' · ');

/** An email with a break opportunity right after the @, so a narrow column wraps it there and not mid-name. */
export function EmailText({ value }: { value: string }) {
  const at = value.indexOf('@');
  if (at < 0) return <>{value}</>;
  return (
    <>
      {value.slice(0, at + 1)}
      <wbr />
      {value.slice(at + 1)}
    </>
  );
}

/**
 * An owner's platform-fee balance per currency: what is owed, or a neutral "Credit ৳X" badge (absolute value)
 * when the owner has paid ahead. A dash when nothing is owed either way.
 */
export function OwesCell({ owes }: { owes: CurrencyAmount[] | undefined }) {
  const { t, i18n } = useTranslation();
  const rows = (owes ?? []).filter((e) => e.amount !== 0);
  if (rows.length === 0) return <>—</>;
  return (
    <span className={`${styles.stack} ${styles.endStack}`}>
      {rows.map((e) =>
        e.amount < 0 ? (
          <span key={e.currency}>
            <Badge tone="neutral">{t('admin.owners.credit', { amount: money(-e.amount, e.currency, i18n.language) })}</Badge>
          </span>
        ) : (
          <span key={e.currency} className={styles.strong}>
            {money(e.amount, e.currency, i18n.language)}
          </span>
        ),
      )}
    </span>
  );
}

const STATUS_TONE: Record<OwnerStatus, Tone> = { active: 'success', pending_approval: 'warning', suspended: 'danger' };

export function OwnerStatusBadge({ status }: { status: OwnerStatus }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status]}>{t(`owner.status.${status}`)}</Badge>;
}

/** The platform log line for one entry, e.g. "Approved Arena". */
export const logLabel = (e: PlatformLogJson, t: TFunction) =>
  t(`admin.activity.action.${e.action}`, { target: e.target ?? t('admin.activity.removed'), amount: e.amount !== null && e.amount > 0 ? `+${e.amount}` : e.amount });

/** Search box that only searches on submit, so typing does not refetch on every key. */
export function SearchForm({ label, value, onSearch }: { label: string; value: string; onSearch(q: string): void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(draft.trim());
  };
  return (
    <form role="search" className={styles.search} onSubmit={submit}>
      <TextField icon="search" label={label} type="search" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <Button type="submit" variant="secondary" icon="search">
        {t('admin.search')}
      </Button>
    </form>
  );
}
