import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { apiPatch } from '../../../../../src/lib/api';
import { errorMessage } from '../../../../../src/lib/errors';
import { useResource } from '../../../../../src/lib/useResource';
import { ownerHref, ownerPath } from '../../../../../src/owner/labels';
import { useOwner } from '../../../../../src/owner/OwnerProvider';
import type { OwnerTurf, OwnerVenue } from '../../../../../src/owner/types';
import { hoursSummary, turfSummary } from '../../../../../src/owner/venues/format';
import { useTheme } from '../../../../../src/theme/ThemeProvider';
import { BackButton, Badge, ErrorState, Group, GroupLabel, Loading, Row, Screen, Text, WebNote } from '../../../../../src/ui';

/** Venue detail: show-to-players switch, its courts, and a read-only summary of what is edited on the web. */
export default function OwnerVenueScreen() {
  const { t: tr } = useTranslation();
  const { venueId = '' } = useLocalSearchParams<{ venueId: string }>();
  const { ownerId, venues } = useOwner();
  const known = venues.find((v) => v.id === venueId);
  const fetched = useResource<{ venue: OwnerVenue }>(known ? null : ownerPath(ownerId, `/venues/${encodeURIComponent(venueId)}`));
  const venue = known ?? (fetched.state.status === 'ready' ? fetched.state.data.venue : undefined);
  return (
    <Screen scroll>
      <BackButton />
      {venue ? (
        <VenueBody venue={venue} />
      ) : fetched.state.status === 'error' ? (
        <Text tone="warning" accessibilityRole="alert">
          {tr('owner.venues.notFound')}
        </Text>
      ) : (
        <Loading />
      )}
    </Screen>
  );
}

function VenueBody({ venue }: { venue: OwnerVenue }) {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const { ownerId, can, reloadVenues } = useOwner();
  const base = ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}`);
  const turfs = useResource<{ turfs: OwnerTurf[] }>(`${base}/turfs`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Coming back from the court editor: show its changes.
  const { reload } = turfs;
  const seen = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (seen.current) reload();
      seen.current = true;
    }, [reload]),
  );

  const togglePublish = async (published: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPatch(base, { published });
      await reloadVenues();
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  const photos = venue.photos.length;
  return (
    <>
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {venue.name}
      </Text>
      {can('venue.manage') ? (
        <Group>
          <Row
            title={tr('mobile.owner.venues.show')}
            detail={tr('mobile.owner.venues.showHint')}
            toggle={{ value: venue.published, onChange: (v) => void togglePublish(v), disabled: busy }}
          />
        </Group>
      ) : (
        <Badge tone={venue.published ? 'success' : 'neutral'} label={tr(venue.published ? 'owner.venues.published' : 'owner.venues.draft')} />
      )}
      {error !== null ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(error, tr)}
        </Text>
      ) : null}

      <View style={{ gap: t.space2 }}>
        <GroupLabel>{tr('mobile.owner.venues.courtsTitle')}</GroupLabel>
        {turfs.state.status === 'error' ? (
          <ErrorState error={turfs.state.error} onRetry={turfs.reload} />
        ) : turfs.state.status !== 'ready' ? (
          <Loading />
        ) : (
          <Group>
            {turfs.state.data.turfs.map((x) => (
              <Row
                key={x.id}
                icon="court"
                title={x.name}
                detail={turfSummary(x, venue.currency, tr, i18n.language)}
                right={x.active ? undefined : <Badge label={tr('owner.venues.turfInactive')} />}
                onPress={() => router.push(ownerHref(ownerId, `/venue/${encodeURIComponent(venue.id)}/court/${encodeURIComponent(x.id)}`))}
              />
            ))}
            {turfs.state.data.turfs.length === 0 ? <Row title={tr('owner.venues.noTurfs')} /> : null}
            {can('turf.manage') ? (
              <Row
                icon="plus"
                tone="primary"
                title={tr('mobile.owner.venues.addCourt')}
                onPress={() => router.push(ownerHref(ownerId, `/venue/${encodeURIComponent(venue.id)}/court/new`))}
              />
            ) : null}
          </Group>
        )}
      </View>

      <View style={{ gap: t.space2 }}>
        <GroupLabel>{tr('mobile.owner.venues.venueTitle')}</GroupLabel>
        <Group>
          <Row icon="pin" title={tr('mobile.owner.venues.address')} detail={[venue.address, venue.city].filter(Boolean).join(', ')} />
          <Row
            icon="upload"
            title={tr('owner.venues.photos')}
            detail={photos > 0 ? tr('mobile.owner.venues.photos', { count: photos }) : tr('mobile.owner.venues.noPhotos')}
          />
          <Row icon="clock" title={tr('mobile.owner.venues.hours')} detail={hoursSummary(venue.effectiveSettings.hours, tr)} />
        </Group>
      </View>
      <WebNote>{tr('mobile.owner.venues.detailsNote')}</WebNote>
    </>
  );
}
