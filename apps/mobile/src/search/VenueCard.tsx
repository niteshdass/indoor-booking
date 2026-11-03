import { Image, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney, type SearchResult } from '@booking/shared';
import { useTheme } from '../theme/ThemeProvider';
import { Card, Text } from '../ui';

export interface VenueCardProps {
  venue: SearchResult;
  onPress(venue: SearchResult): void;
}

/** One search result: photo, name, place, sports, price and rating. The whole card is one 44pt+ target. */
export function VenueCard({ venue: v, onPress }: VenueCardProps) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const place = v.address && v.address !== v.city ? `${v.address}, ${v.city}` : v.city;
  const sports = v.sports.map((s) => tr(`sports.${s}`)).join(', ');
  const price = v.fromPrice === null ? tr('search.noPrice') : tr('search.fromPrice', { price: formatMoney(v.fromPrice, v.currency, i18n.language) });
  const free = v.freeTimeCount > 0 ? tr('search.freeToday') : tr('search.noFreeSlot');
  const km = v.distanceMeters === null ? null : tr('search.km', { count: Math.max(1, Math.round(v.distanceMeters / 1000)) });
  const rating = v.rating
    ? tr('reviews.cardLabel', { value: new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v.rating.average), count: v.rating.count })
    : null;

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${v.name}, ${place}, ${price}`} onPress={() => onPress(v)}>
      {({ pressed }) => (
        <Card style={{ flexDirection: 'row', gap: t.space3, backgroundColor: pressed ? t.bgHover : t.bgSurface }}>
          {v.photo ? (
            <Image
              source={{ uri: v.photo.url }}
              accessibilityIgnoresInvertColors
              style={{ width: t.photoThumb, height: t.photoThumb, borderRadius: t.radiusMd, backgroundColor: t.controlFill }}
            />
          ) : (
            <View style={{ width: t.photoThumb, height: t.photoThumb, borderRadius: t.radiusMd, backgroundColor: t.controlFill }} />
          )}
          <View style={{ flex: 1, gap: t.space1 }}>
            <Text variant="title" tone="strong">
              {v.name}
            </Text>
            <Text variant="caption" tone="muted">
              {km ? `${km} · ${place}` : place}
            </Text>
            {sports ? (
              <Text variant="caption" tone="muted">
                {sports}
              </Text>
            ) : null}
            <Text variant="label" tone="strong">
              {price}
            </Text>
            <Text variant="caption" tone={v.freeTimeCount > 0 ? 'success' : 'subtle'}>
              {free}
            </Text>
            {rating ? (
              <Text variant="caption" tone="muted">
                {`★ ${rating}`}
              </Text>
            ) : null}
          </View>
        </Card>
      )}
    </Pressable>
  );
}
