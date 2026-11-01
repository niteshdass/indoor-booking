import type { OwnerSettings } from '@booking/shared';
import { apiPatch } from '../../lib/apiClient';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { SettingsForm } from '../settings/SettingsForm';
import { useReadyGateways } from '../settings/PaymentMethodsFields';
import type { OwnerVenue } from '../types';
import styles from './venues.module.css';

type Props = {
  venue: OwnerVenue;
  /** The owner's settings the venue inherits from; null when they could not be loaded. */
  ownerSettings: OwnerSettings | null;
  onSaved(v: OwnerVenue): void;
};

/** Per-venue overrides of the owner's settings; an absent key inherits. Saved under the venue's `settings` key. */
export function VenueSettingsTab({ venue, ownerSettings, onSaved }: Props) {
  const { ownerId, can, reloadVenues } = useOwner();

  const gateways = useReadyGateways();

  const save = async (patch: Record<string, unknown>) => {
    const res = await apiPatch<{ venue: OwnerVenue }>(ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}`), { settings: patch });
    onSaved(res.venue);
    reloadVenues();
  };

  return (
    <div className={styles.page}>
      <SettingsForm
        level="venue"
        stored={venue.settings}
        effective={venue.effectiveSettings}
        inherited={ownerSettings}
        currency={venue.currency}
        onSave={save}
        disabled={!can('venue.manage')}
        readyGateways={gateways.ready}
        canConnectGateways={gateways.canConnect}
      />
    </div>
  );
}
