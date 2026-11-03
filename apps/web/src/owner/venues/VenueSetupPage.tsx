import { useTranslation } from 'react-i18next';
import type { SetupResult, VenueSetup } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { apiPost } from '../../lib/apiClient';
import { localTimeZone } from '../../lib/regions';
import { defaultAnswers, toVenueSetup } from '../../onboarding/answers';
import { SetupDone } from '../../onboarding/SetupDone';
import { SetupWizard } from '../../onboarding/SetupWizard';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';

/** `venues/setup`: the easy setup for one more venue of a running business, in its country and currency. */
export function VenueSetupPage() {
  const { t } = useTranslation();
  const { ownerId, owner, can, membership, reloadVenues } = useOwner();
  useOwnerTitle(t('onboarding.addVenue'));

  if (!(can('venue.manage') && can('turf.manage') && can('pricing.edit') && membership.venueIds === 'all')) {
    return <Alert tone="info">{t('onboarding.notAllowed')}</Alert>;
  }
  return (
    <SetupWizard
      mode="venue"
      draftKey={`setup-draft:${ownerId}`}
      initial={defaultAnswers(owner.country, owner.defaultCurrency)}
      mapLinkPath={ownerPath(ownerId, '/map-link')}
      submit={async (a) => {
        const body: VenueSetup = toVenueSetup(a, localTimeZone() || 'UTC', (n) => t('onboarding.turfs.numbered', { n }));
        const r = await apiPost<SetupResult>(ownerPath(ownerId, '/onboarding'), body);
        await reloadVenues();
        return r;
      }}
      done={(result) => <SetupDone result={result} />}
    />
  );
}
