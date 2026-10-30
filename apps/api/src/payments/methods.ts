import type { Config } from '../config';
import type { EffectiveSettings, ManualWallet } from '@booking/shared';
import type { AppServices } from '../services';
import type { VenueDoc } from '../venues/venue.model';
import { loadGateway, type LoadedGateway } from './gateway.model';

/** The gateway is switched on and can take this venue's country and currency. */
export const gatewayUsable = (loaded: LoadedGateway | null, country: string, currency: string): loaded is LoadedGateway =>
  !!loaded && loaded.row.enabled && loaded.gateway.supports(country, currency);

/** What a player can pay with at this venue now: its manual wallets, and cards while Stripe is usable. */
export async function offeredMethods(
  ownerId: string,
  venue: VenueDoc,
  settings: EffectiveSettings,
  ctx: { config: Config; services: AppServices },
): Promise<{ wallets: ManualWallet[]; card: boolean }> {
  const { manualWallets, gateways } = settings.paymentMethods;
  const card =
    gateways.includes('stripe') &&
    gatewayUsable(await loadGateway(ownerId, 'stripe', ctx.config, ctx.services), venue.country, venue.currency);
  return { wallets: manualWallets, card };
}
