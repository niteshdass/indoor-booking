import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { EMPTY_CRITERIA, type Criteria, type SearchResult, type Sport } from '@booking/shared';
import { apiGet } from '../../src/lib/api';
import { errorMessage } from '../../src/lib/errors';
import { SportChips } from '../../src/search/SportChips';
import { useNearMe } from '../../src/search/useNearMe';
import { useSearch } from '../../src/search/useSearch';
import { VenueCard } from '../../src/search/VenueCard';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button, Field, Screen, Text } from '../../src/ui';

/** Where the search is centred: the phone, or a typed city. */
type Origin = { kind: 'gps' } | { kind: 'city'; name: string };

export default function FindScreen() {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const router = useRouter();
  const [sports, setSports] = useState<Sport[]>([]);
  const [criteria, setCriteria] = useState<Criteria>(EMPTY_CRITERIA);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [city, setCity] = useState('');
  const [cityError, setCityError] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
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
    if (!c) return;
    setCriteria((cur) => ({ ...cur, near: c }));
    setOrigin({ kind: 'gps' });
  };

  const searchCity = async () => {
    const name = city.trim();
    if (!name) return;
    setGeocoding(true);
    setCityError(false);
    try {
      const [hit] = await Location.geocodeAsync(name);
      if (!hit) {
        setCityError(true);
        return;
      }
      setCriteria((cur) => ({ ...cur, near: { lat: hit.latitude, lng: hit.longitude } }));
      setOrigin({ kind: 'city', name });
    } catch {
      setCityError(true);
    } finally {
      setGeocoding(false);
    }
  };

  const clearOrigin = () => {
    setCriteria((cur) => ({ ...cur, near: null }));
    setOrigin(null);
  };

  const open = (v: SearchResult) => router.push({ pathname: '/venue/[slug]', params: { slug: v.slug } });

  const header = (
    <View style={{ gap: t.space3, marginBottom: t.space4 }}>
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {tr('mobile.tabs.find')}
      </Text>
      <SportChips sports={sports} value={criteria.sport} onChange={(sport) => setCriteria((cur) => ({ ...cur, sport }))} />
      {origin ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.space2 }}>
          <Text tone="muted" style={{ flexShrink: 1 }}>
            {origin.kind === 'gps' ? tr('search.locationSet') : origin.name}
          </Text>
          <Button label={tr('search.clearLocation')} variant="ghost" onPress={clearOrigin} />
        </View>
      ) : near.blocked ? (
        <View style={{ gap: t.space2 }}>
          <Text tone="muted">{tr('mobile.find.locationDenied')}</Text>
          <Field
            label={tr('mobile.find.cityLabel')}
            placeholder={tr('mobile.find.cityPlaceholder')}
            value={city}
            onChangeText={(v) => {
              setCity(v);
              setCityError(false);
            }}
            onSubmitEditing={() => void searchCity()}
            returnKeyType="search"
            error={cityError ? tr('mobile.find.cityNotFound') : undefined}
          />
          <Button label={tr('search.submit')} loading={geocoding} disabled={!city.trim()} onPress={() => void searchCity()} />
        </View>
      ) : (
        <>
          {near.failed ? (
            <Text tone="muted" accessibilityRole="alert">
              {tr('mobile.find.locationFailed')}
            </Text>
          ) : null}
          <Button
            label={tr('search.useMyLocation')}
            variant="secondary"
            loading={near.locating}
            accessibilityHint={near.locating ? tr('mobile.find.locating') : undefined}
            onPress={() => void locate()}
          />
        </>
      )}
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
    status === 'idle' ? (
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
        ItemSeparatorComponent={() => <View style={{ height: t.space3 }} />}
        contentContainerStyle={{ paddingBottom: t.space4 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
      />
    </Screen>
  );
}
