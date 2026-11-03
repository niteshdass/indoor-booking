import { Image, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney, type SearchResult } from '@booking/shared';
import { useTheme } from '../theme/ThemeProvider';
import { Card, Text } from '../ui';

export interface VenueCardProps {
  venue: SearchResult;
  onPress(venue: SearchResult): void;
}

/**
 * One search result, compact: photo, then name and "km · place" on one line each, then price · free today · ★ rating.
 * The whole card is one 44pt+ target; its label carries the sports the card leaves out.
 */
export function VenueCard({ venue: v, onPress }: VenueCardProps) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const place = v.address && v.address !== v.city ? `${v.address}, ${v.city}` : v.city;
  const sports = v.sports.map((s) => tr(`sports.${s}`)).join(', ');
  const price = v.fromPrice === null ? tr('search.noPrice') : tr('search.fromPrice', { price: formatMoney(v.fromPrice, v.currency, i18n.language) });
  const free = v.freeTimeCount > 0 ? tr('search.freeToday') : tr('search.noFreeSlot');
  const km = v.distanceMeters === null ? null : tr('search.km', { count: Math.max(1, Math.round(v.distanceMeters / 1000)) });
  const average = v.rating
    ? new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v.rating.average)
    : null;
  const thumb = { width: t.photoThumbSm, height: t.photoThumbSm, borderRadius: t.radiusMd, backgroundColor: t.controlFill };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[v.name, place, sports, price].filter(Boolean).join(', ')}
      onPress={() => onPress(v)}
    >
      {({ pressed }) => (
        <Card style={{ flexDirection: 'row', alignItems: 'center', padding: t.space3, gap: t.space3, backgroundColor: pressed ? t.bgHover : t.bgSurface }}>
          {v.photo ? <Image source={{ uri: v.photo.url }} accessibilityIgnoresInvertColors style={thumb} /> : <View style={thumb} />}
          <View style={{ flex: 1, gap: t.space1 }}>
            <Text variant="title" tone="strong" numberOfLines={1}>
              {v.name}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {km ? `${km} · ${place}` : place}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: t.space2 }}>
              <Text variant="label" tone="strong">
                {price}
              </Text>
              <Text variant="caption" tone={v.freeTimeCount > 0 ? 'success' : 'subtle'}>
                {free}
              </Text>
              {v.rating && average ? (
                <Text
                  variant="caption"
                  tone="muted"
                  accessibilityLabel={tr('reviews.cardLabel', { value: average, count: v.rating.count })}
                >
                  {`★ ${average} (${new Intl.NumberFormat(i18n.language).format(v.rating.count)})`}
                </Text>
              ) : null}
            </View>
          </View>
        </Card>
      )}
    </Pressable>
  );
}
