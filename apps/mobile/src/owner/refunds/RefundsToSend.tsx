import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { formatBdMobile, formatMoney, PROVIDER_NAMES } from '@booking/shared';
import { apiGet } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useTheme } from '../../theme/ThemeProvider';
import { BackButton, Button, Card, Empty, ErrorState, Icon, Loading, Text } from '../../ui';
import { MarkSentSheet } from '../booking/refunds';
import { ownerHref } from '../labels';
import { useOwner } from '../OwnerProvider';
import { refundsToSendPath, type RefundsPage, type RefundToSend } from './api';

type Load =
  | { status: 'loading' }
  | { status: 'ready'; items: RefundToSend[]; nextBefore: string | null; more: boolean; moreError: unknown }
  | { status: 'error'; error: unknown };

/** Pending wallet refunds across the member's venues: send each by hand, then mark it sent with the TrxID. */
export function RefundsToSend() {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { can } = useOwner();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: t.bgPage }}>
      {can('payment.verify') ? (
        <RefundsList />
      ) : (
        <View style={{ padding: t.space4, gap: t.space4 }}>
          <BackButton />
          <Text variant="heading" tone="strong" accessibilityRole="header">
            {tr('mobile.owner.refunds.title')}
          </Text>
          <Text tone="muted">{tr('mobile.owner.refunds.noAccess')}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function RefundsList() {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { ownerId } = useOwner();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [pulling, setPulling] = useState(false);
  const [sending, setSending] = useState<RefundToSend | null>(null);

  const fetchFirst = useCallback(async () => {
    try {
      const p = await apiGet<RefundsPage>(refundsToSendPath(ownerId));
      setLoad({ status: 'ready', items: p.refunds, nextBefore: p.nextBefore, more: false, moreError: null });
    } catch (error) {
      // A failed refresh keeps the list on screen; only a first load shows the error.
      setLoad((cur) => (cur.status === 'ready' ? { ...cur, moreError: error } : { status: 'error', error }));
    }
  }, [ownerId]);

  useEffect(() => {
    void fetchFirst();
  }, [fetchFirst]);

  const pull = async () => {
    setPulling(true);
    await fetchFirst();
    setPulling(false);
  };

  const showMore = async () => {
    if (load.status !== 'ready' || load.nextBefore === null || load.more) return;
    const { items, nextBefore } = load;
    setLoad({ ...load, more: true, moreError: null });
    try {
      const p = await apiGet<RefundsPage>(refundsToSendPath(ownerId, { before: nextBefore }));
      setLoad({ status: 'ready', items: [...items, ...p.refunds], nextBefore: p.nextBefore, more: false, moreError: null });
    } catch (e) {
      setLoad({ status: 'ready', items, nextBefore, more: false, moreError: e });
    }
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: t.space4, gap: t.space4, paddingBottom: t.space8 }}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void pull()} tintColor={t.primary} colors={[t.primary]} progressBackgroundColor={t.bgSurfaceRaised} />}
    >
      <BackButton />
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {tr('mobile.owner.refunds.title')}
      </Text>
      <Text tone="muted">{tr('mobile.owner.refunds.intro')}</Text>
      {load.status === 'loading' ? <Loading /> : null}
      {load.status === 'error' ? <ErrorState error={load.error} onRetry={() => void fetchFirst()} /> : null}
      {load.status === 'ready' && load.items.length === 0 ? <Empty>{tr('mobile.owner.refunds.empty')}</Empty> : null}
      {load.status === 'ready'
        ? load.items.map((r) => <RefundCard key={r.id} refund={r} onMarkSent={() => setSending(r)} />)
        : null}
      {load.status === 'ready' && load.nextBefore !== null ? (
        <Button label={tr('mobile.owner.refunds.more')} variant="secondary" loading={load.more} onPress={() => void showMore()} />
      ) : null}
      {load.status === 'ready' && load.moreError !== null ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(load.moreError, tr)}
        </Text>
      ) : null}
      <MarkSentSheet
        refund={sending}
        onClose={() => setSending(null)}
        onSent={() => {
          setSending(null);
          void fetchFirst();
        }}
      />
    </ScrollView>
  );
}

function RefundCard({ refund: r, onMarkSent }: { refund: RefundToSend; onMarkSent(): void }) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const { ownerId } = useOwner();
  const lang = i18n.language;
  const b = r.booking;
  const amount = formatMoney(r.amount, r.currency, lang);
  const date = b
    ? new Date(`${b.businessDate}T00:00:00Z`).toLocaleDateString(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' })
    : '';
  const bookingLine = b
    ? tr('mobile.owner.refunds.booking', { customer: b.customer?.name ?? tr('owner.unknownCustomer'), reference: b.reference, date })
    : null;
  return (
    <Card>
      <View style={{ gap: t.space3 }}>
        <View style={{ gap: t.space1 / 2 }}>
          <Text variant="title" tone="strong">
            {[amount, r.provider ? PROVIDER_NAMES[r.provider] : null].filter(Boolean).join(' · ')}
          </Text>
          <Text>
            {tr('owner.refunds.sendBack', {
              amount,
              number: formatBdMobile(r.sendTo ?? ''),
              provider: r.provider ? PROVIDER_NAMES[r.provider] : '',
            })}
          </Text>
        </View>
        {b && bookingLine ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${tr('mobile.owner.refunds.openBooking', { reference: b.reference })}, ${bookingLine}`}
            onPress={() => router.push(ownerHref(ownerId, `/booking/${encodeURIComponent(b.id)}`))}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.space2,
              minHeight: t.controlLg,
              paddingHorizontal: t.space3,
              borderRadius: t.radiusMd,
              backgroundColor: pressed ? t.bgHover : t.bgSubtle,
            })}
          >
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              {bookingLine}
            </Text>
            <Icon name="chevronRight" color={t.textMuted} size={t.iconSm} />
          </Pressable>
        ) : null}
        <Button label={tr('owner.refunds.markSent')} variant="secondary" onPress={onMarkSent} />
      </View>
    </Card>
  );
}
