import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ADMIN_PERIOD_DAYS, SUSPEND_REASON_MAX, type AdminOwnerDetailJson } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { Table } from '../components/ui/Table';
import { TextField } from '../components/ui/TextField';
import { ApiError, apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { formatRating } from '../lib/format';
import { useResource } from '../owner/useResource';
import { ActionDialog } from './ActionDialog';
import { useAdminTitle } from './AdminShell';
import { day, dayTime, earnedText, logLabel, OwnerStatusBadge } from './parts';
import styles from './admin.module.css';

type Action = 'approve' | 'suspend' | 'reactivate';
type Sms = AdminOwnerDetailJson['sms'];

/** SMS balance and this month's use, with a form to add credits (or take some back with a negative amount). */
function SmsCreditsPanel({ ownerId, sms, onChange }: { ownerId: string; sms: Sms; onChange(next: Sms): void }) {
  const { t, i18n } = useTranslation();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const n = (v: number) => v.toLocaleString(i18n.language);
  const value = Number(amount);
  const valid = /^-?\d+$/.test(amount) && value !== 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await apiPost<{ sms: Sms }>(`/admin/owners/${encodeURIComponent(ownerId)}/sms-credits`, {
        amount: value,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setAmount('');
      setNote('');
      setDone(true);
      onChange(res.sms);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'insufficient_sms_credits' ? t('admin.owner.sms.insufficient') : errorMessage(err, t));
    }
    setBusy(false);
  };
  return (
    <section className={styles.panel} aria-labelledby="owner-sms">
      <div className={styles.panelHead}>
        <h2 id="owner-sms" className={styles.heading}>
          {t('admin.owner.sms.title')}
        </h2>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>{t('admin.owner.sms.credits')}</dt>
          <dd>{n(sms.credits)}</dd>
        </div>
        <div>
          <dt>{t('admin.owner.sms.messages')}</dt>
          <dd>{n(sms.thisMonth.messages)}</dd>
        </div>
        <div>
          <dt>{t('admin.owner.sms.segments')}</dt>
          <dd>{n(sms.thisMonth.segments)}</dd>
        </div>
      </dl>
      <form className={styles.toolbar} onSubmit={(e) => void submit(e)} noValidate>
        <TextField
          className={styles.grantField}
          icon="hash"
          label={t('admin.owner.sms.amount')}
          hint={t('admin.owner.sms.amountHint')}
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, ''))}
        />
        <TextField
          className={styles.grantField}
          icon="note"
          label={t('admin.owner.sms.note')}
          maxLength={SUSPEND_REASON_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button type="submit" icon="check" loading={busy} disabled={!valid}>
          {t('admin.owner.sms.apply')}
        </Button>
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
      {done && (
        <p className={styles.muted} role="status">
          {t('admin.owner.sms.applied')}
        </p>
      )}
    </section>
  );
}

