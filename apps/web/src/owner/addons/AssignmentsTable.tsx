import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseMoney } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Checkbox } from '../../components/ui/Checkbox';
import { Skeleton } from '../../components/ui/Skeleton';
import { Paged } from '../../components/ui/Pagination';
import { Table } from '../../components/ui/Table';
import { apiDelete, apiPut } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { Addon, Assignment, OwnerVenue } from '../types';
import { useResource } from '../useResource';
import { minorToInput } from './addonForm';
import styles from './addons.module.css';

type Props = {
  level: 'venue' | 'turf';
  venue: OwnerVenue;
  turfId?: string;
  addons: Addon[];
  /** Only this level's assignments: venue-level rows for the venue tab, the turf's own rows for the turf tab. */
  assignments: Assignment[];
  onChanged(): void;
};

/** One row per catalogue add-on: switch it on for the venue or turf, optionally with its own price (and venue stock). */
export function AssignmentsTable({ level, venue, turfId, addons, assignments, onChanged }: Props) {
  const { t } = useTranslation();
  if (addons.length === 0) return <EmptyState size="sm" bare sport="volleyball" title={t('owner.addons.assign.none')} />;
  return (
    <div className={styles.stack}>
      <p className={styles.muted}>{t('owner.addons.offeredHint')}</p>
      <Paged items={addons} pageSize={10}>
        {(rows) => (
          <Table caption={t('owner.addons.assign.title')}>
            <thead>
              <tr>
                <th>{t('owner.addons.col.name')}</th>
                <th>{t('owner.addons.assign.enabled')}</th>
                <th>{t('owner.addons.assign.override')}</th>
                {level === 'venue' && <th>{t('owner.addons.col.stock')}</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((addon) => {
                const row = assignments.find((a) => a.addonId === addon.id) ?? null;
                return (
                  <AssignmentRow
                    key={`${addon.id}:${row ? JSON.stringify(row) : 'none'}`}
                    level={level}
                    venue={venue}
                    turfId={turfId}
                    addon={addon}
                    row={row}
                    onChanged={onChanged}
                  />
                );
              })}
            </tbody>
          </Table>
        )}
      </Paged>
    </div>
  );
}

function AssignmentRow({ level, venue, turfId, addon, row, onChanged }: Omit<Props, 'addons' | 'assignments'> & { addon: Addon; row: Assignment | null }) {
  const { t, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const [enabled, setEnabled] = useState(row?.enabled ?? false);
  const [override, setOverride] = useState(row?.priceOverride != null ? minorToInput(row.priceOverride, venue.currency) : '');
  const [stock, setStock] = useState(row?.stock != null ? String(row.stock) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sameCurrency = addon.currency === venue.currency;
  // Auto-apply add-ons always have unlimited stock.
  const stockEditable = level === 'venue' && addon.autoApply === null;
  const path = ownerPath(
    ownerId,
    level === 'venue'
      ? `/venues/${encodeURIComponent(venue.id)}/addons/${encodeURIComponent(addon.id)}`
      : `/venues/${encodeURIComponent(venue.id)}/turfs/${encodeURIComponent(turfId ?? '')}/addons/${encodeURIComponent(addon.id)}`,
  );

  const save = async () => {
    if (busy) return;
    setError(null);
    let priceOverride: number | null = null;
    if (override.trim() !== '') {
      try {
        priceOverride = parseMoney(override.trim(), venue.currency);
      } catch {
        setError(t('owner.addons.err.price'));
        return;
      }
    } else if (enabled && !sameCurrency && level === 'venue') {
      // At turf level the venue's override may already cover this, so the API decides.
      setError(t('errors.price_override_required'));
      return;
    }
    const body: { enabled: boolean; priceOverride: number | null; stock?: number | null } = { enabled, priceOverride };
    if (stockEditable) {
      const text = stock.trim();
      if (text !== '' && !/^\d+$/.test(text)) {
        setError(t('owner.addons.err.stock'));
        return;
      }
      body.stock = text === '' ? null : Number(text);
    }
    setBusy(true);
    try {
      await apiPut(path, body);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, t));
    }
    setBusy(false);
  };

  const remove = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await apiDelete(path);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, t));
    }
    setBusy(false);
  };

  return (
    <tr>
      <td>
        {addon.name}
        <p className={styles.muted}>{money(addon.price, addon.currency, i18n.language)}</p>
      </td>
      <td>
        <Checkbox label={t('owner.addons.assign.enabledLabel')} checked={enabled} onChange={setEnabled} />
      </td>
      <td>
        <input
          className={styles.cellInput}
          inputMode="decimal"
          aria-label={t('owner.addons.assign.overrideLabel', { name: addon.name, currency: venue.currency })}
          aria-invalid={error !== null && override.trim() === '' && !sameCurrency ? true : undefined}
          placeholder={sameCurrency ? minorToInput(addon.price, addon.currency) : ''}
          value={override}
          onChange={(e) => setOverride(e.target.value)}
        />
      </td>
      {level === 'venue' && (
        <td>
          <input
            className={styles.cellInput}
            inputMode="numeric"
            aria-label={t('owner.addons.assign.stockLabel', { name: addon.name })}
            disabled={!stockEditable}
            placeholder={t('owner.addons.unlimited')}
            value={stock}
            onChange={(e) => setStock(e.target.value)}
          />
        </td>
      )}
      <td>
        <div className={styles.rowActions}>
          <Button size="sm" icon="check" loading={busy} onClick={save} aria-label={t('owner.addons.assign.saveLabel', { name: addon.name })}>
            {t('owner.addons.assign.save')}
          </Button>
          {row && (
            <Button variant="ghost" size="sm" icon="trash" disabled={busy} onClick={remove} aria-label={t('owner.addons.assign.removeLabel', { name: addon.name })}>
              {t('owner.addons.assign.remove')}
            </Button>
          )}
        </div>
        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}

/** Loads the catalogue and the venue's assignments, then shows the venue's rows or one turf's rows. */
export function AssignmentsPanel({ venue, turfId }: { venue: OwnerVenue; turfId?: string }) {
  const { t } = useTranslation();
  const { ownerId, can } = useOwner();
  const allowed = can('addon.manage');
  const addons = useResource<{ addons: Addon[] }>(allowed ? ownerPath(ownerId, '/addons') : null);
  const assigned = useResource<{ assignments: Assignment[] }>(allowed ? ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/addons`) : null);

  if (!allowed) return <Alert tone="warning">{t('owner.noAccess')}</Alert>;
  const failed = addons.state.status === 'error' ? addons.state : assigned.state.status === 'error' ? assigned.state : null;
  if (failed) {
    return (
      <Alert tone="danger">
        <p className={styles.muted}>{errorMessage(failed.error, t)}</p>
        <Button
          variant="secondary"
          icon="refresh"
          onClick={() => {
            addons.reload();
            assigned.reload();
          }}
        >
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  }
  if (addons.state.status !== 'ready' || assigned.state.status !== 'ready') return <Skeleton kind="table" label={t('common.loading')} />;
  const rows = assigned.state.data.assignments.filter((a) => (turfId === undefined ? a.turfId === null : a.turfId === turfId));
  return (
    <div className={styles.card}>
      <h2 className={styles.heading}>{t('owner.addons.assign.title')}</h2>
      <AssignmentsTable
        level={turfId === undefined ? 'venue' : 'turf'}
        venue={venue}
        turfId={turfId}
        addons={addons.state.data.addons}
        assignments={rows}
        onChanged={assigned.reload}
      />
    </div>
  );
}
