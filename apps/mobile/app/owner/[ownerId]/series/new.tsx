import { useLocalSearchParams } from 'expo-router';
import { NewSeries } from '../../../../src/owner/series/NewSeries';

/** Owner adds a weekly series for a customer. */
export default function OwnerNewSeriesScreen() {
  const { venue } = useLocalSearchParams<{ venue?: string }>();
  return <NewSeries venueParam={venue} />;
}
