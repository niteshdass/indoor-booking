import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney, localParts } from '@booking/shared';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';
import type { QuoteCoupon, QuoteJson } from './types';

export interface QuoteSummaryProps {
  quote: QuoteJson;
  coupon: QuoteCoupon | null;
  /** Venue IANA timezone: slot times are on its clock. */
  timeZone: string;
}

function Row({ label, value, strong, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  const { t } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: t.space2 }}>
      <Text tone={strong ? 'strong' : 'default'} weight={strong ? 'semibold' : 'regular'} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Text tone="strong" weight={strong ? 'bold' : 'medium'}>
        {value}
      </Text>
    </View>
  );
}

/** Slot and extra lines, then the sums. Mirrors the single-booking part of apps/web/src/checkout/BookingSummary.tsx. */
export function QuoteSummary({ quote, coupon, timeZone }: QuoteSummaryProps) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const fmt = (n: number) => formatMoney(n, quote.currency, i18n.language);
  const fee = quote.platformFee?.payer === 'player' ? quote.platformFee.amount : 0;
  const due = quote.advanceRequired;
  const rule = <View style={{ height: t.hairline, backgroundColor: t.borderSubtle }} />;

  return (
    <View style={{ gap: t.space2 }} accessibilityLiveRegion="polite">
      {quote.slots.map((s) => {
        const from = localParts(new Date(s.startAt), timeZone).hm;
        const to = localParts(new Date(s.endAt), timeZone).hm;
        return <Row key={s.startAt} label={`${from}–${to}`} value={fmt(s.price)} />;
      })}
      {quote.addons.map((a) => (
        <Row
          key={`${a.addonId}-${a.auto ? 'auto' : 'pick'}`}
          label={`${a.name}${a.quantity > 1 ? ` × ${a.quantity}` : ''}${a.auto ? ` · ${tr('checkout.autoAdded')}` : ''}`}
          value={fmt(a.total)}
        />
      ))}
      {rule}
      <Row label={tr('checkout.subtotal')} value={fmt(quote.subtotal)} />
      {quote.addonsTotal > 0 ? <Row label={tr('checkout.addonsTotal')} value={fmt(quote.addonsTotal)} /> : null}
      {coupon && quote.discount > 0 ? <Row label={tr('checkout.promo.discount', { code: coupon.code })} value={fmt(-quote.discount)} /> : null}
      {fee > 0 ? <Row label={tr('checkout.platformFee')} value={fmt(fee)} /> : null}
      {rule}
      <Row testID="quote-total" label={tr('checkout.total')} value={fmt(quote.total)} strong />
      {due > 0 ? (
        <>
          <Row label={tr('checkout.advanceDue')} value={fmt(due)} />
          <Row label={tr('checkout.payLater')} value={fmt(quote.total - due)} />
        </>
      ) : null}
    </View>
  );
}
