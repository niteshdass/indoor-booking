import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { localParts } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Paged } from '../../components/ui/Pagination';
import { Table } from '../../components/ui/Table';
import { apiDelete } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { formatDate, money } from '../../lib/format';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { weekdayNames } from '../settings/HoursEditor';
import type { Override, OwnerTurf, OwnerVenue } from '../types';
import { useResource } from '../useResource';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { OverrideForm } from './OverrideForm';
import styles from './overrides.module.css';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `month` moved by `by` months, as YYYY-MM. */
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** The date an override starts to apply, for ordering. */
const sortKey = (o: Override) => ('date' in o ? o.date : o.recurrence.from);

/** A turf's slot overrides for one month (`?month=`, default the venue's current month). Changes need `slot.override`. */
export function OverridesTab({ turf, venue }: { turf: OwnerTurf; venue: OwnerVenue | undefined }) {
  const { t, i18n } = useTranslation();
  const { ownerId, owner, can } = useOwner();
  const editable = can('slot.override');
  const currency = venue?.currency ?? owner.defaultCurrency;
  const timeZone = venue?.timezone ?? 'UTC';
  const [params, setParams] = useSearchParams();
  const requested = params.get('month');
  const month = requested && MONTH_RE.test(requested) ? requested : localParts(new Date(), timeZone).date.slice(0, 7);
  const { from, to } = monthRange(month);
  const base = ownerPath(ownerId, `/venues/${encodeURIComponent(turf.venueId)}/turfs/${encodeURIComponent(turf.id)}/overrides`);
  const { state, reload } = useResource<{ overrides: Override[] }>(`${base}?from=${from}&to=${to}`);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Override | null>(null);
  const names = weekdayNames(i18n.language);

  const goto = (by: number) =>
    setParams(
      (prev) => {
        const copy = new URLSearchParams(prev);
        copy.set('month', shiftMonth(month, by));
        return copy;
      },
      { replace: true },
    );
  const monthLabel = new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));

  const when = (o: Override) => {
    if ('date' in o) return formatDate(o.date, timeZone, i18n.language);
    const days = o.recurrence.weekdays.map((w) => names[w]).join(', ');
    return o.recurrence.until
      ? t('owner.override.recurrenceUntil', { days, from: o.recurrence.from, until: o.recurrence.until })
      : t('owner.override.recurrence', { days, from: o.recurrence.from });
  };
  const time = (o: Override) => {
    if (o.type === 'close') return t('owner.override.allDay');
    const range = `${o.start}–${o.end}`;
    return o.type === 'modify' ? t('owner.override.modifies', { slot: o.slotStart, range }) : range;
  };
  const price = (o: Override) =>
    (o.type === 'modify' || o.type === 'add') && o.price !== undefined ? money(o.price, currency, i18n.language) : t('owner.override.none');

  const remove = async () => {
    if (!removing) return;
    await apiDelete(`${base}/${encodeURIComponent(removing.id)}`);
    setRemoving(null);
    reload();
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.heading}>{t('owner.override.title')}</h2>
      <p className={styles.muted}>{t('owner.override.intro')}</p>
      <div className={styles.toolbar}>
        <div className={styles.month}>
          <Button variant="secondary" size="sm" aria-label={t('owner.override.prevMonth')} onClick={() => goto(-1)}>
            ‹
          </Button>
          <span className={styles.monthLabel} aria-live="polite">
            {monthLabel}
          </span>
          <Button variant="secondary" size="sm" aria-label={t('owner.override.nextMonth')} onClick={() => goto(1)}>
            ›
          </Button>
        </div>
        {editable && <Button onClick={() => setAdding(true)}>{t('owner.override.add')}</Button>}
      </div>
      {state.status === 'error' && (
        <Alert tone="danger">
          <p className={styles.muted}>{errorMessage(state.error, t)}</p>
          <Button variant="secondary" onClick={reload}>
            {t('auth.retry')}
          </Button>
        </Alert>
      )}
      {(state.status === 'loading' || state.status === 'idle') && <Skeleton kind="table" label={t('common.loading')} />}
      {state.status === 'ready' &&
        (state.data.overrides.length === 0 ? (
          <EmptyState sport="badminton" title={t('owner.override.empty')} />
        ) : (
          <Paged items={[...state.data.overrides].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))}>
            {(rows) => (
              <Table caption={t('owner.override.title')}>
                <thead>
                  <tr>
                    <th>{t('owner.override.col.when')}</th>
                    <th>{t('owner.override.col.type')}</th>
                    <th>{t('owner.override.col.time')}</th>
                    <th>{t('owner.override.col.price')}</th>
                    <th>{t('owner.override.col.reason')}</th>
                    {editable && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id}>
                      <td>{when(o)}</td>
                      <td>{t(`owner.override.type.${o.type}`)}</td>
                      <td className={styles.num}>{time(o)}</td>
                      <td className={styles.num}>{price(o)}</td>
                      <td>{o.reason ?? t('owner.override.none')}</td>
                      {editable && (
                        <td>
                          <Button variant="ghost" size="sm" onClick={() => setRemoving(o)}>
                            {t('owner.override.delete')}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Paged>
        ))}
      {editable && <OverrideForm open={adding} onClose={() => setAdding(false)} turf={turf} currency={currency} onCreated={reload} />}
      <ConfirmDeleteDialog
        open={removing !== null}
        title={t('owner.override.deleteTitle')}
        body={t('owner.override.deleteBody')}
        confirmLabel={t('owner.override.deleteConfirm')}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
      />
    </div>
  );
}
