import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { STRIPE_PAYOUT_HOLD_MS, formatBdMobile, formatMoney, type OwnerPlatformFeeJson, type PlatformBalanceJson, type PlatformPayoutJson } from '@booking/shared';
import { useResource } from '../../../src/lib/useResource';
import { useOwner } from '../../../src/owner/OwnerProvider';
import { ownerPath } from '../../../src/owner/labels';
import { PayPlatformSheet, walletMethods } from '../../../src/owner/settings/PayPlatformSheet';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { BackButton, Badge, type BadgeTone, Button, Card, Empty, ErrorState, Group, GroupLabel, Loading, Row, Screen, Text, WebNote } from '../../../src/ui';

type Shown = PlatformPayoutJson['status'] | 'stale';
const TONE: Record<Shown, BadgeTone> = { pending: 'warning', confirmed: 'success', rejected: 'danger', stale: 'neutral' };
/** Same as web `payoutShown`: a card payout still pending past the hold was never paid. */
const shownStatus = (p: PlatformPayoutJson, now: number): Shown =>
  p.status === 'pending' && p.method === 'stripe' && now - Date.parse(p.createdAt) > STRIPE_PAYOUT_HOLD_MS ? 'stale' : p.status;

/** What the team owes the platform and what it has sent (`settings.edit`). bKash/Nagad are paid here; card stays on the web. */
export default function PlatformFeeScreen() {
  const { t: tr, i18n } = useTranslation();
  const lang = i18n.language;
  const { ownerId, can } = useOwner();
  const allowed = can('settings.edit');
  const res = useResource<OwnerPlatformFeeJson>(allowed ? ownerPath(ownerId, '/platform-fee') : null, { keepOnError: true });
  // Each open gets a fresh sheet (key `n`), like the web dialog.
  const [pay, setPay] = useState<{ currency: string; n: number; open: boolean } | null>(null);

  const head = (
    <>
      <BackButton />
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {tr('owner.nav.platformFee')}
      </Text>
    </>
  );
  if (!allowed) {
    return (
      <Screen>
        {head}
        <Text tone="muted">{tr('owner.noAccess')}</Text>
      </Screen>
    );
  }
  if (res.state.status === 'error') {
    return (
      <Screen>
        {head}
        <ErrorState error={res.state.error} onRetry={res.reload} />
      </Screen>
    );
  }
  if (res.state.status !== 'ready') {
    return (
      <Screen>
        {head}
        <Loading />
      </Screen>
    );
  }
  const data = res.state.data;
  const now = Date.now();
  const owes = data.balances.some((b) => b.payable > 0);
  const wallets = walletMethods(data.methods);
  const canPayHere = wallets.length > 0;
  const payBalance = pay ? data.balances.find((b) => b.currency === pay.currency) : undefined;

  return (
    <Screen scroll>
      {head}
      <Text tone="muted">{data.feeActive ? tr(`owner.platformFee.intro.${data.payer}`) : tr('owner.platformFee.feeOff')}</Text>
      {data.balances.length === 0 ? (
        <Card>
          <Text variant="title" tone="strong">
            {tr('owner.platformFee.nothingYet')}
          </Text>
        </Card>
      ) : (
        data.balances.map((b) => (
          <BalanceCard
            key={b.currency}
            balance={b}
            lang={lang}
            onPay={canPayHere ? () => setPay((p) => ({ currency: b.currency, n: (p?.n ?? 0) + 1, open: true })) : undefined}
          />
        ))
      )}
      {owes && data.methods.stripe !== null && (
        <WebNote>{tr(canPayHere ? 'mobile.owner.settings.fee.cardWeb' : 'mobile.owner.settings.fee.payWeb')}</WebNote>
      )}
      {owes && !canPayHere && data.methods.stripe === null && <Text tone="muted">{tr('owner.platformFee.dialog.noMethods')}</Text>}

      <GroupLabel>{tr('owner.platformFee.history')}</GroupLabel>
      {data.payouts.length === 0 ? (
        <Empty>{tr('owner.platformFee.historyEmpty')}</Empty>
      ) : (
        <Group>
          {data.payouts.map((p) => {
            const shown = shownStatus(p, now);
            const when = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(p.createdAt));
            const parts = [tr(`admin.payouts.method.${p.method}`), when, p.senderNumber ? formatBdMobile(p.senderNumber) : null, p.trxId];
            const reason = p.status === 'rejected' && p.rejectReason ? (p.rejectReason === 'stripe_failed' ? tr('owner.platformFee.stripeFailed') : p.rejectReason) : null;
            return (
              <Row
                key={p.id}
                title={formatMoney(p.amount, p.currency, lang)}
                detail={[parts.filter(Boolean).join(' · '), reason].filter(Boolean).join('\n')}
                right={<Badge tone={TONE[shown]} label={tr(shown === 'stale' ? 'admin.payouts.status.stale' : `owner.platformFee.status.${shown}`)} />}
              />
            );
          })}
        </Group>
      )}
      {pay && payBalance && (
        <PayPlatformSheet
          key={pay.n}
          visible={pay.open}
          balance={payBalance}
          methods={data.methods}
          onClose={() => setPay((p) => p && { ...p, open: false })}
          onChanged={res.reload}
        />
      )}
    </Screen>
  );
}

function BalanceCard({ balance, lang, onPay }: { balance: PlatformBalanceJson; lang: string; onPay?: () => void }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const fmt = (minor: number) => formatMoney(minor, balance.currency, lang);
  if (balance.balance < 0) {
    return (
      <Card>
        <Text variant="title" tone="success">
          {tr('owner.platformFee.credit', { amount: fmt(-balance.balance) })}
        </Text>
        <Text tone="muted">{tr('owner.platformFee.creditHint')}</Text>
      </Card>
    );
  }
  if (balance.balance === 0 && balance.pending === 0) {
    return (
      <Card>
        <Text variant="title" tone="strong">
          {tr('owner.platformFee.settled', { currency: balance.currency })}
        </Text>
      </Card>
    );
  }
  return (
    <Card>
      <View style={{ gap: t.space1 }}>
        <Text variant="title" tone="strong">
          {tr('owner.platformFee.owe', { amount: fmt(balance.balance) })}
        </Text>
        {balance.pending > 0 && <Text tone="warning">{tr('owner.platformFee.pending', { pending: fmt(balance.pending) })}</Text>}
        {balance.payable === 0 && balance.pending > 0 && <Text tone="muted">{tr('owner.platformFee.allPending')}</Text>}
      </View>
      {balance.payable > 0 && onPay && (
        <View style={{ flexDirection: 'row', marginTop: t.space2 }}>
          <Button label={tr('owner.platformFee.payNow')} onPress={onPay} />
        </View>
      )}
    </Card>
  );
}
