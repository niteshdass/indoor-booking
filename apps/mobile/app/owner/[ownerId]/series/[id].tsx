import { useLocalSearchParams } from 'expo-router';
import { SeriesDetail } from '../../../../src/owner/series/SeriesDetail';

/** One series: answer a request or cancel future games. */
export default function OwnerSeriesDetailScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return <SeriesDetail seriesId={id} />;
}
