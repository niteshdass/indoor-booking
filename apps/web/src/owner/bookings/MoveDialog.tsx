import { localParts } from '@booking/shared';
import { RescheduleDialog } from '../../bookings/RescheduleDialog';
import { apiGet, apiPost } from '../../lib/apiClient';
import type { SlotDay } from '../../lib/types';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { OwnerBooking, OwnerSlotDay, OwnerTurf } from '../types';
import { useResource } from '../useResource';

type Props = {
  booking: OwnerBooking;
  open: boolean;
  onClose: () => void;
  onMoved(b: OwnerBooking): void;
  onConflict(): void;
};

const gridDayOf = (d: OwnerSlotDay): SlotDay => ({
  businessDate: d.businessDate,
  currency: d.currency,
  status: !d.inWindow ? 'outside_window' : d.closed ? 'closed' : 'open',
  slots: d.slots,
});

/** The staff "Move booking" dialog: any active court of the booking's venue, any day, the same number of slots. */
export function MoveDialog({ booking, open, onClose, onMoved, onConflict }: Props) {
  const { ownerId, venues } = useOwner();
  const venue = venues.find((v) => v.id === booking.venueId);
  const tz = venue?.timezone ?? 'UTC';
  const venuePath = ownerPath(ownerId, `/venues/${encodeURIComponent(booking.venueId)}`);
  // Loaded on first open only; the booking's own court stays listed even when it was turned off since.
  const turfs = useResource<{ turfs: OwnerTurf[] }>(open ? `${venuePath}/turfs` : null);
  const list = turfs.state.status === 'ready' ? turfs.state.data.turfs.filter((x) => x.active || x.id === booking.turfId) : [];

  return (
    <RescheduleDialog<OwnerBooking>
      audience="staff"
      open={open}
      onClose={onClose}
      current={{ turfId: booking.turfId, date: booking.businessDate, startAts: booking.slots.map((s) => s.startAt).sort() }}
      turfs={list.map((x) => ({ id: x.id, name: x.name }))}
      today={localParts(new Date(), tz).date}
      timeZone={tz}
      currency={booking.currency}
      loadDay={(turfId, date) =>
        apiGet<{ day: OwnerSlotDay }>(`${venuePath}/turfs/${encodeURIComponent(turfId)}/slots?date=${date}`).then((r) => gridDayOf(r.day))
      }
      move={({ turfId, date, startAts }) =>
        apiPost<{ booking: OwnerBooking }>(ownerPath(ownerId, `/bookings/${encodeURIComponent(booking.id)}/reschedule`), {
          turfId,
          date,
          startAts,
        }).then((r) => r.booking)
      }
      onMoved={onMoved}
      onConflict={onConflict}
    />
  );
}
