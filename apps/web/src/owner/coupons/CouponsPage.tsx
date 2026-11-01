import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { CouponJson } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Badge, type Tone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Paged } from '../../components/ui/Pagination';
import { Table } from '../../components/ui/Table';
import { apiDelete, apiPatch } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { ConfirmDeleteDialog } from '../schedule/ConfirmDeleteDialog';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import { useResource } from '../useResource';
import { CouponForm } from './CouponFormDialog';
import styles from './coupons.module.css';

/** "10% · max ৳500.00" or "৳300.00 off". */
export function discountSummary(c: Pick<CouponJson, 'type' | 'value' | 'currency' | 'maxDiscount'>, t: TFunction, lang: string): string {
  if (c.type === 'fixed') return t('owner.coupons.fixedOff', { amount: money(c.value, c.currency, lang) });
  const percent = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 2 }).format(c.value / 100);
  return c.maxDiscount === null ? percent : t('owner.coupons.percentMax', { percent, amount: money(c.maxDiscount, c.currency, lang) });
}

/** Dates were picked as whole days in the browser's zone, so they are shown in it too. */
const day = (iso: string, lang: string) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

function validity(c: CouponJson, t: TFunction, lang: string): string {
  if (c.validFrom && c.validUntil) return `${day(c.validFrom, lang)} – ${day(c.validUntil, lang)}`;
  if (c.validFrom) return t('owner.coupons.from', { date: day(c.validFrom, lang) });
  if (c.validUntil) return t('owner.coupons.until', { date: day(c.validUntil, lang) });
  return t('owner.coupons.always');
}

/** What a player trying the code would meet now: off, not started, ended, used up, or live. */
function state(c: CouponJson, now: number): { key: string; tone: Tone } {
  if (!c.active) return { key: 'off', tone: 'neutral' };
  if (c.validUntil && Date.parse(c.validUntil) <= now) return { key: 'expired', tone: 'neutral' };
  if (c.maxUses !== null && c.uses >= c.maxUses) return { key: 'usedUp', tone: 'warning' };
  if (c.validFrom && Date.parse(c.validFrom) > now) return { key: 'scheduled', tone: 'info' };
  return { key: 'active', tone: 'success' };
}

/** The owner's promo codes. Writes need `coupon.manage` on every venue, so venue-scoped members get a note instead. */
export function CouponsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { ownerId, membership, venues } = useOwner();
  useOwnerTitle(t('owner.nav.coupons'));
  const writable = membership.venueIds === 'all';
  const { state: res, reload } = useResource<{ coupons: CouponJson[] }>(ownerPath(ownerId, '/coupons'));
  const [editing, setEditing] = useState<CouponJson | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<CouponJson | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const now = Date.now();

  const venueNames = (ids: string[]) => {
    if (ids.length === 0) return t('owner.coupons.allVenues');
    const names = ids.map((id) => venues.find((v) => v.id === id)?.name).filter((n): n is string => Boolean(n));
    return names.length > 0 ? names.join(', ') : '—';
  };

  const toggle = async (c: CouponJson) => {
    if (toggling) return;
    setToggling(c.id);
    setActionError(null);
    try {
      await apiPatch(ownerPath(ownerId, `/coupons/${encodeURIComponent(c.id)}`), { active: !c.active });
      reload();
    } catch (err) {
      setActionError(err);
    }
    setToggling(null);
  };

  const remove = async () => {
    if (!removing) return;
    await apiDelete(ownerPath(ownerId, `/coupons/${encodeURIComponent(removing.id)}`));
    setRemoving(null);
    reload();
  };

  return (
    <div className={styles.card}>
      <div className={styles.toolbar}>
        <h2 className={styles.heading}>{t('owner.coupons.title')}</h2>
        {writable && <Button icon="plus" onClick={() => setCreating(true)}>{t('owner.coupons.add')}</Button>}
      </div>
      <p className={styles.muted}>{t('owner.coupons.intro')}</p>
      {!writable && <Alert tone="info">{t('owner.coupons.ownerWideOnly')}</Alert>}
      {actionError !== null && <Alert tone="danger">{errorMessage(actionError, t)}</Alert>}
      {res.status === 'error' && (
        <Alert tone="danger">
          <p className={styles.muted}>{errorMessage(res.error, t)}</p>
          <Button variant="secondary" icon="refresh" onClick={reload}>
            {t('auth.retry')}
          </Button>
        </Alert>
      )}
      {(res.status === 'loading' || res.status === 'idle') && <Skeleton kind="table" label={t('common.loading')} />}
      {res.status === 'ready' &&
        (res.data.coupons.length === 0 ? (
          <EmptyState sport="tennis" title={t('owner.coupons.empty')} description={t('owner.coupons.emptyHint')} />
        ) : (
          <Paged items={res.data.coupons}>
            {(rows) => (
              <Table caption={t('owner.coupons.title')}>
                <thead>
                  <tr>
                    <th>{t('owner.coupons.col.code')}</th>
                    <th>{t('owner.coupons.col.discount')}</th>
                    <th>{t('owner.coupons.col.venues')}</th>
                    <th>{t('owner.coupons.col.valid')}</th>
                    <th>{t('owner.coupons.col.uses')}</th>
                    <th>{t('owner.coupons.col.status')}</th>
                    {writable && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const s = state(c, now);
                    return (
                      <tr key={c.id}>
                        <td className={styles.code}>{c.code}</td>
                        <td>
                          <span className={styles.nowrap}>{discountSummary(c, t, lang)}</span>
                          {c.minSubtotal > 0 && (
                            <span className={styles.sub}>{t('owner.coupons.minSpend', { amount: money(c.minSubtotal, c.currency, lang) })}</span>
                          )}
                        </td>
                        <td>{venueNames(c.venueIds)}</td>
                        <td className={styles.nowrap}>{validity(c, t, lang)}</td>
                        <td className={styles.num}>
                          {c.maxUses === null ? c.uses : `${c.uses} / ${c.maxUses}`}
                          {c.maxUsesPerCustomer !== null && (
                            <span className={styles.sub}>{t('owner.coupons.perCustomer', { limit: c.maxUsesPerCustomer })}</span>
                          )}
                        </td>
                        <td>
                          <Badge tone={s.tone}>{t(`owner.coupons.state.${s.key}`)}</Badge>
                        </td>
                        {writable && (
                          <td>
                            <div className={styles.rowActions}>
                              <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditing(c)}>
                                {t('owner.coupons.edit')}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                icon={c.active ? 'ban' : 'power'}
                                loading={toggling === c.id}
                                aria-label={t(c.active ? 'owner.coupons.deactivateLabel' : 'owner.coupons.activateLabel', { code: c.code })}
                                onClick={() => void toggle(c)}
                              >
                                {t(c.active ? 'owner.coupons.deactivate' : 'owner.coupons.activate')}
                              </Button>
                              <Button variant="ghost" size="sm" icon="trash" onClick={() => setRemoving(c)}>
                                {t('owner.coupons.delete')}
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Paged>
        ))}
      {writable && (
        <>
          <CouponForm open={creating} coupon={null} onClose={() => setCreating(false)} onSaved={reload} />
          <CouponForm open={editing !== null} coupon={editing} onClose={() => setEditing(null)} onSaved={reload} />
          <ConfirmDeleteDialog
            open={removing !== null}
            title={t('owner.coupons.deleteTitle', { code: removing?.code ?? '' })}
            body={t('owner.coupons.deleteBody')}
            confirmLabel={t('owner.coupons.deleteConfirm')}
            onClose={() => setRemoving(null)}
            onConfirm={remove}
          />
        </>
      )}
    </div>
  );
}
