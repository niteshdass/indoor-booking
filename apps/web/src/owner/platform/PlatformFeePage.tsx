import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { OwnerPlatformFeeJson, PlatformBalanceJson, PlatformPayoutJson } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Paged } from '../../components/ui/Pagination';
import { Skeleton } from '../../components/ui/Skeleton';
import { Table } from '../../components/ui/Table';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatTime, money } from '../../lib/format';
import { PAYOUT_TONE, payoutShown } from '../../lib/payouts';
import { formatBdMobile } from '../../lib/wallets';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import { useResource } from '../useResource';
import { platformFeeShown } from './feeShown';
import { PayPlatformDialog } from './PayPlatformDialog';
import styles from './PlatformFeePage.module.css';

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function BalanceCard({ balance, onPay }: { balance: PlatformBalanceJson; onPay(): void }) {
  const { t, i18n } = useTranslation();
  const fmt = (minor: number) => money(minor, balance.currency, i18n.language);
  if (balance.balance < 0) {
    return (
      <div className={styles.card}>
        <p className={styles.amount}>{t('owner.platformFee.credit', { amount: fmt(-balance.balance) })}</p>
        <p className={styles.muted}>{t('owner.platformFee.creditHint')}</p>
      </div>
    );
  }
  if (balance.balance === 0 && balance.pending === 0) {
    return (
      <div className={styles.card}>
        <p className={styles.amount}>{t('owner.platformFee.settled', { currency: balance.currency })}</p>
      </div>
    );
  }
  return (
    <div className={styles.card}>
      <div className={styles.cardText}>
        <p className={styles.amount}>{t('owner.platformFee.owe', { amount: fmt(balance.balance) })}</p>
        {balance.pending > 0 && <p className={styles.pending}>{t('owner.platformFee.pending', { pending: fmt(balance.pending) })}</p>}
        {balance.payable === 0 && balance.pending > 0 && <p className={styles.muted}>{t('owner.platformFee.allPending')}</p>}
      </div>
      {balance.payable > 0 && (
        <Button icon="wallet" onClick={onPay} className={styles.pay}>
          {t('owner.platformFee.payNow')}
        </Button>
      )}
    </div>
  );
}

function History({ payouts }: { payouts: PlatformPayoutJson[] }) {
  const { t, i18n } = useTranslation();
  const now = Date.now();
  const zone = localZone();
  if (payouts.length === 0) return <EmptyState size="sm" sport="tennis" title={t('owner.platformFee.historyEmpty')} />;
  return (
    <Paged items={payouts}>
      {(rows) => (
        <Table caption={t('owner.platformFee.history')}>
          <thead>
            <tr>
              <th>{t('owner.platformFee.col.date')}</th>
              <th>{t('owner.platformFee.col.method')}</th>
              <th className={styles.end}>{t('owner.platformFee.col.amount')}</th>
              <th>{t('owner.platformFee.col.trxId')}</th>
              <th>{t('owner.platformFee.col.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const shown = payoutShown(p, now);
              const reason = p.rejectReason === 'stripe_failed' ? t('owner.platformFee.stripeFailed') : p.rejectReason;
              return (
                <tr key={p.id}>
                  <td>
                    <span className={styles.stack}>
                      <span className={styles.nowrap}>{formatDate(p.createdAt, zone, i18n.language)}</span>
                      <span className={styles.sub}>{formatTime(p.createdAt, zone, i18n.language)}</span>
                    </span>
                  </td>
                  <td>
                    <span className={styles.stack}>
                      <span className={styles.nowrap}>{t(`admin.payouts.method.${p.method}`)}</span>
                      {p.senderNumber && <span className={`${styles.sub} ${styles.nowrap}`}>{formatBdMobile(p.senderNumber)}</span>}
                    </span>
                  </td>
                  <td className={`${styles.end} ${styles.strong} ${styles.nowrap}`}>{money(p.amount, p.currency, i18n.language)}</td>
                  <td>{p.trxId ? <span className={styles.mono}>{p.trxId}</span> : '—'}</td>
                  <td>
                    <span className={styles.stack}>
                      <span>
                        <Badge tone={PAYOUT_TONE[shown]} className={styles.nowrap}>
                          {t(shown === 'stale' ? 'admin.payouts.status.stale' : `owner.platformFee.status.${shown}`)}
                        </Badge>
                      </span>
                      {p.status === 'rejected' && reason && <span className={styles.sub}>{reason}</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Paged>
  );
}

/** What the team owes the platform, per currency, how to pay it, and the payouts sent so far (`settings.edit`). */
export function PlatformFeePage() {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  useOwnerTitle(t('owner.nav.platformFee'));
  const res = useResource<OwnerPlatformFeeJson>(ownerPath(ownerId, '/platform-fee'), { keepOnError: true });
  const [params] = useSearchParams();
  // Back from a card payment that had to leave the page (bank check): Stripe returns here with ?paid=1.
  const returned = params.get('paid') === '1';
  // Each open gets a fresh dialog (key `n`); closing keeps it mounted so focus returns to Pay now.
  const [pay, setPay] = useState<{ currency: string; n: number; open: boolean } | null>(null);
  const openPay = (currency: string) => setPay((p) => ({ currency, n: (p?.n ?? 0) + 1, open: true }));

  if (res.state.status === 'error') {
    return (
      <Alert tone="danger" className={styles.alert}>
        <span>{errorMessage(res.state.error, t)}</span>
        <Button size="sm" variant="secondary" icon="refresh" onClick={res.reload}>
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  }
  if (res.state.status !== 'ready') return <Skeleton kind="detail" label={t('common.loading')} />;
  const data = res.state.data;
  if (!platformFeeShown(data)) return <Navigate to=".." replace />;
  const balance = pay ? data.balances.find((b) => b.currency === pay.currency) : undefined;

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        {/* Free mode with a balance left: who pays no longer applies, only that the fee is off. */}
        <p className={styles.muted}>{data.feeActive ? t(`owner.platformFee.intro.${data.payer}`) : t('owner.platformFee.feeOff')}</p>
      </div>
      {returned && <Alert tone="success">{t('owner.platformFee.dialog.received')}</Alert>}
      <section className={styles.balances} aria-label={t('owner.platformFee.balances')}>
        {data.balances.length === 0 ? (
          <div className={styles.card}>
            <p className={styles.amount}>{t('owner.platformFee.nothingYet')}</p>
          </div>
        ) : (
          data.balances.map((b) => <BalanceCard key={b.currency} balance={b} onPay={() => openPay(b.currency)} />)
        )}
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>{t('owner.platformFee.history')}</h2>
        <History payouts={data.payouts} />
      </section>
      {pay && balance && (
        <PayPlatformDialog
          key={pay.n}
          open={pay.open}
          balance={balance}
          methods={data.methods}
          onClose={() => setPay((p) => p && { ...p, open: false })}
          onChanged={res.reload}
        />
      )}
    </div>
  );
}
