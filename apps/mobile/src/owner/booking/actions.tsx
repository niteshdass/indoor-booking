import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PaymentStatus } from '@booking/shared';
import { useResource } from '../../lib/useResource';
import { useTheme } from '../../theme/ThemeProvider';
import { Badge, Button, Icon, Sheet, Text, type BadgeTone } from '../../ui';
import { StatusBadge } from '../../bookings/StatusBadge';
import { customerLabel, ownerHref, ownerPath } from '../labels';
import { useOwner } from '../OwnerProvider';
import type { BookingDetail, OwnerBooking, PaymentJson } from '../types';
import { CancelForm, CashForm, ErrorLine, LinkForm, Line, MoveForm, RejectForm, useMoney, useVenueTz, VerifyForm, type FormProps } from './forms';
import { availableActions, awaitsVerification, DANGER, dateTime, dayLabel, nextStep, PRIMARY, timeRange, type Action } from './model';
import { usePost } from './usePost';

export type BookingActionProps = { booking: OwnerBooking; onChanged(next?: OwnerBooking): void };

/** Same tones as the web PaymentStatusBadge. */
export const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = {
  refunded: 'info',
  partially_refunded: 'info',
  paid: 'success',
  partially_paid: 'warning',
  unpaid: 'neutral',
};
export const PAY_ROW_TONE: Record<PaymentJson['status'], BadgeTone> = { succeeded: 'success', pending: 'warning', failed: 'danger' };

/** One POST, no form: confirm, check in, no-show. */
const STATUS_SEGMENT: Partial<Record<Action, string>> = { confirm: 'confirm', checkIn: 'check-in', noShow: 'no-show' };
const FORMS: Partial<Record<Action, (p: FormProps) => React.JSX.Element | null>> = {
  verify: VerifyForm,
  markCash: CashForm,
  reject: RejectForm,
  cancel: CancelForm,
  move: MoveForm,
  paymentLink: LinkForm,
};

export const actionLabel = (a: Action, tr: TFunction) => tr(`owner.bookings.actions.${a}`);

function formTitle(a: Action, tr: TFunction): string {
  switch (a) {
    case 'verify':
      return tr('owner.verify.title');
    case 'markCash':
      return tr('owner.cash.title');
    case 'reject':
      return tr('owner.bookings.reject.title');
    case 'cancel':
      return tr('cancel.title');
    case 'move':
      return tr('reschedule.staffTitle');
    case 'paymentLink':
      return tr('owner.link.title');
    default:
      return actionLabel(a, tr);
  }
}

/** "Rafi · Court 2 · 14:30–16:00": who and when, under every action sheet title. */
export function useWho(b: OwnerBooking): string {
  const { t: tr } = useTranslation();
  const tz = useVenueTz(b.venueId);
  return [customerLabel(b, tr), b.turf?.name, timeRange(b, tz)].filter(Boolean).join(' · ');
}

/** Runs the status actions that need no form (confirm, check in, no-show); everything else goes to `open`. */
export function useRunner(booking: OwnerBooking, onChanged: BookingActionProps['onChanged'], open: (a: Action) => void) {
  const { ownerId } = useOwner();
  const { post, busy, error } = usePost(() => onChanged());
  const run = async (a: Action) => {
    const segment = STATUS_SEGMENT[a];
    if (!segment) return open(a);
    const res = await post<{ booking: OwnerBooking }>(ownerPath(ownerId, `/bookings/${encodeURIComponent(booking.id)}/${segment}`), {});
    if (res) onChanged(res.booking);
  };
  return { run, busy, error };
}

type Mode = 'menu' | Action;

