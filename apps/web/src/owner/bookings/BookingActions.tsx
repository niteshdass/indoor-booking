import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { apiPost, ApiError } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { OwnerBooking, PaymentLink, RefundJson } from '../types';
import { availableActions } from './availableActions';
import { CashDialog } from './CashDialog';
import { OwnerCancelDialog } from './OwnerCancelDialog';
import { PaymentLinkDialog } from './PaymentLinkDialog';
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

type Props = {
  booking: OwnerBooking;
  onUpdated(b: OwnerBooking): void;
  /** A cash payment was recorded: the page shows the new booking and reloads the payments table. */
  onPaid(b: OwnerBooking): void;
  onCancelled(b: OwnerBooking, refunds: RefundJson[]): void;
  /** A 409 means the booking changed under us: the page reloads it. */
  onConflict(): void;
};

/** The action buttons and their dialogs for one booking. Buttons disable together while any action is pending. */
export function BookingActions({ booking, onUpdated, onPaid, onCancelled, onConflict }: Props) {
  const { t } = useTranslation();
  const { ownerId, can } = useOwner();
  const { run, pending, error } = useBookingAction(ownerId, booking.id, onConflict);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState<PaymentLink | null>(null);
  const actions = availableActions(booking, can);
  const base = ownerPath(ownerId, `/bookings/${encodeURIComponent(booking.id)}`);

  const go = (action: StatusAction) => {
    run(action).then(
      (b) => b && onUpdated(b),
      () => {}, // shown through `error`
    );
  };

  return (
    <section className={styles.actions} aria-label={t('owner.bookings.actions.title')}>
      {error !== null && !rejectOpen && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      <div className={styles.buttons}>
        {actions.map((a) => {
          switch (a) {
            case 'confirm':
              return (
                <Button key={a} disabled={pending} onClick={() => go('confirm')}>
                  {t('owner.bookings.actions.confirm')}
                </Button>
              );
            case 'reject':
              return (
                <Button key={a} variant="danger" disabled={pending} onClick={() => setRejectOpen(true)}>
                  {t('owner.bookings.actions.reject')}
                </Button>
              );
            case 'cancel':
              return (
                <Button key={a} variant="secondary" disabled={pending} onClick={() => setCancelOpen(true)}>
                  {t('owner.bookings.actions.cancel')}
                </Button>
              );
            case 'checkIn':
              return (
                <Button key={a} disabled={pending} onClick={() => go('checkIn')}>
                  {t('owner.bookings.actions.checkIn')}
                </Button>
              );
            case 'noShow':
              return (
                <Button key={a} variant="secondary" disabled={pending} onClick={() => go('noShow')}>
                  {t('owner.bookings.actions.noShow')}
                </Button>
              );
            case 'markCash':
              return (
                <Button key={a} variant="secondary" disabled={pending} onClick={() => setCashOpen(true)}>
                  {t('owner.bookings.actions.markCash')}
                </Button>
              );
            case 'paymentLink':
              return (
                <Button key={a} variant="secondary" disabled={pending} onClick={() => setLinkOpen(true)}>
                  {t('owner.bookings.actions.paymentLink')}
                </Button>
              );
            default:
              return null;
          }
        })}
      </div>
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
          onUpdated(b);
        }}
      />
      <CashDialog
        open={cashOpen}
        booking={booking}
        onClose={() => setCashOpen(false)}
        onConflict={onConflict}
        onRecorded={(b) => {
          setCashOpen(false);
          onPaid(b);
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
            if (e instanceof ApiError && e.status === 409) onConflict();
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
          onCancelled(b, refunds);
        }}
      />
    </section>
  );
}

/** Confirm and reject for one pending booking in a list row; `onDone` runs after either succeeds. */
export function PendingActions({ id, onDone }: { id: string; onDone(): void }) {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const { run, pending, error } = useBookingAction(ownerId, id, onDone);
  const [rejectOpen, setRejectOpen] = useState(false);

  return (
    <div className={styles.rowActions}>
      <div className={styles.buttons}>
        <Button size="sm" disabled={pending} onClick={() => run('confirm').then((b) => b && onDone(), () => {})}>
          {t('owner.bookings.actions.confirm')}
        </Button>
        <Button size="sm" variant="danger" disabled={pending} onClick={() => setRejectOpen(true)}>
          {t('owner.bookings.actions.reject')}
        </Button>
      </div>
      {error !== null && !rejectOpen && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
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
          onDone();
        }}
      />
    </div>
  );
}
