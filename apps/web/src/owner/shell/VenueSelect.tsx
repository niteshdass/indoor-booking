import { useTranslation } from 'react-i18next';
import { Select } from '../../components/ui/Select';
import { useOwner } from '../OwnerProvider';
import { useVenueParam } from './useVenueParam';

/** Venue picker bound to `?venue=`; a single venue needs no choice, so it renders nothing. */
export function VenueSelect() {
  const { t } = useTranslation();
  const { venues } = useOwner();
  const [venue, setVenueId] = useVenueParam();
  if (venues.length < 2) return null;
  return (
    <Select
      icon="venue"
      label={t('owner.venue')}
      value={venue?.id ?? ''}
      onChange={(e) => setVenueId(e.target.value)}
      options={venues.map((v) => ({ value: v.id, label: v.name }))}
    />
  );
}
