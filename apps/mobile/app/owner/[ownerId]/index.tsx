import { Redirect, useLocalSearchParams } from 'expo-router';

/** `/owner/:ownerId` opens the Today tab. */
export default function OwnerTeamIndex() {
  const { ownerId } = useLocalSearchParams<{ ownerId: string }>();
  return <Redirect href={`/owner/${ownerId}/today`} />;
}
