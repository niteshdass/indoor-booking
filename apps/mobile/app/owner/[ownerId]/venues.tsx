import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Sport } from '@booking/shared';
import { useResource } from '../../../src/lib/useResource';
import { ownerHref, ownerPath } from '../../../src/owner/labels';
import { useOwner } from '../../../src/owner/OwnerProvider';
import type { OwnerTurf, OwnerVenue } from '../../../src/owner/types';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { BackButton, Badge, Empty, Group, Row, Screen, Text, WebNote } from '../../../src/ui';

/** One venue row; its court count and sports load with it and stay blank until they arrive. */
function VenueRow({ venue }: { venue: OwnerVenue }) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { ownerId } = useOwner();
  const { state } = useResource<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs`));
  let detail = venue.city;
  if (state.status === 'ready') {
    const sports = [...new Set(state.data.turfs.flatMap((x) => x.sports))] as Sport[];
    detail = [tr('mobile.owner.venues.courts', { count: state.data.turfs.length }), sports.map((s) => tr(`sports.${s}`)).join(', ')]
      .filter(Boolean)
      .join(' · ');
  }
  return (
    <Row
      icon="venue"
      title={venue.name}
      detail={detail}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
          <Badge tone={venue.published ? 'success' : 'neutral'} label={tr(venue.published ? 'owner.venues.published' : 'owner.venues.draft')} />
        </View>
      }
      onPress={() => router.push(ownerHref(ownerId, `/venue/${encodeURIComponent(venue.id)}`))}
    />
  );
}

export default function OwnerVenuesScreen() {
  const { t: tr } = useTranslation();
  const { venues } = useOwner();
  return (
    <Screen scroll>
      <BackButton />
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {tr('owner.nav.venues')}
      </Text>
      {venues.length === 0 ? (
        <Empty>{tr('owner.venues.empty')}</Empty>
      ) : (
        <Group>
          {venues.map((v) => (
            <VenueRow key={v.id} venue={v} />
          ))}
        </Group>
      )}
      <WebNote>{tr('mobile.owner.venues.webNote')}</WebNote>
    </Screen>
  );
}
