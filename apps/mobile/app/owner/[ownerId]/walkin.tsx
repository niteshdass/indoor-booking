import { useLocalSearchParams } from 'expo-router';
import { WalkInFlow } from '../../../src/owner/walkin/WalkInFlow';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Full-screen walk-in modal; optional `venue`, `turf`, `date`, `start` params prefill it (e.g. from a free gap on Today). */
export default function WalkInScreen() {
  const p = useLocalSearchParams<{ venue?: string; turf?: string; date?: string; start?: string }>();
  return <WalkInFlow prefill={{ venue: one(p.venue), turf: one(p.turf), date: one(p.date), start: one(p.start) }} />;
}
