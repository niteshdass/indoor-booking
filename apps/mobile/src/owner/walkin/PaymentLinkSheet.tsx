import { useTranslation } from 'react-i18next';
import { formatMoney } from '@booking/shared';
import { Button, Sheet } from '../../ui';
import { PaymentLinkCard } from '../PaymentLinkCard';
import type { PaymentLink } from '../types';

export interface PaymentLinkSheetProps {
  link: PaymentLink | null;
  /** Customer name for the lead line. */
  name: string;
  onOpenBooking(): void;
  onDone(): void;
}

/** After a walk-in with "Send a payment link": the link to share with the customer (web PaymentLinkDialog). */
export function PaymentLinkSheet({ link, name, onOpenBooking, onDone }: PaymentLinkSheetProps) {
  const { t: tr, i18n } = useTranslation();
  return (
    <Sheet
      visible={link !== null}
      onClose={onDone}
      title={tr('mobile.owner.walkin.linkTitle')}
      subtitle={link ? tr('mobile.owner.walkin.linkBody', { name, amount: formatMoney(link.amount, link.currency, i18n.language) }) : undefined}
    >
      {link ? (
        <>
          <PaymentLinkCard url={link.url} shareLabel={tr('mobile.owner.walkin.shareLink')} />
          <Button label={tr('mobile.owner.walkin.openBooking')} variant="secondary" onPress={onOpenBooking} />
          <Button label={tr('owner.bookings.done')} variant="ghost" onPress={onDone} />
        </>
      ) : null}
    </Sheet>
  );
}