/** One business: who runs it, its venues and recent trade, its platform history, and the status actions. */
export function AdminOwnerDetailPage() {
  const { t, i18n } = useTranslation();
  const { ownerId = '' } = useParams();
  const { state, reload, set } = useResource<AdminOwnerDetailJson>(`/admin/owners/${encodeURIComponent(ownerId)}`);
  const [action, setAction] = useState<Action | null>(null);
  useAdminTitle(state.status === 'ready' ? state.data.owner.name : t('admin.nav.owners'));

  if (state.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.muted}>{errorMessage(state.error, t)}</p>
        <Link to=".." relative="path" className={styles.link}>
          {t('admin.owner.back')}
        </Link>
      </Alert>
    );
  }
  if (state.status !== 'ready') return <Skeleton kind="detail" label={t('common.loading')} />;
  const { owner, contacts, members, venues, recent, history } = state.data;
  const n = (v: number) => v.toLocaleString(i18n.language);
  const name = owner.name;

  const run = async (reason?: string) => {
    if (!action) return;
    await apiPost(`/admin/owners/${encodeURIComponent(owner.id)}/${action}`, action === 'suspend' ? { reason } : {});
    setAction(null);
    reload();
  };

  return (
    <div className={styles.page}>
      <Link to=".." relative="path" className={styles.link}>
        {t('admin.owner.back')}
      </Link>
      <section className={styles.panel} aria-labelledby="owner-name">
        <div className={styles.hero}>
          <h2 id="owner-name" className={styles.heroName}>
            {name}
          </h2>
          <OwnerStatusBadge status={owner.status} />
          <div className={styles.actions}>
            {owner.status === 'pending_approval' && <Button icon="check" onClick={() => setAction('approve')}>{t('admin.owner.approve')}</Button>}
            {owner.status === 'active' && (
              <Button variant="danger" icon="ban" onClick={() => setAction('suspend')}>
                {t('admin.owner.suspend')}
              </Button>
            )}
            {owner.status === 'suspended' && <Button icon="power" onClick={() => setAction('reactivate')}>{t('admin.owner.reactivate')}</Button>}
          </div>
        </div>
        {owner.status === 'pending_approval' && <p className={styles.muted}>{t('admin.owner.pendingNote')}</p>}
        {owner.status === 'suspended' && <p className={styles.muted}>{t('admin.owner.suspendedNote')}</p>}
        <dl className={styles.facts}>
          <div>
            <dt>{t('admin.owner.country')}</dt>
            <dd>{owner.country}</dd>
          </div>
          <div>
            <dt>{t('admin.owner.currency')}</dt>
            <dd>{owner.currency}</dd>
          </div>
          <div>
            <dt>{t('admin.owner.joined')}</dt>
            <dd>{day(owner.createdAt, i18n.language)}</dd>
          </div>
          <div>
            <dt>{t('admin.owner.members')}</dt>
            <dd>{n(members)}</dd>
          </div>
          <div>
            <dt>{t('admin.owner.bookings', { days: ADMIN_PERIOD_DAYS })}</dt>
            <dd>{n(recent.bookings)}</dd>
          </div>
          <div>
            <dt>{t('admin.owner.earned', { days: ADMIN_PERIOD_DAYS })}</dt>
            <dd>{earnedText(recent.earned, i18n.language)}</dd>
          </div>
        </dl>
      </section>

      <div className={`${styles.split} ${styles.wide}`}>
        <section className={styles.panel} aria-labelledby="owner-venues">
          <div className={styles.panelHead}>
            <h2 id="owner-venues" className={styles.heading}>
              {t('admin.owner.venues')}
            </h2>
            <span className={styles.count}>{n(venues.length)}</span>
          </div>
          {venues.length === 0 ? (
            <p className={styles.muted}>{t('admin.owner.noVenues')}</p>
          ) : (
            <Table caption={t('admin.owner.venues')} bare>
              <thead>
                <tr>
                  <th>{t('admin.owner.col.venue')}</th>
                  <th>{t('admin.owner.col.courts')}</th>
                  <th>{t('admin.owner.col.rating')}</th>
                  <th>{t('admin.owner.col.state')}</th>
                </tr>
              </thead>
              <tbody>
                {venues.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <span className={styles.stack}>
                        {v.published ? (
                          <Link to={`/venues/${encodeURIComponent(v.slug)}`} className={styles.link} data-row-link>
                            {v.name}
                          </Link>
                        ) : (
                          <span>{v.name}</span>
                        )}
                        <span className={styles.sub}>{v.city}</span>
                      </span>
                    </td>
                    <td className={styles.num}>{n(v.courts)}</td>
                    <td className={styles.num}>
                      {v.rating && v.rating.count > 0 ? `${formatRating(v.rating.average, i18n.language)} (${n(v.rating.count)})` : '—'}
                    </td>
                    <td>
                      <Badge tone={v.published ? 'success' : 'neutral'}>
                        {v.published ? t('admin.owner.published') : t('admin.owner.draft')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>

        <div className={styles.page}>
          <section className={styles.panel} aria-labelledby="owner-contacts">
            <div className={styles.panelHead}>
              <h2 id="owner-contacts" className={styles.heading}>
                {t('admin.owner.contacts')}
              </h2>
            </div>
            {contacts.length === 0 ? (
              <p className={styles.muted}>{t('admin.owner.noContacts')}</p>
            ) : (
              <ul className={styles.list}>
                {contacts.map((c) => (
                  <li key={c.id} className={styles.row}>
                    <span className={styles.stack}>
                      <span>{c.name || '—'}</span>
                      <span className={styles.sub}>{[c.email, c.phone].filter(Boolean).join(' · ')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <SmsCreditsPanel
            ownerId={owner.id}
            sms={state.data.sms}
            onChange={(sms) => {
              set({ ...state.data, sms });
              // The grant shows in History.
              reload();
            }}
          />
          <section className={styles.panel} aria-labelledby="owner-history">
            <div className={styles.panelHead}>
              <h2 id="owner-history" className={styles.heading}>
                {t('admin.owner.history')}
              </h2>
            </div>
            {history.length === 0 ? (
              <p className={styles.muted}>{t('admin.owner.noHistory')}</p>
            ) : (
              <ul className={styles.list}>
                {history.map((e) => (
                  <li key={e.id} className={styles.row}>
                    <span className={styles.stack}>
                      <span>{logLabel(e, t)}</span>
                      <span className={styles.sub}>
                        {[dayTime(e.at, i18n.language), e.actor?.name].filter(Boolean).join(' · ')}
                      </span>
                      {e.reason && <span className={styles.quote}>{e.reason}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <ActionDialog
        open={action === 'approve'}
        title={t('admin.owner.approveTitle', { name })}
        body={t('admin.owner.approveBody')}
        confirmLabel={t('admin.owner.approve')}
        tone="primary"
        onClose={() => setAction(null)}
        onConfirm={run}
      />
      <ActionDialog
        open={action === 'suspend'}
        title={t('admin.owner.suspendTitle', { name })}
        body={t('admin.owner.suspendBody')}
        confirmLabel={t('admin.owner.suspend')}
        tone="danger"
        reasonMax={SUSPEND_REASON_MAX}
        onClose={() => setAction(null)}
        onConfirm={run}
      />
      <ActionDialog
        open={action === 'reactivate'}
        title={t('admin.owner.reactivateTitle', { name })}
        body={t('admin.owner.reactivateBody')}
        confirmLabel={t('admin.owner.reactivate')}
        tone="primary"
        onClose={() => setAction(null)}
        onConfirm={run}
      />
    </div>
  );
}
