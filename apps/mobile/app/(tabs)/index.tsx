import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { EMPTY_CRITERIA, type Criteria, type SearchResult, type Sport } from '@booking/shared';
import { apiGet } from '../../src/lib/api';
import { errorMessage } from '../../src/lib/errors';
import { Chip } from '../../src/search/Chip';
import { FindHero } from '../../src/search/FindHero';
import { SearchBox } from '../../src/search/SearchBox';
import { SportChips } from '../../src/search/SportChips';
import { useNearMe } from '../../src/search/useNearMe';
import { PAGE_SIZE, useSearch } from '../../src/search/useSearch';
import { VenueCard } from '../../src/search/VenueCard';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button, Icon, Screen, Text } from '../../src/ui';

export default function FindScreen() {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const router = useRouter();
  const [sports, setSports] = useState<Sport[]>([]);
  const [criteria, setCriteria] = useState<Criteria>(EMPTY_CRITERIA);
  const near = useNearMe();
  const { results, status, error, hasMore, loadMore, retry } = useSearch(criteria);

  useEffect(() => {
    let live = true;
    apiGet<{ sports: Sport[] }>('/sports')
      .then((r) => live && setSports(r.sports))
      .catch(() => undefined); // The chips are a filter, not the screen: without them "Any sport" still works.
    return () => {
      live = false;
    };
  }, []);

  const locate = async () => {
    const c = await near.locate();
    if (c) setCriteria((cur) => ({ ...cur, near: c }));
  };
  const clearNear = () => setCriteria((cur) => ({ ...cur, near: null }));

  const open = (v: SearchResult) => router.push({ pathname: '/venue/[slug]', params: { slug: v.slug } });

  // Without location the search box is the way in: it matches venue name, address and city.
  const locationChip = criteria.near ? (
    <Chip selected accessibilityRole="button" accessibilityLabel={tr('search.clearLocation')} onPress={clearNear}>
      <Icon name="locate" color={t.primary} size={t.iconSm} />
      <Text variant="label" tone="primary" weight="semibold">
        {tr('search.locationSet')}
      </Text>
      <Icon name="close" color={t.primary} size={t.iconSm} />
    </Chip>
  ) : near.blocked ? null : (
    <Chip
      accessibilityRole="button"
      accessibilityLabel={tr('search.useMyLocation')}
      accessibilityHint={near.locating ? tr('mobile.find.locating') : undefined}
      accessibilityState={{ busy: near.locating }}
      disabled={near.locating}
      onPress={() => void locate()}
    >
      {near.locating ? <ActivityIndicator size="small" color={t.primary} /> : <Icon name="locate" color={t.textMuted} size={t.iconSm} />}
      <Text variant="label" tone="strong">
        {tr('search.useMyLocation')}
      </Text>
    </Chip>
  );

  const header = (
    <View style={{ gap: t.space3, marginBottom: t.space3 }}>
      <FindHero>
        <SearchBox raised value={criteria.text} onChange={(text) => setCriteria((cur) => (cur.text === text ? cur : { ...cur, text }))} />
      </FindHero>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2, paddingVertical: t.space1 }}>
        <SportChips sports={sports} value={criteria.sport} onChange={(sport) => setCriteria((cur) => ({ ...cur, sport }))} />
        {locationChip}
      </View>
      {!criteria.near && (near.blocked || near.failed) ? (
        <Text variant="caption" tone="muted" accessibilityRole="alert">
          {near.blocked ? tr('mobile.find.locationDenied') : tr('mobile.find.locationFailed')}
        </Text>
      ) : null}
    </View>
  );

  const footer =
    status === 'loading' ? (
      <ActivityIndicator accessibilityLabel={tr('common.loading')} />
    ) : status === 'error' ? (
      <View style={{ gap: t.space2 }}>
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(error, tr)}
        </Text>
        <Button label={tr('search.retry')} onPress={retry} />
      </View>
    ) : hasMore ? (
      <Button label={tr('search.loadMore')} variant="secondary" onPress={loadMore} />
    ) : null;

  const empty =
    status === 'idle' && !hasMore ? (
      <View style={{ gap: t.space1 }}>
        <Text variant="title" tone="strong">
          {tr('search.emptyTitle')}
        </Text>
        <Text tone="muted">{tr('search.empty')}</Text>
      </View>
    ) : null;

  return (
    <Screen>
      <FlatList
        data={results}
        keyExtractor={(v) => v.slug}
        renderItem={({ item }) => <VenueCard venue={item} onPress={open} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty ?? undefined}
        ListFooterComponent={footer ?? undefined}
        ItemSeparatorComponent={() => <View style={{ height: t.space2 }} />}
        contentContainerStyle={{ paddingBottom: t.space4 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        initialNumToRender={PAGE_SIZE * 2}
        style={{ flex: 1 }}
      />
    </Screen>
  );
}
