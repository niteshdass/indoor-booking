import { CancelDialog } from '../../bookings/CancelDialog';
import { apiGet, apiPost } from '../../lib/apiClient';
import type { CancellationPreview } from '../../lib/types';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { OwnerBooking, RefundJson } from '../types';

type Props = {
  bookingId: string;
  open: boolean;
  onClose: () => void;
  onCancelled(b: OwnerBooking, refunds: RefundJson[]): void;
};

/** The staff cancel dialog for one booking: previews the refund, then cancels with an optional reason. */
export function OwnerCancelDialog({ bookingId, open, onClose, onCancelled }: Props) {
  const { ownerId } = useOwner();
  const base = ownerPath(ownerId, `/bookings/${encodeURIComponent(bookingId)}`);
  return (
    <CancelDialog<OwnerBooking>
      audience="staff"
      open={open}
      onClose={onClose}
      loadPreview={() => apiGet<{ preview: CancellationPreview }>(`${base}/cancellation`).then((r) => r.preview)}
      cancel={(reason) => apiPost<{ booking: OwnerBooking; refunds: RefundJson[] }>(`${base}/cancel`, reason ? { reason } : {})}
      onCancelled={onCancelled}
    />
  );
}