/** Body of the action sheet: the More actions menu or one action's form. One sheet switches modes (no nested modals). */
function ActionBody({
  booking,
  mode,
  setMode,
  onDone,
  onClose,
}: {
  booking: OwnerBooking;
  mode: Mode;
  setMode(m: Mode): void;
  onDone(next?: OwnerBooking): void;
  onClose(): void;
}) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { can } = useOwner();
  const { run, busy, error } = useRunner(booking, onDone, setMode);
  if (mode !== 'menu') {
    const Form = FORMS[mode];
    return Form ? <Form booking={booking} onDone={onDone} onBack={onClose} /> : null;
  }
  const actions = availableActions(booking, can);
  const main = actions.filter((a) => a !== 'cancel');
  return (
    <View style={{ gap: t.space2 }}>
      {main.map((a) => (
        <Button
          key={a}
          label={actionLabel(a, tr)}
          variant="secondary"
          tone={DANGER.has(a) ? 'danger' : 'default'}
          disabled={busy}
          onPress={() => void run(a)}
        />
      ))}
      {actions.includes('cancel') ? (
        <>
          <View style={{ height: t.hairline, backgroundColor: t.borderSubtle, marginVertical: t.space1 }} />
          <Button label={actionLabel('cancel', tr)} variant="secondary" tone="danger" disabled={busy} onPress={() => setMode('cancel')} />
        </>
      ) : null}
      <ErrorLine error={error} />
      <Button label={tr('common.close')} variant="ghost" disabled={busy} onPress={onClose} />
    </View>
  );
}

/** The lead action for this booking plus one more, the rest behind More actions. */
function split(booking: OwnerBooking, actions: Action[]): { lead: Action | null; second: Action | null; more: boolean } {
  const lead = nextStep(booking, actions) ?? actions.find((a) => a !== 'cancel') ?? null;
  const second = actions.find((a) => a !== lead && a !== 'cancel' && !DANGER.has(a)) ?? actions.find((a) => a !== lead && a !== 'cancel') ?? null;
  const shown = [lead, second].filter(Boolean).length;
  return { lead, second, more: actions.length > shown };
}

/** Action row for the booking detail screen: the lead action, a second one, and a More button for the rest. */
export function BookingActionsBar({ booking, onChanged }: BookingActionProps) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { can } = useOwner();
  const who = useWho(booking);
  const [mode, setMode] = useState<Mode | null>(null);
  const { run, busy, error } = useRunner(booking, onChanged, setMode);
  const actions = availableActions(booking, can);
  if (actions.length === 0) return null;
  const { lead, second, more } = split(booking, actions);
  const done = (next?: OwnerBooking) => {
    setMode(null);
    onChanged(next);
  };
  const button = (a: Action, primary: boolean) => (
    <View style={{ flex: 1 }} key={a}>
      <Button
        label={actionLabel(a, tr)}
        variant={primary && PRIMARY.has(a) ? 'primary' : 'secondary'}
        tone={DANGER.has(a) ? 'danger' : 'default'}
        loading={busy && primary}
        disabled={busy}
        onPress={() => void run(a)}
      />
    </View>
  );
  return (
    <View style={{ gap: t.space2 }} accessibilityLabel={tr('owner.bookings.actions.title')}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2, alignItems: 'center' }}>
        {lead ? button(lead, true) : null}
        {second ? button(second, false) : null}
        {more ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('booking.moreActions')}
            onPress={() => setMode('menu')}
            style={({ pressed }) => ({
              minWidth: t.controlLg,
              minHeight: t.controlLg,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: t.radiusMd,
              borderWidth: t.hairline,
              borderColor: t.borderDefault,
              backgroundColor: pressed ? t.bgHover : t.bgSurface,
            })}
          >
            <Icon name="more" color={t.textStrong} />
          </Pressable>
        ) : null}
      </View>
      <ErrorLine error={error} />
      <Sheet visible={mode !== null} onClose={() => setMode(null)} title={mode === null ? undefined : mode === 'menu' ? tr('booking.moreActions') : formTitle(mode, tr)} subtitle={who}>
        {mode !== null ? <ActionBody booking={booking} mode={mode} setMode={setMode} onDone={done} onClose={() => setMode(null)} /> : null}
      </Sheet>
    </View>
  );
}

/** Payment rows: method, amount, status in words, when. */
export function PaymentLines({ payments, currency, tz }: { payments: PaymentJson[]; currency: string; tz: string }) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const fmt = useMoney(currency);
  return (
    <View style={{ gap: t.space2 }}>
      {payments.map((p) => (
        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
          <View style={{ flex: 1, gap: t.space1 / 2 }}>
            <Text tone="strong">{`${tr(`cancel.method.${p.method}`)} · ${fmt(p.amount)}`}</Text>
            <Text variant="caption" tone="muted">
              {dateTime(p.createdAt, tz, i18n.language)}
            </Text>
          </View>
          <Badge label={tr(`owner.bookings.payStatus.${p.status}`)} tone={PAY_ROW_TONE[p.status]} />
        </View>
      ))}
    </View>
  );
}

