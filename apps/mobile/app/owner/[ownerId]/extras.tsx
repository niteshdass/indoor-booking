import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney, parseMoney } from '@booking/shared';
import { apiPut } from '../../../src/lib/api';
import { errorMessage } from '../../../src/lib/errors';
import { useResource } from '../../../src/lib/useResource';
import { ownerPath } from '../../../src/owner/labels';
import { useOwner } from '../../../src/owner/OwnerProvider';
import { ChipPicker } from '../../../src/owner/setup/ChipPicker';
import { minorToInput } from '../../../src/owner/setup/couponForm';
import { ToggleRow } from '../../../src/owner/setup/ToggleRow';
import type { Addon, Assignment, OwnerVenue } from '../../../src/owner/types';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { BackButton, Button, Empty, ErrorState, Field, Group, Loading, Screen, Sheet, Text, WebNote } from '../../../src/ui';

/** Venue-level extras: switch each catalogue add-on on or off for a venue and set its price there. */
export default function OwnerExtrasScreen() {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { ownerId, venues } = useOwner();
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '');
  const venue = venues.find((v) => v.id === venueId);
  const catalogue = useResource<{ addons: Addon[] }>(ownerPath(ownerId, '/addons'));
  const assigned = useResource<{ assignments: Assignment[] }>(venue ? ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/addons`) : null);

  let body;
  if (catalogue.state.status === 'error') body = <ErrorState error={catalogue.state.error} onRetry={catalogue.reload} />;
  else if (assigned.state.status === 'error') body = <ErrorState error={assigned.state.error} onRetry={assigned.reload} />;
  else if (catalogue.state.status === 'ready' && assigned.state.status === 'ready' && venue) {
    const addons = catalogue.state.data.addons;
    const rows = assigned.state.data.assignments.filter((a) => a.turfId === null);
    body =
      addons.length === 0 ? (
        <Empty>{tr('owner.addons.assign.none')}</Empty>
      ) : (
        <ExtrasList key={venue.id} venue={venue} addons={addons} rows={rows} onChanged={assigned.reload} />
      );
  } else if (!venue) body = <Empty>{tr('owner.venues.empty')}</Empty>;
  else body = <Loading />;

  return (
    <Screen scroll>
      <BackButton />
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {tr('owner.nav.addons')}
      </Text>
      {venues.length > 1 ? (
        <ChipPicker label={tr('owner.closures.venue')} options={venues.map((v) => ({ id: v.id, name: v.name }))} value={venueId} onChange={setVenueId} />
      ) : null}
      <View style={{ gap: t.space3 }}>{body}</View>
      <WebNote>{tr('mobile.owner.setup.extras.webNote')}</WebNote>
    </Screen>
  );
}

type Save = { enabled: boolean; priceOverride: number | null };

function ExtrasList({ venue, addons, rows, onChanged }: { venue: OwnerVenue; addons: Addon[]; rows: Assignment[]; onChanged(): void }) {
  const { t: tr, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<Addon | null>(null);
  const rowOf = (a: Addon) => rows.find((r) => r.addonId === a.id) ?? null;

  /** PUT exactly as the web assignment row does; stock is kept as it is (it is edited on the web). */
  const save = async (addon: Addon, next: Save): Promise<string | null> => {
    if (next.enabled && next.priceOverride === null && addon.currency !== venue.currency) return tr('errors.price_override_required');
    const body: { enabled: boolean; priceOverride: number | null; stock?: number | null } = { ...next };
    if (addon.autoApply === null) body.stock = rowOf(addon)?.stock ?? null;
    setBusy(addon.id);
    try {
      await apiPut(ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/addons/${encodeURIComponent(addon.id)}`), body);
      onChanged();
      return null;
    } catch (err) {
      return errorMessage(err, tr);
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (addon: Addon, enabled: boolean) => {
    setError(null);
    const fail = await save(addon, { enabled, priceOverride: rowOf(addon)?.priceOverride ?? null });
    if (fail) {
      setError(fail);
      // Another currency needs a venue price first: open the price sheet instead of failing silently.
      if (enabled && addon.currency !== venue.currency && rowOf(addon)?.priceOverride == null) setPricing(addon);
    }
  };

  return (
    <>
      {error !== null ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Group>
        {addons.map((a) => {
          const row = rowOf(a);
          const enabled = row?.enabled ?? false;
          const catalogue = formatMoney(a.price, a.currency, i18n.language);
          const effective = row?.priceOverride != null ? formatMoney(row.priceOverride, venue.currency, i18n.language) : catalogue;
          const detail = [
            row?.priceOverride != null ? `${effective} · ${tr('mobile.owner.setup.extras.catalogue', { price: catalogue })}` : effective,
            tr(`owner.addons.type.${a.pricingType}`),
            tr(enabled ? 'owner.addons.assign.enabled' : 'owner.coupons.state.off'),
          ].join(' · ');
          return (
            <ToggleRow
              key={a.id}
              title={a.name}
              detail={detail}
              onPress={() => setPricing(a)}
              value={enabled}
              onChange={(v) => void toggle(a, v)}
              disabled={busy === a.id}
              switchLabel={tr('mobile.owner.setup.extras.offerLabel', { name: a.name })}
            />
          );
        })}
      </Group>
      <Text variant="caption" tone="muted">
        {tr('mobile.owner.setup.extras.tapHint')}
      </Text>
      <Sheet
        visible={pricing !== null}
        onClose={() => setPricing(null)}
        title={pricing ? tr('mobile.owner.setup.extras.priceTitle', { name: pricing.name, venue: venue.name }) : undefined}
      >
        {pricing ? (
          <PriceForm
            key={pricing.id}
            addon={pricing}
            venue={venue}
            row={rowOf(pricing)}
            onSave={async (next) => {
              const fail = await save(pricing, next);
              if (!fail) {
                setError(null);
                setPricing(null);
              }
              return fail;
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}

function PriceForm({ addon, venue, row, onSave }: { addon: Addon; venue: OwnerVenue; row: Assignment | null; onSave(next: Save): Promise<string | null> }) {
  const { t: tr, i18n } = useTranslation();
  const sameCurrency = addon.currency === venue.currency;
  const [price, setPrice] = useState(row?.priceOverride != null ? minorToInput(row.priceOverride, venue.currency) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setError(null);
    let priceOverride: number | null = null;
    if (price.trim() !== '') {
      try {
        priceOverride = parseMoney(price.trim(), venue.currency);
      } catch {
        setError(tr('owner.addons.err.price'));
        return;
      }
    }
    // A price for an extra this venue has no row for yet also offers it; an existing row keeps its on/off state.
    setBusy(true);
    const fail = await onSave({ enabled: row?.enabled ?? true, priceOverride });
    setBusy(false);
    if (fail) setError(fail);
  };

  return (
    <>
      {error !== null ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Field
        label={tr('mobile.owner.setup.extras.priceLabel', { currency: venue.currency })}
        hint={
          sameCurrency
            ? tr('mobile.owner.setup.extras.priceHint', { price: formatMoney(addon.price, addon.currency, i18n.language) })
            : tr('mobile.owner.setup.extras.needPrice')
        }
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        placeholder={sameCurrency ? minorToInput(addon.price, addon.currency) : undefined}
      />
      <Button label={tr('mobile.owner.setup.save')} loading={busy} onPress={() => void submit()} />
    </>
  );
}
