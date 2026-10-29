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
export const dayTime = (iso: string, lang: string) => `${formatDate(iso, localZone(), lang)} ${formatTime(iso, localZone(), lang)}`;

/** "BDT 1,200 · USD 40", or a dash when nothing was earned. */
export const earnedText = (earned: CurrencyAmount[], lang: string) =>
  earned.length === 0 ? '—' : earned.map((e) => money(e.amount, e.currency, lang)).join(' · ');

const STATUS_TONE: Record<OwnerStatus, Tone> = { active: 'success', pending_approval: 'warning', suspended: 'danger' };

export function OwnerStatusBadge({ status }: { status: OwnerStatus }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status]}>{t(`owner.status.${status}`)}</Badge>;
}

/** The platform log line for one entry, e.g. "Approved Arena". */
export const logLabel = (e: PlatformLogJson, t: TFunction) =>
  t(`admin.activity.action.${e.action}`, { target: e.target ?? t('admin.activity.removed') });

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
      <TextField label={label} type="search" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <Button type="submit" variant="secondary">
        {t('admin.search')}
      </Button>
    </form>
  );
}