/** Badges a booking carries everywhere: status (or "Payment to check"), payment status, source. */
export function BookingBadges({ booking, source = true }: { booking: OwnerBooking; source?: boolean }) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const toVerify = awaitsVerification(booking);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
      <StatusBadge status={booking.status} toVerify={toVerify} />
      {!toVerify ? <Badge label={tr(`paymentStatus.${booking.paymentStatus}`)} tone={PAYMENT_TONE[booking.paymentStatus]} /> : null}
      {source ? <Badge label={booking.source === 'walkin' ? tr('owner.bookings.sourceWalkin') : tr('owner.bookings.sourceOnline')} /> : null}
    </View>
  );
}

/**
 * Quick look from Today: key facts, recent payments, the lead actions, More actions and Open booking.
 * Facts, menu and forms share one sheet. Closes after a successful action.
 */
export function BookingQuickSheet({
  booking,
  onChanged,
  visible,
  onClose,
  start,
}: BookingActionProps & { visible: boolean; onClose(): void; /** Open straight on this action's form instead of the facts. */ start?: Action }) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const { ownerId, can } = useOwner();
  const tz = useVenueTz(booking.venueId);
  const fmt = useMoney(booking.currency);
  const [mode, setMode] = useState<'facts' | Mode>(start ?? 'facts');
  useEffect(() => {
    if (visible) setMode(start ?? 'facts');
  }, [visible, start]);
  const detail = useResource<BookingDetail>(visible ? ownerPath(ownerId, `/bookings/${encodeURIComponent(booking.id)}`) : null);
  const close = () => {
    setMode('facts');
    onClose();
  };
  const done = (next?: OwnerBooking) => {
    close();
    onChanged(next);
  };
  const { run, busy, error } = useRunner(booking, done, setMode);
  const actions = availableActions(booking, can);
  const { lead, second, more } = split(booking, actions);
  const phone = booking.customer?.phone ?? null;
  const when = [booking.turf?.name, dayLabel(booking.businessDate, tz, i18n.language), timeRange(booking, tz)].filter(Boolean).join(' · ');
  const payments = detail.state.status === 'ready' ? detail.state.data.payments : [];

  const title = mode === 'facts' ? customerLabel(booking, tr) : mode === 'menu' ? tr('booking.moreActions') : formTitle(mode, tr);
  return (
    <Sheet visible={visible} onClose={close} title={title} subtitle={mode === 'facts' ? when : undefined}>
      {mode !== 'facts' ? (
        <ActionBody booking={booking} mode={mode} setMode={setMode} onDone={done} onClose={() => setMode('facts')} />
      ) : (
        <View style={{ gap: t.space3 }}>
          <BookingBadges booking={booking} />
          {phone ? (
            <Button label={tr('owner.today.sheet.call', { phone })} variant="secondary" onPress={() => void Linking.openURL(`tel:${phone}`)} />
          ) : null}
          <View style={{ gap: t.space2 }}>
            <Line label={tr('owner.bookings.total')} value={fmt(booking.total)} />
            <Line label={tr('owner.bookings.paid')} value={fmt(booking.amountPaid)} />
            <Line label={tr('owner.today.sheet.due')} value={fmt(Math.max(0, booking.total - booking.amountPaid))} strong />
          </View>
          {payments.length > 0 ? <PaymentLines payments={payments} currency={booking.currency} tz={tz} /> : null}
          <ErrorLine error={error} />
          {lead ? (
            <Button label={actionLabel(lead, tr)} tone={DANGER.has(lead) ? 'danger' : 'default'} loading={busy} disabled={busy} onPress={() => void run(lead)} />
          ) : null}
          {second ? (
            <Button label={actionLabel(second, tr)} variant="secondary" tone={DANGER.has(second) ? 'danger' : 'default'} disabled={busy} onPress={() => void run(second)} />
          ) : null}
          {more ? <Button label={tr('booking.moreActions')} variant="ghost" disabled={busy} onPress={() => setMode('menu')} /> : null}
          <Button
            label={tr('owner.today.sheet.openBooking')}
            variant="ghost"
            onPress={() => {
              close();
              router.push(ownerHref(ownerId, `/booking/${encodeURIComponent(booking.id)}`));
            }}
          />
        </View>
      )}
    </Sheet>
  );
}
