import { Share, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@booking/shared';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, Sheet, Text } from '../../ui';
import type { PaymentLink } from '../types';

export interface PaymentLinkSheetProps {
  link: PaymentLink | null;
  /** Customer name for the lead line. */
  name: string;
  onOpenBooking(): void;
  onDone(): void;
}

/** After a walk-in with "Send a payment link": the link to share with the customer (web PaymentLinkDialog, without the QR). */
export function PaymentLinkSheet({ link, name, onOpenBooking, onDone }: PaymentLinkSheetProps) {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const share = () => {
    if (link) void Share.share({ message: link.url }).catch(() => undefined);
  };
  return (
    <Sheet
      visible={link !== null}
      onClose={onDone}
      title={tr('mobile.owner.walkin.linkTitle')}
      subtitle={link ? tr('mobile.owner.walkin.linkBody', { name, amount: formatMoney(link.amount, link.currency, i18n.language) }) : undefined}
    >
      {link ? (
        <>
          <View style={{ backgroundColor: t.bgSubtle, borderRadius: t.radiusMd, padding: t.space3, gap: t.space1 }}>
            <Text variant="caption" tone="muted">
              {tr('owner.link.url')}
            </Text>
            <Text selectable tone="strong" style={{ fontVariant: ['tabular-nums'] }}>
              {link.url}
            </Text>
          </View>
          <Button label={tr('mobile.owner.walkin.shareLink')} onPress={share} />
          <Button label={tr('mobile.owner.walkin.openBooking')} variant="secondary" onPress={onOpenBooking} />
          <Button label={tr('owner.bookings.done')} variant="ghost" onPress={onDone} />
        </>
      ) : null}
    </Sheet>
  );
}
