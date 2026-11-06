import { Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { FEE_OWING_STATUSES, type AddonLine } from '@booking/shared';
import { ApiError } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { useTheme } from '../../theme/ThemeProvider';
import { BackButton, Badge, Card, Empty, ErrorState, Group, Loading, Row, Screen, Text } from '../../ui';
import { StatusBadge } from '../../bookings/StatusBadge';
import { customerLabel, ownerHref, ownerPath } from '../labels';
import { useOwner } from '../OwnerProvider';
import type { BookingDetail, OwnerBooking } from '../types';
import { BookingActionsBar, BookingBadges, PaymentLines } from './actions';
import { Line, useMoney } from './forms';
import { dateTime, dayLabel, hm, timeRange } from './model';
import { RefundsSection } from './refunds';

function addonLabel(a: AddonLine, tr: TFunction): string {
  if (a.pricingType === 'per_unit') return `${a.name} × ${a.quantity}`;
  if (a.pricingType === 'per_hour' && a.minutes) return `${a.name} · ${tr('checkout.durationM', { minutes: a.minutes })}`;
  return a.name;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useTheme();
  return (
    <View style={{ gap: t.space2 }}>
      <Text variant="label" tone="muted" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Mirrors the web OwnerBookingPage, stacked for a phone. */
export function BookingDetailScreen({ bookingId }: { bookingId: string }) {
  const { t: tr } = useTranslation();
  const { ownerId } = useOwner();
  const { state, reload, set } = useResource<BookingDetail>(ownerPath(ownerId, `/bookings/${encodeURIComponent(bookingId)}`));

  if (state.status === 'error') {
    const missing = state.error instanceof ApiError && state.error.status === 404;
    return (
      <Screen>
        <BackButton />
        {missing ? <Empty>{tr('owner.bookings.notFound')}</Empty> : <ErrorState error={state.error} onRetry={reload} />}
      </Screen>
    );
  }
  if (state.status !== 'ready') {
    return (
      <Screen>
        <BackButton />
        <Loading />
      </Screen>
    );
  }
  const data = state.data;
  const changed = (next?: OwnerBooking) => {
    if (next) set({ ...data, booking: next });
    reload(); // payments, refunds and the group change with it
  };
  return (
    <Screen scroll>
      <BackButton />
      <Body data={data} onChanged={changed} reload={reload} />
    </Screen>
  );
}

function Body({ data, onChanged, reload }: { data: BookingDetail; onChanged(next?: OwnerBooking): void; reload(): void }) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const { ownerId, venues } = useOwner();
  const b = data.booking;
  const lang = i18n.language;
  const venue = venues.find((v) => v.id === b.venueId);
  const tz = venue?.timezone ?? 'UTC';
  const fmt = useMoney(b.currency);
  const playerFee = b.platformFee?.payer === 'player' ? b.platformFee.amount : 0;
  const ownerFee = b.platformFee?.payer === 'owner' && FEE_OWING_STATUSES.includes(b.status) ? b.platformFee : null;
  const phone = b.customer?.phone ?? null;
  const group = (data.group ?? []).filter((g) => g.id !== b.id);

  return (
    <>
      <View style={{ gap: t.space2 }}>
        <Text variant="heading" tone="strong" accessibilityRole="header" selectable>
          {b.reference}
        </Text>
        <BookingBadges booking={b} source={false} />
        {b.seriesId ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={tr('series.badge')}
            onPress={() => router.push(ownerHref(ownerId, `/series/${encodeURIComponent(b.seriesId!)}`))}
            style={{ alignSelf: 'flex-start', minHeight: t.controlLg, justifyContent: 'center' }}
          >
            <Badge label={tr('series.badge')} tone="info" />
          </Pressable>
        ) : null}
      </View>

      <BookingActionsBar booking={b} onChanged={onChanged} />

      <Card accessibilityLabel={tr('owner.bookings.details')}>
        <Line label={tr('owner.bookings.customer')} value={customerLabel(b, tr)} />
        {phone ? (
          <Line label={tr('owner.bookings.phone')}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={tr('owner.today.sheet.call', { phone })}
              onPress={() => void Linking.openURL(`tel:${phone}`)}
              style={{ minHeight: t.controlLg, justifyContent: 'center' }}
            >
              <Text tone="primary" weight="semibold">
                {phone}
              </Text>
            </Pressable>
          </Line>
        ) : null}
        {b.customer?.email ? <Line label={tr('owner.bookings.email')} value={b.customer.email} /> : null}
        <Line label={tr('owner.bookings.turf')} value={b.turf?.name ?? '—'} />
        <Line label={tr('owner.bookings.date')} value={dayLabel(b.businessDate, tz, lang)} />
        <Line label={tr('owner.bookings.time')} value={timeRange(b, tz)} />
        <Line label={tr('owner.venue')} value={venue?.name ?? '—'} />
        <Line label={tr('owner.bookings.source')} value={b.source === 'walkin' ? tr('owner.bookings.sourceWalkin') : tr('owner.bookings.sourceOnline')} />
        {b.rescheduleCount > 0 ? (
          <Line
            label={tr('owner.bookings.moved')}
            value={b.rescheduledAt ? tr('owner.bookings.movedTimes', { when: dateTime(b.rescheduledAt, tz, lang), count: b.rescheduleCount }) : String(b.rescheduleCount)}
          />
        ) : null}
        {b.rejectReason ? <Line label={tr('owner.bookings.reason.recorded')} value={b.rejectReason} /> : null}
        {b.cancelReason ? <Line label={tr('owner.bookings.reason.recorded')} value={b.cancelReason} /> : null}
      </Card>

      <Section title={tr('owner.bookings.slots')}>
        <Card>
          {b.slots.map((s) => (
            <Line key={s.startAt} label={`${hm(s.startAt, tz)}–${hm(s.endAt, tz)}`} value={fmt(s.price)} />
          ))}
          {b.addons.map((a) => (
            <Line key={a.addonId} label={addonLabel(a, tr)} value={fmt(a.total)} />
          ))}
          <View style={{ height: t.hairline, backgroundColor: t.borderSubtle }} />
          <Line label={tr('owner.bookings.subtotal')} value={fmt(b.subtotal)} />
          {b.addonsTotal > 0 ? <Line label={tr('owner.bookings.addons')} value={fmt(b.addonsTotal)} /> : null}
          {b.coupon && b.coupon.discount > 0 ? <Line label={tr('owner.bookings.discount', { code: b.coupon.code })} value={fmt(-b.coupon.discount)} /> : null}
          {playerFee > 0 ? <Line label={tr('owner.bookings.platformFee', { payer: tr('owner.bookings.feePayer.player') })} value={fmt(playerFee)} /> : null}
          <Line label={tr('owner.bookings.total')} value={fmt(b.total)} strong />
          {b.advanceRequired > 0 ? <Line label={tr('owner.bookings.advance')} value={fmt(b.advanceRequired)} /> : null}
          <Line label={tr('owner.bookings.paid')} value={fmt(b.amountPaid)} />
          {b.amountRefunded > 0 ? <Line label={tr('owner.bookings.refunded')} value={fmt(b.amountRefunded)} /> : null}
          {ownerFee ? (
            <>
              <View style={{ height: t.hairline, backgroundColor: t.borderSubtle }} />
              <Line label={tr('owner.bookings.platformFee', { payer: tr('owner.bookings.feePayer.owner') })} value={fmt(ownerFee.amount)} />
            </>
          ) : null}
        </Card>
      </Section>

      {group.length > 0 ? (
        <Section title={tr('owner.bookings.together')}>
          <Group>
            {group.map((g) => (
              <Row
                key={g.id}
                title={[g.turf?.name, dayLabel(g.businessDate, tz, lang), timeRange(g, tz)].filter(Boolean).join(' · ')}
                detail={g.reference}
                right={<StatusBadge status={g.status} />}
                onPress={() => router.push(ownerHref(ownerId, `/booking/${encodeURIComponent(g.id)}`))}
              />
            ))}
          </Group>
        </Section>
      ) : null}

      <Section title={tr('owner.bookings.payments')}>
        <Card>
          {data.payments.length === 0 ? <Text tone="muted">{tr('owner.bookings.noPayments')}</Text> : <PaymentLines payments={data.payments} currency={b.currency} tz={tz} />}
        </Card>
      </Section>

      <RefundsSection refunds={data.refunds} onChanged={reload} />
    </>
  );
}
