import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActionMenu } from '../../components/ActionMenu';
import { Alert } from '../../components/ui/Alert';
import { Button, type ButtonProps } from '../../components/ui/Button';
import type { IconName } from '../../components/ui/Icon';
import { apiPost, ApiError } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { OwnerBooking, PaymentLink, RefundJson } from '../types';
import { availableActions, type Action } from './availableActions';
import { CashDialog } from './CashDialog';
import { OwnerCancelDialog } from './OwnerCancelDialog';
import { PaymentLinkDialog } from './PaymentLinkDialog';
import { VerifyPaymentDialog } from './VerifyPaymentDialog';
import { ReasonDialog } from './ReasonDialog';
import styles from './BookingActions.module.css';

/** The status transitions that are a single POST; cancel has its own dialog. */
export type StatusAction = 'confirm' | 'reject' | 'checkIn' | 'noShow';
const SEGMENT: Record<StatusAction, string> = { confirm: 'confirm', reject: 'reject', checkIn: 'check-in', noShow: 'no-show' };

/**
 * POSTs one status transition for a booking. At most one runs at a time (a ref, because React state lags a fast
 * double click); a call made meanwhile resolves to null. Failures set `error`, call `onConflict` on a 409, and rethrow.
 */
export function useBookingAction(ownerId: string, id: string, onConflict?: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);
  const conflict = useRef(onConflict);
  conflict.current = onConflict;

  const run = useCallback(
    async (action: StatusAction, body: { reason?: string } = {}): Promise<OwnerBooking | null> => {
      if (busy.current) return null;
      busy.current = true;
      setPending(true);
      setError(null);
      try {
        const res = await apiPost<{ booking: OwnerBooking }>(ownerPath(ownerId, `/bookings/${encodeURIComponent(id)}/${SEGMENT[action]}`), body);
        return res.booking;
      } catch (e) {
        setError(e);
        if (e instanceof ApiError && e.status === 409) conflict.current?.();
        throw e;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [ownerId, id],
  );
  return { run, pending, error };
}

export type ActionCallbacks = {
  onUpdated(b: OwnerBooking): void;
  /** A cash payment was recorded: the page shows the new booking and reloads the payments table. */
  onPaid(b: OwnerBooking): void;
  onCancelled(b: OwnerBooking, refunds: RefundJson[]): void;
  /** A 409 means the booking changed under us: the page reloads it. */
  onConflict(): void;
};

/** The button label for an action. */
export function actionLabel(a: Action, t: TFunction): string {
  return t(`owner.bookings.actions.${a}`);
}

const ACTION_ICON: Record<Action, IconName> = {
  verify: 'check',
  confirm: 'check',
  reject: 'ban',
  cancel: 'ban',
  checkIn: 'check',
  noShow: 'ban',
  markCash: 'money',
  paymentLink: 'link',
};

/** The leading icon for an action's button. */
export function actionIcon(a: Action): IconName {
  return ACTION_ICON[a];
}

/**
 * Everything one booking's actions need: which actions this member has, `trigger` to run one (a POST, or the
 * dialog that asks first), and the dialogs to render once next to the buttons.
 */
export function useBookingActions(booking: OwnerBooking, cb: ActionCallbacks) {
  const { t } = useTranslation();
  const { ownerId, can } = useOwner();
  const { run, pending, error } = useBookingAction(ownerId, booking.id, cb.onConflict);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [link, setLink] = useState<PaymentLink | null>(null);
  const actions = availableActions(booking, can);
  const base = ownerPath(ownerId, `/bookings/${encodeURIComponent(booking.id)}`);

  const trigger = (a: Action) => {
    switch (a) {
      case 'confirm':
      case 'checkIn':
      case 'noShow':
        run(a).then(
          (b) => b && cb.onUpdated(b),
          () => {}, // shown through `error`
        );
        return;
      case 'verify':
        return setVerifyOpen(true);
      case 'reject':
        return setRejectOpen(true);
      case 'cancel':
        return setCancelOpen(true);
      case 'markCash':
        return setCashOpen(true);
      case 'paymentLink':
        return setLinkOpen(true);
    }
  };

  const dialogs = (
    <>
      <ReasonDialog
        open={rejectOpen}
        title={t('owner.bookings.reject.title')}
        confirmLabel={t('owner.bookings.reject.confirm')}
        tone="danger"
        onClose={() => setRejectOpen(false)}
        onSubmit={async (reason) => {
          const b = await run('reject', reason ? { reason } : {});
          if (!b) return;
          setRejectOpen(false);
          cb.onUpdated(b);
        }}
      />
      <CashDialog
        open={cashOpen}
        booking={booking}
        onClose={() => setCashOpen(false)}
        onConflict={cb.onConflict}
        onRecorded={(b) => {
          setCashOpen(false);
          cb.onPaid(b);
        }}
      />
      <VerifyPaymentDialog
        open={verifyOpen}
        booking={booking}
        onClose={() => setVerifyOpen(false)}
        onConflict={cb.onConflict}
        onDone={(b) => {
          setVerifyOpen(false);
          cb.onPaid(b); // updates the booking and reloads its payments, refunds and group
        }}
      />
      <PaymentLinkDialog
        open={linkOpen}
        link={link}
        onClose={() => setLinkOpen(false)}
        load={async () => {
          try {
            const res = await apiPost<{ payment: PaymentLink }>(`${base}/payments/link`, {});
            setLink(res.payment);
            return res.payment;
          } catch (e) {
            setLink(null);
            if (e instanceof ApiError && e.status === 409) cb.onConflict();
            throw e;
          }
        }}
      />
      <OwnerCancelDialog
        bookingId={booking.id}
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onCancelled={(b, refunds) => {
          setCancelOpen(false);
          cb.onCancelled(b, refunds);
        }}
      />
    </>
  );

  // The reject dialog shows its own error.
  const open = rejectOpen || cancelOpen || cashOpen || linkOpen || verifyOpen;
  return { actions, trigger, pending, error: rejectOpen ? null : error, dialogs, open };
}

const DANGER: ReadonlySet<Action> = new Set(['reject', 'cancel', 'noShow']);
const PRIMARY: ReadonlySet<Action> = new Set(['verify', 'confirm', 'checkIn']);

/** The action buttons and their dialogs for one booking. Buttons disable together while any action is pending. */
export function BookingActions({
  booking,
  size,
  block,
  ...cb
}: { booking: OwnerBooking; size?: ButtonProps['size']; block?: boolean } & ActionCallbacks) {
  const { t } = useTranslation();
  const { actions, trigger, pending, error, dialogs } = useBookingActions(booking, cb);

  return (
    <section className={styles.actions} aria-label={t('owner.bookings.actions.title')}>
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      <div className={styles.buttons}>
        {actions.map((a) => (
          <Button
            key={a}
            size={size}
            block={block}
            variant={a === 'reject' ? 'danger' : PRIMARY.has(a) ? undefined : 'secondary'}
            icon={actionIcon(a)}
            disabled={pending}
            onClick={() => trigger(a)}
          >
            {actionLabel(a, t)}
          </Button>
        ))}
      </div>
      {dialogs}
    </section>
  );
}

/**
 * One list row's actions: `primary` as a small button, every other action this member has in a "More actions"
 * menu. Renders nothing when the member has no action on the booking. `onDone` runs after any action succeeds;
 * `onOpenChange` reports while one of the row's dialogs is open, so the list can keep the row until it closes.
 * `quiet` draws the main action as an outline button, for long lists where a solid button on every row is noise.
 */
export function RowActions({
  booking,
  primary,
  onDone,
  onOpenChange,
  quiet = false,
}: {
  booking: OwnerBooking;
  primary: Action | null;
  onDone(): void;
  onOpenChange?(open: boolean): void;
  quiet?: boolean;
}) {
  const { t } = useTranslation();
  const done = () => onDone();
  const { actions, trigger, pending, error, dialogs, open } = useBookingActions(booking, {
    onUpdated: done,
    onPaid: done,
    onCancelled: done,
    onConflict: done,
  });
  const report = useRef(onOpenChange);
  report.current = onOpenChange;
  useEffect(() => {
    if (!open) return;
    report.current?.(true);
    return () => report.current?.(false);
  }, [open]);
  if (actions.length === 0) return null;
  const main = primary !== null && actions.includes(primary) ? primary : null;
  const rest = actions.filter((a) => a !== main);

  return (
    <div className={styles.rowActions}>
      <div className={styles.buttons}>
        {main && (
          <Button size="sm" variant={quiet ? 'secondary' : undefined} icon={actionIcon(main)} disabled={pending} onClick={() => trigger(main)}>
            {actionLabel(main, t)}
          </Button>
        )}
        {rest.length > 0 && (
          <ActionMenu
            label={t('booking.moreActions')}
            items={rest.map((a) => ({
              key: a,
              label: actionLabel(a, t),
              tone: DANGER.has(a) ? ('danger' as const) : undefined,
              onSelect: () => trigger(a),
            }))}
          />
        )}
      </div>
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      {dialogs}
    </div>
  );
}
