import { useState } from 'react';
import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DEFAULT_OWNER_SETTINGS, PROVIDER_NAMES, WALLET_PROVIDERS, formatBdMobile, formatMoney, type OwnerSettings } from '@booking/shared';
import type { TFunction } from 'i18next';
import { apiPatch } from '../../../src/lib/api';
import { useResource } from '../../../src/lib/useResource';
import { useOwner } from '../../../src/owner/OwnerProvider';
import { ownerPath } from '../../../src/owner/labels';
import { SettingsSheet, type SheetKind } from '../../../src/owner/settings/SettingsSheets';
import type { SettingsLevel, StoredSettings } from '../../../src/owner/settings/settingsPatch';
import type { OwnerVenue } from '../../../src/owner/types';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { BackButton, Badge, Chip, ErrorState, Group, GroupLabel, Loading, Row, Screen, Text, WebNote } from '../../../src/ui';

/** Team-wide settings (`settings.edit`) and, with `venue.manage`, per-venue overrides; gateways, hours and SMS stay on the web. */
export default function SettingsScreen() {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { ownerId, owner, venues, can, reloadVenues } = useOwner();
  const allowed = can('settings.edit');
  const path = ownerPath(ownerId, '/settings');
  const res = useResource<{ settings: OwnerSettings }>(allowed ? path : null);
  const [venueId, setVenueId] = useState<string | null>(null);
  // The venue as last saved here, until the context's list catches up.
  const [saved, setSaved] = useState<Record<string, OwnerVenue>>({});
  const venueChips = can('venue.manage') ? venues : [];
  const venue = venueId ? (saved[venueId] ?? venueChips.find((v) => v.id === venueId) ?? null) : null;

  const head = (
    <>
      <BackButton />
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {tr('owner.nav.settings')}
      </Text>
    </>
  );
  if (!allowed) {
    return (
      <Screen>
        {head}
        <Text tone="muted">{tr('owner.noAccess')}</Text>
      </Screen>
    );
  }
  if (res.state.status === 'error') {
    return (
      <Screen>
        {head}
        <ErrorState error={res.state.error} onRetry={res.reload} />
      </Screen>
    );
  }
  if (res.state.status !== 'ready') {
    return (
      <Screen>
        {head}
        <Loading />
      </Screen>
    );
  }
  const ownerSettings = res.state.data.settings;

  const saveOwner = async (patch: Record<string, unknown>) => {
    res.set(await apiPatch<{ settings: OwnerSettings }>(path, patch));
  };
  const saveVenue = (v: OwnerVenue) => async (patch: Record<string, unknown>) => {
    const out = await apiPatch<{ venue: OwnerVenue }>(ownerPath(ownerId, `/venues/${encodeURIComponent(v.id)}`), { settings: patch });
    setSaved((s) => ({ ...s, [v.id]: out.venue }));
    void reloadVenues();
  };

  return (
    <Screen scroll>
      {head}
      {venueChips.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space2 }}>
          {[{ id: null as string | null, name: tr('mobile.owner.settings.teamDefault') }, ...venueChips].map((v) => (
            <Chip
              key={v.id ?? 'team'}
              selected={venueId === v.id}
              onPress={() => setVenueId(v.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: venueId === v.id }}
            >
              <Text variant="label">{v.name}</Text>
            </Chip>
          ))}
        </ScrollView>
      )}
      {venue ? (
        <LevelView
          key={venue.id}
          level="venue"
          stored={venue.settings}
          shown={venue.effectiveSettings}
          inherited={ownerSettings}
          currency={venue.currency}
          onSave={saveVenue(venue)}
        />
      ) : (
        <LevelView key="owner" level="owner" stored={ownerSettings} shown={ownerSettings} inherited={null} currency={owner.defaultCurrency} onSave={saveOwner} />
      )}
      <WebNote>{tr('mobile.owner.settings.webNote')}</WebNote>
    </Screen>
  );
}

type LevelProps = {
  level: SettingsLevel;
  stored: StoredSettings;
  /** What applies at this level (owner settings, or the venue's effective settings). */
  shown: OwnerSettings;
  inherited: OwnerSettings | null;
  currency: string;
  onSave(patch: Record<string, unknown>): Promise<void>;
};

function LevelView({ level, stored, shown, inherited, currency, onSave }: LevelProps) {
  const { t: tr, i18n } = useTranslation();
  const [open, setOpen] = useState<SheetKind | null>(null);
  const venue = level === 'venue';
  const tag = (keys: (keyof OwnerSettings)[], detail: string) =>
    venue && keys.every((k) => stored[k] === undefined) ? `${tr('mobile.owner.settings.teamDefault')} · ${detail}` : detail;
  const wallets = (shown.paymentMethods ?? DEFAULT_OWNER_SETTINGS.paymentMethods).manualWallets;

  return (
    <>
      <GroupLabel>{tr('mobile.owner.settings.booking')}</GroupLabel>
      <Group>
        <Row
          title={tr('mobile.owner.settings.rules')}
          detail={tag(['bookingWindowDays', 'guestBooking', 'reschedule'], tr('mobile.owner.settings.windowDetail', { count: shown.bookingWindowDays }))}
          onPress={() => setOpen('rules')}
        />
        <Row title={tr('owner.settings.tab.refunds')} detail={tag(['refundRules'], refundDetail(shown, tr))} onPress={() => setOpen('refunds')} />
      </Group>

      <GroupLabel>{tr('mobile.owner.settings.gettingPaid')}</GroupLabel>
      <Group>
        {WALLET_PROVIDERS.map((p) => {
          const w = wallets.find((x) => x.provider === p);
          const detail = w ? `${formatBdMobile(w.number)} · ${tr(`owner.settings.methods.account.${w.accountType}`)}` : tr('mobile.owner.settings.notSet');
          return (
            <Row
              key={p}
              title={PROVIDER_NAMES[p]}
              detail={tag(['paymentMethods'], detail)}
              right={<Badge tone={w ? 'success' : 'neutral'} label={tr(w ? 'mobile.owner.settings.on' : 'mobile.owner.settings.off')} />}
              onPress={() => setOpen(p)}
            />
          );
        })}
        <Row
          title={tr('mobile.owner.settings.deposit')}
          detail={tag(['paymentPolicy'], depositDetail(shown, currency, i18n.language, tr))}
          onPress={() => setOpen('deposit')}
        />
      </Group>

      {open && (
        <SettingsSheet
          kind={open}
          level={level}
          stored={stored}
          inherited={inherited}
          currency={currency}
          onSave={onSave}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function refundDetail(s: OwnerSettings, tr: TFunction): string {
  if (s.refundRules.length === 0) return tr('mobile.owner.settings.noRefunds');
  return [...s.refundRules]
    .sort((a, b) => b.minHoursBefore - a.minHoursBefore)
    .map((r) => tr('mobile.owner.settings.refundRule', { hours: r.minHoursBefore, percent: r.percent }))
    .join(' · ');
}

function depositDetail(s: OwnerSettings, currency: string, lang: string, tr: TFunction): string {
  const p = s.paymentPolicy;
  if (p.type === 'full') return tr('mobile.owner.settings.depositFull');
  if (p.type === 'partial_percent') return tr('mobile.owner.settings.depositPercent', { percent: p.percent });
  if (p.type === 'partial_fixed') return tr('mobile.owner.settings.depositFixed', { amount: formatMoney(p.amount, currency, lang) });
  return tr('mobile.owner.settings.depositNone');
}
