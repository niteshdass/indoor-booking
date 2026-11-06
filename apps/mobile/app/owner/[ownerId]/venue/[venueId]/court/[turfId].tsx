import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { parseMoney, type Sport } from '@booking/shared';
import { apiPatch, apiPost, apiPut } from '../../../../../../src/lib/api';
import { errorMessage } from '../../../../../../src/lib/errors';
import { useResource } from '../../../../../../src/lib/useResource';
import { ownerHref, ownerPath } from '../../../../../../src/owner/labels';
import { useOwner } from '../../../../../../src/owner/OwnerProvider';
import type { OwnerTurf, TurfPricing } from '../../../../../../src/owner/types';
import { minorToInput } from '../../../../../../src/owner/venues/format';
import { useSports } from '../../../../../../src/owner/venues/useSports';
import { useTheme } from '../../../../../../src/theme/ThemeProvider';
import { BackButton, Badge, Button, Chip, Field, Group, Icon, Loading, Row, Screen, Text, WebNote } from '../../../../../../src/ui';

const NAME_MAX = 60;
const SLOT_MIN = 30;
const SLOT_MAX = 240;
const SLOT_STEP = 15;
const DEFAULT_SLOT = 60;

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** `court/new` adds a court to the venue; `court/:turfId` edits name, sports, base price, indoor and active. */
export default function OwnerCourtScreen() {
  const { t: tr } = useTranslation();
  const { venueId = '', turfId = '' } = useLocalSearchParams<{ venueId: string; turfId: string }>();
  const { ownerId, can } = useOwner();
  const isNew = turfId === 'new';
  const res = useResource<{ turf: OwnerTurf }>(
    isNew ? null : ownerPath(ownerId, `/venues/${encodeURIComponent(venueId)}/turfs/${encodeURIComponent(turfId)}`),
  );

  let body;
  if (isNew) {
    body = can('turf.manage') ? (
      <CourtForm venueId={venueId} turf={null} onSaved={() => undefined} />
    ) : (
      <Text tone="warning">{tr('owner.noAccess')}</Text>
    );
  } else if (res.state.status === 'ready') {
    const turf = res.state.data.turf;
    body = <CourtForm key={JSON.stringify(turf)} venueId={venueId} turf={turf} onSaved={(next) => res.set({ turf: next })} />;
  } else if (res.state.status === 'error') {
    body = (
      <Text tone="warning" accessibilityRole="alert">
        {tr('owner.turf.notFound')}
      </Text>
    );
  } else {
    body = <Loading />;
  }
  return (
    <Screen scroll>
      <BackButton />
      {body}
    </Screen>
  );
}

