import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isIsoDate } from '@booking/shared';
import { apiDelete, apiGet, apiPost } from '../../../src/lib/api';
import { errorMessage } from '../../../src/lib/errors';
import { useResource } from '../../../src/lib/useResource';
import { ownerPath } from '../../../src/owner/labels';
import { useOwner } from '../../../src/owner/OwnerProvider';
import { ChipPicker } from '../../../src/owner/setup/ChipPicker';
import { DateStepper } from '../../../src/owner/setup/DateStepper';
import { formatRange, todayIso } from '../../../src/owner/setup/dates';
import type { Closure, OwnerTurf } from '../../../src/owner/types';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { BackButton, Button, Empty, ErrorState, Field, Group, Icon, Loading, Row, Screen, Segmented, Sheet, Text } from '../../../src/ui';

const MAX_CLOSURE_DAYS = 366;
const REASON_MAX = 200;
const DAY_MS = 86_400_000;

type Scope = 'owner' | 'venue' | 'turf';

/** Turfs of every venue, keyed by venue id; a venue whose turfs fail to load is simply missing (as on the web). */
function useTurfsByVenue(): Record<string, OwnerTurf[]> {
  const { ownerId, venues } = useOwner();
  const key = venues.map((v) => v.id).join(',');
  const [byVenue, setByVenue] = useState<Record<string, OwnerTurf[]>>({});
  useEffect(() => {
    let live = true;
    const ids = key === '' ? [] : key.split(',');
    void Promise.allSettled(ids.map((id) => apiGet<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${encodeURIComponent(id)}/turfs`)))).then(
      (results) => {
        if (!live) return;
        const next: Record<string, OwnerTurf[]> = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') next[ids[i]!] = r.value.turfs;
        });
        setByVenue(next);
      },
    );
    return () => {
      live = false;
    };
  }, [ownerId, key]);
  return byVenue;
}

/** Closed days across the business, a venue or one court. Whole days only, like the API. */
export default function OwnerClosuresScreen() {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const { ownerId, venues, membership, can } = useOwner();
  const turfsByVenue = useTurfsByVenue();
  const { state, reload } = useResource<{ closures: Closure[] }>(ownerPath(ownerId, '/closures'));
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const ownerWide = can('settings.edit') && membership.venueIds === 'all';
  const canDelete = (c: Closure) => (c.venueId === null ? ownerWide : can('slot.override'));
  const canAdd = ownerWide || can('slot.override');

  const turfName = useMemo(() => {
    const names = new Map<string, string>();
    Object.values(turfsByVenue).forEach((list) => list.forEach((x) => names.set(x.id, x.name)));
    return names;
  }, [turfsByVenue]);
  const scopeLabel = (c: Closure) => {
    if (c.venueId === null) return tr('owner.closures.scopeOwner');
    const venueName = venues.find((v) => v.id === c.venueId)?.name ?? tr('owner.closures.venue');
    if (c.turfId === null) return `${venueName} · ${tr('mobile.owner.setup.closures.allCourts')}`;
    return `${venueName} · ${turfName.get(c.turfId) ?? tr('owner.closures.turf')}`;
  };

  const confirmDelete = (c: Closure) =>
    Alert.alert(tr('owner.closures.deleteTitle'), tr('owner.closures.deleteBody'), [
      { text: tr('owner.venues.cancel'), style: 'cancel' },
      {
        text: tr('owner.closures.deleteConfirm'),
        style: 'destructive',
        onPress: async () => {
          setActionError(null);
          try {
            await apiDelete(ownerPath(ownerId, `/closures/${encodeURIComponent(c.id)}`));
            reload();
          } catch (err) {
            setActionError(err);
          }
        },
      },
    ]);

  return (
    <Screen scroll>
      <BackButton />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
        <Text variant="heading" tone="strong" accessibilityRole="header" style={{ flex: 1 }}>
          {tr('owner.nav.closures')}
        </Text>
        {canAdd ? <Button variant="secondary" label={tr('owner.closures.add')} onPress={() => setAdding(true)} /> : null}
      </View>
      <Text tone="muted">{tr('owner.closures.intro')}</Text>
      {actionError !== null ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(actionError, tr)}
        </Text>
      ) : null}
      {state.status === 'error' ? <ErrorState error={state.error} onRetry={reload} /> : null}
      {state.status === 'loading' || state.status === 'idle' ? <Loading /> : null}
      {state.status === 'ready' ? (
        state.data.closures.length === 0 ? (
          <Empty>{tr('owner.closures.empty')}</Empty>
        ) : (
          <Group>
            {state.data.closures.map((c) => {
              const dates = formatRange(c.from, c.to, i18n.language);
              return (
                <Row
                  key={c.id}
                  left={<DateTile date={c.from} lang={i18n.language} />}
                  title={scopeLabel(c)}
                  detail={c.reason ? `${dates} · ${c.reason}` : dates}
                  right={
                    canDelete(c) ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={tr('mobile.owner.setup.closures.deleteLabel', { dates })}
                        onPress={() => confirmDelete(c)}
                        style={({ pressed }) => ({
                          width: t.controlLg,
                          height: t.controlLg,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: t.radiusMd,
                          backgroundColor: pressed ? t.bgHover : 'transparent',
                        })}
                      >
                        <Icon name="trash" color={t.danger} size={t.iconSm} />
                      </Pressable>
                    ) : undefined
                  }
                />
              );
            })}
          </Group>
        )
      ) : null}
      {canAdd ? (
        <Sheet visible={adding} onClose={() => setAdding(false)} title={tr('owner.closures.formTitle')}>
          {adding ? <ClosureForm turfsByVenue={turfsByVenue} onClose={() => setAdding(false)} onCreated={reload} /> : null}
        </Sheet>
      ) : null}
    </Screen>
  );
}

function DateTile({ date, lang }: { date: string; lang: string }) {
  const { t } = useTheme();
  const at = new Date(`${date}T00:00:00Z`);
  const month = new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'UTC' }).format(at);
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ minWidth: t.controlLg, paddingVertical: t.space1, paddingHorizontal: t.space1, borderRadius: t.radiusMd, backgroundColor: t.dangerSoft, alignItems: 'center' }}
    >
      <Text variant="caption" weight="semibold" tone="danger">
        {month}
      </Text>
      <Text weight="bold" tone="danger">
        {at.getUTCDate()}
      </Text>
    </View>
  );
}

function ClosureForm({ turfsByVenue, onClose, onCreated }: { turfsByVenue: Record<string, OwnerTurf[]>; onClose(): void; onCreated(): void }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { ownerId, venues, membership, can } = useOwner();
  // Owner-wide closures need settings.edit across every venue; venue and court ones need slot.override.
  const scopes: Scope[] = [
    ...(can('settings.edit') && membership.venueIds === 'all' ? (['owner'] as const) : []),
    ...(can('slot.override') ? (['venue', 'turf'] as const) : []),
  ];
  const [scope, setScope] = useState<Scope>(scopes.includes('venue') ? 'venue' : (scopes[0] ?? 'venue'));
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '');
  const [turfId, setTurfId] = useState('');
  // Closures are whole days at the venue, so they start from the venue's today, not this phone's.
  const zone = (scope === 'owner' ? venues[0] : venues.find((v) => v.id === venueId))?.timezone;
  const [from, setFrom] = useState(() => todayIso(new Date(), venues[0]?.timezone));
  const [to, setTo] = useState(() => todayIso(new Date(), venues[0]?.timezone));
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const turfs = turfsByVenue[venueId] ?? [];
  const turf = turfs.find((x) => x.id === turfId) ?? turfs[0];

  const errors: Record<string, string> = {};
  if (scope !== 'owner' && !venues.some((v) => v.id === venueId)) errors.venue = 'owner.closures.err.venue';
  if (scope === 'turf' && !turf) errors.turf = 'owner.closures.err.turf';
  if (!isIsoDate(from)) errors.from = 'owner.closures.err.from';
  if (!isIsoDate(to)) errors.to = 'owner.closures.err.to';
  else if (isIsoDate(from)) {
    if (to < from) errors.to = 'owner.closures.err.order';
    else if ((Date.parse(to) - Date.parse(from)) / DAY_MS + 1 > MAX_CLOSURE_DAYS) errors.to = 'owner.closures.err.long';
  }
  if (reason.trim().length > REASON_MAX) errors.reason = 'owner.closures.err.reason';
  const err = (field: string) => (submitted && errors[field] ? tr(errors[field]) : undefined);

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (busy || Object.keys(errors).length > 0) return;
    setBusy(true);
    try {
      await apiPost(ownerPath(ownerId, '/closures'), {
        ...(scope === 'owner' ? {} : { venueId }),
        ...(scope === 'turf' && turf ? { turfId: turf.id } : {}),
        from,
        to,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const scopeName = (s: Scope) =>
    tr(s === 'owner' ? 'owner.closures.scopeOwner' : s === 'venue' ? 'mobile.owner.setup.closures.wholeVenue' : 'mobile.owner.setup.closures.oneCourt');

  return (
    <>
      {error !== null ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(error, tr)}
        </Text>
      ) : null}
      {scopes.length > 1 ? (
        <Segmented label={tr('owner.closures.scopeLabel')} options={scopes.map((s) => ({ value: s, label: scopeName(s) }))} value={scope} onChange={(v) => setScope(v as Scope)} />
      ) : null}
      {scope !== 'owner' ? (
        <ChipPicker
          label={tr('owner.closures.venue')}
          options={venues.map((v) => ({ id: v.id, name: v.name }))}
          value={venueId}
          onChange={(id) => {
            setVenueId(id);
            setTurfId('');
          }}
          error={err('venue')}
        />
      ) : null}
      {scope === 'turf' ? (
        turfs.length > 0 ? (
          <ChipPicker label={tr('owner.closures.turf')} options={turfs.map((x) => ({ id: x.id, name: x.name }))} value={turf?.id ?? ''} onChange={setTurfId} error={err('turf')} />
        ) : (
          <Text tone="muted">{tr('owner.closures.noTurfs')}</Text>
        )
      ) : null}
      <View style={{ gap: t.space3 }}>
        <DateStepper
          label={tr('owner.closures.from')}
          value={from}
          timeZone={zone}
          onChange={(v) => {
            setFrom(v);
            if (to < v) setTo(v);
          }}
          error={err('from')}
        />
        <DateStepper label={tr('owner.closures.to')} value={to} onChange={setTo} error={err('to')} timeZone={zone} />
      </View>
      <Field label={tr('owner.closures.reason')} value={reason} onChangeText={setReason} maxLength={REASON_MAX} error={err('reason')} />
      <Text variant="caption" tone="muted">
        {tr('mobile.owner.setup.closures.note')}
      </Text>
      <Button label={tr('owner.closures.save')} loading={busy} onPress={() => void submit()} />
    </>
  );
}