function CourtForm({ venueId, turf, onSaved }: { venueId: string; turf: OwnerTurf | null; onSaved(turf: OwnerTurf): void }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { ownerId, owner, venues, can } = useOwner();
  const currency = venues.find((v) => v.id === venueId)?.currency ?? owner.defaultCurrency;
  const editDetails = can('turf.manage');
  const editPrice = can('pricing.edit');
  const offered = useSports(turf?.sports ?? []);
  const priceStart = turf?.pricing ? minorToInput(turf.pricing.base, currency) : '';

  const [name, setName] = useState(turf?.name ?? '');
  const [sports, setSports] = useState<Sport[]>(turf?.sports ?? []);
  const [slot, setSlot] = useState(turf?.slotLengthMin ?? DEFAULT_SLOT);
  const [price, setPrice] = useState(priceStart);
  const [indoor, setIndoor] = useState(turf?.indoor ?? false);
  const [active, setActive] = useState(turf?.active ?? true);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const nameError = name.trim().length < 1 || name.trim().length > NAME_MAX ? tr('owner.venues.err.turfName') : undefined;
  const sportsError = sports.length === 0 ? tr('owner.venues.err.sports') : undefined;
  let base: number | null = null;
  let priceError: string | undefined;
  if (price.trim() !== '') {
    try {
      base = parseMoney(price.trim(), currency);
    } catch {
      priceError = tr('mobile.owner.venues.priceErr');
    }
  }
  const priceChanged = editPrice && price.trim() !== priceStart && base !== null;

  const turfsPath = ownerPath(ownerId, `/venues/${encodeURIComponent(venueId)}/turfs`);
  const savePrice = async (id: string, rules: TurfPricing['rules']) => {
    const out = await apiPut<{ pricing: TurfPricing }>(`${turfsPath}/${encodeURIComponent(id)}/pricing`, { base: base!, rules });
    return out.pricing;
  };

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    setDone(false);
    if (busy || (editDetails && (nameError || sportsError)) || (editPrice && priceError)) return;
    setBusy(true);
    try {
      if (!turf) {
        const { turf: created } = await apiPost<{ turf: OwnerTurf }>(turfsPath, { name: name.trim(), sports, indoor, slotLengthMin: slot });
        if (priceChanged) await savePrice(created.id, []);
        router.replace(ownerHref(ownerId, `/venue/${encodeURIComponent(venueId)}/court/${encodeURIComponent(created.id)}`));
        return;
      }
      let next = turf;
      if (editDetails) {
        const patch: Record<string, unknown> = {};
        if (name.trim() !== turf.name) patch.name = name.trim();
        if (!sameSet(sports, turf.sports)) patch.sports = sports;
        if (indoor !== turf.indoor) patch.indoor = indoor;
        if (active !== turf.active) patch.active = active;
        if (Object.keys(patch).length > 0) next = (await apiPatch<{ turf: OwnerTurf }>(`${turfsPath}/${encodeURIComponent(turf.id)}`, patch)).turf;
      }
      // The app only edits the base price; the rules set on the web are sent back unchanged.
      if (priceChanged) next = { ...next, pricing: await savePrice(turf.id, turf.pricing?.rules ?? []) };
      setBusy(false);
      setDone(true);
      if (next !== turf) onSaved(next);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const ruleCount = turf?.pricing?.rules.length ?? 0;
  const ownHours = Object.keys(turf?.settings.hours ?? {}).length > 0;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.space2 }}>
        <Text variant="heading" tone="strong" accessibilityRole="header" style={{ flex: 1 }}>
          {turf ? turf.name : tr('mobile.owner.venues.newCourt')}
        </Text>
        {turf ? <Badge tone={turf.active ? 'success' : 'neutral'} label={tr(turf.active ? 'owner.venues.turfActive' : 'owner.venues.turfInactive')} /> : null}
      </View>
      {error !== null ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(error, tr)}
        </Text>
      ) : null}
      {done ? <Text tone="success">{tr('owner.turf.saved')}</Text> : null}

      <Field
        label={tr('owner.turf.name')}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setDone(false);
        }}
        maxLength={NAME_MAX}
        editable={editDetails}
        error={submitted ? nameError : undefined}
      />

      <View style={{ gap: t.space2 }}>
        <Text variant="label" tone="strong">
          {tr('owner.venues.sports')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
          {offered.map((s) => {
            const on = sports.includes(s);
            return (
              <Chip
                key={s}
                selected={on}
                disabled={!editDetails}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: !editDetails }}
                onPress={() => {
                  setSports(on ? sports.filter((x) => x !== s) : [...sports, s]);
                  setDone(false);
                }}
              >
                {on ? <Icon name="check" color={t.primary} size={t.iconSm} /> : null}
                <Text variant="label" tone={on ? 'primary' : 'default'}>
                  {tr(`sports.${s}`)}
                </Text>
              </Chip>
            );
          })}
        </View>
        {submitted && sportsError ? (
          <Text variant="caption" tone="danger">
            {sportsError}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: t.space1 }}>
        <Text variant="label" tone="strong">
          {tr('owner.venues.slotLength')}
        </Text>
        {turf ? (
          <>
            <Text tone="strong">{tr('owner.venues.minutes', { count: turf.slotLengthMin })}</Text>
            <Text variant="caption" tone="muted">
              {tr('owner.turf.slotLengthFixed')}
            </Text>
          </>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space3 }}>
            <StepButton icon="minus" label={tr('mobile.owner.venues.shorter')} disabled={slot <= SLOT_MIN} onPress={() => setSlot(slot - SLOT_STEP)} />
            <Text tone="strong" weight="semibold" accessibilityLiveRegion="polite">
              {tr('owner.venues.minutes', { count: slot })}
            </Text>
            <StepButton icon="plus" label={tr('mobile.owner.venues.longer')} disabled={slot >= SLOT_MAX} onPress={() => setSlot(slot + SLOT_STEP)} />
          </View>
        )}
      </View>

      {editPrice || turf?.pricing ? (
        <Field
          label={tr('mobile.owner.venues.basePrice', { currency })}
          value={price}
          onChangeText={(v) => {
            setPrice(v);
            setDone(false);
          }}
          keyboardType="decimal-pad"
          editable={editPrice}
          error={submitted ? priceError : undefined}
          hint={turf && !turf.pricing ? tr('owner.pricing.unpriced') : undefined}
        />
      ) : null}

      <Group>
        <Row title={tr('owner.venues.indoorLabel')} toggle={{ value: indoor, onChange: setIndoor, disabled: !editDetails }} />
        {turf ? <Row title={tr('owner.turf.active')} toggle={{ value: active, onChange: setActive, disabled: !editDetails }} /> : null}
        {turf ? (
          <Row icon="clock" title={tr('mobile.owner.venues.hours')} detail={tr(ownHours ? 'mobile.owner.venues.ownHours' : 'mobile.owner.venues.sameAsVenue')} />
        ) : null}
      </Group>

      <WebNote>{ruleCount > 0 ? tr('mobile.owner.venues.rulesNote', { count: ruleCount }) : tr('mobile.owner.venues.noRulesNote')}</WebNote>

      {editDetails || editPrice ? (
        <Button label={turf ? tr('owner.turf.save') : tr('mobile.owner.venues.create')} loading={busy} onPress={() => void submit()} />
      ) : null}
    </>
  );
}

function StepButton({ icon, label, disabled, onPress }: { icon: 'plus' | 'minus'; label: string; disabled: boolean; onPress(): void }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: t.controlLg,
        height: t.controlLg,
        borderRadius: t.radiusFull,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.controlFillHover : t.controlFill,
        opacity: disabled ? t.opacityMuted : 1,
      })}
    >
      <Icon name={icon} color={t.textStrong} />
    </Pressable>
  );
}
