import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatMoney, type CouponJson, type CouponType } from '@booking/shared';
import { apiDelete, apiPatch, apiPost } from '../../../src/lib/api';
import { errorMessage } from '../../../src/lib/errors';
import { useResource } from '../../../src/lib/useResource';
import { ownerPath } from '../../../src/owner/labels';
import { useOwner } from '../../../src/owner/OwnerProvider';
import { CODE_MAX, couponBody, couponState, draftFromCoupon, EMPTY_COUPON_DRAFT, type CouponDraft } from '../../../src/owner/setup/couponForm';
import { DateStepper } from '../../../src/owner/setup/DateStepper';
import { ToggleRow } from '../../../src/owner/setup/ToggleRow';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { BackButton, Badge, Button, Chip, Empty, ErrorState, Field, Group, Loading, Row, Screen, Segmented, Sheet, Text } from '../../../src/ui';

/** "10% off", "10% · max ৳500" or "৳300 off". */
function discountSummary(c: CouponJson, tr: TFunction, lang: string): string {
  if (c.type === 'fixed') return tr('owner.coupons.fixedOff', { amount: formatMoney(c.value, c.currency, lang) });
  const percent = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 2 }).format(c.value / 100);
  return c.maxDiscount === null
    ? tr('mobile.owner.setup.coupons.percentOff', { percent })
    : tr('owner.coupons.percentMax', { percent, amount: formatMoney(c.maxDiscount, c.currency, lang) });
}

const day = (iso: string, lang: string) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(new Date(iso));

/** "10% off · 3 of 50 used · until 30 Nov". */
function couponLine(c: CouponJson, tr: TFunction, lang: string): string {
  const parts = [discountSummary(c, tr, lang)];
  parts.push(c.maxUses === null ? tr('mobile.owner.setup.coupons.used', { count: c.uses }) : tr('mobile.owner.setup.coupons.usedOf', { used: c.uses, max: c.maxUses }));
  if (c.validUntil) parts.push(tr('owner.coupons.until', { date: day(c.validUntil, lang) }));
  else if (c.validFrom && Date.parse(c.validFrom) > Date.now()) parts.push(tr('owner.coupons.from', { date: day(c.validFrom, lang) }));
  return parts.join(' · ');
}

/** Promo codes. Writes need access to every venue (as on the web); others see the list and a note. */
export default function OwnerCouponsScreen() {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const { ownerId, membership } = useOwner();
  const writable = membership.venueIds === 'all';
  const { state, reload } = useResource<{ coupons: CouponJson[] }>(ownerPath(ownerId, '/coupons'));
  const [editing, setEditing] = useState<CouponJson | 'new' | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const now = Date.now();

  const toggle = async (c: CouponJson) => {
    if (toggling) return;
    setToggling(c.id);
    setActionError(null);
    try {
      await apiPatch(ownerPath(ownerId, `/coupons/${encodeURIComponent(c.id)}`), { active: !c.active });
      reload();
    } catch (err) {
      setActionError(err);
    }
    setToggling(null);
  };

  return (
    <Screen scroll>
      <BackButton />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
        <Text variant="heading" tone="strong" accessibilityRole="header" style={{ flex: 1 }}>
          {tr('owner.nav.coupons')}
        </Text>
        {writable ? <Button variant="secondary" label={tr('owner.coupons.add')} onPress={() => setEditing('new')} /> : null}
      </View>
      {!writable ? <Text tone="info">{tr('owner.coupons.ownerWideOnly')}</Text> : null}
      {actionError !== null ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(actionError, tr)}
        </Text>
      ) : null}
      {state.status === 'error' ? <ErrorState error={state.error} onRetry={reload} /> : null}
      {state.status === 'loading' || state.status === 'idle' ? <Loading /> : null}
      {state.status === 'ready' ? (
        state.data.coupons.length === 0 ? (
          <Empty>{tr('owner.coupons.empty')}</Empty>
        ) : (
          <Group>
            {state.data.coupons.map((c) => {
              const s = couponState(c, now);
              // "Active" and "Off" are already said by the switch; the badge is for the states a switch can't show.
              const badge = s.key === 'active' || (s.key === 'off' && writable) ? null : <Badge tone={s.tone} label={tr(`owner.coupons.state.${s.key}`)} />;
              return writable ? (
                <ToggleRow
                  key={c.id}
                  title={c.code}
                  detail={couponLine(c, tr, i18n.language)}
                  right={badge}
                  onPress={() => setEditing(c)}
                  value={c.active}
                  onChange={() => void toggle(c)}
                  disabled={toggling === c.id}
                  switchLabel={tr('mobile.owner.setup.coupons.toggleLabel', { code: c.code })}
                />
              ) : (
                <Row key={c.id} title={c.code} detail={couponLine(c, tr, i18n.language)} right={badge ?? <Badge tone={s.tone} label={tr(`owner.coupons.state.${s.key}`)} />} />
              );
            })}
          </Group>
        )
      ) : null}
      {writable ? (
        <Sheet
          visible={editing !== null}
          onClose={() => setEditing(null)}
          title={tr(editing !== null && editing !== 'new' ? 'owner.coupons.formTitleEdit' : 'owner.coupons.formTitleNew')}
        >
          {editing !== null ? (
            <CouponForm
              key={editing === 'new' ? 'new' : editing.id}
              coupon={editing === 'new' ? null : editing}
              onClose={() => setEditing(null)}
              onSaved={reload}
            />
          ) : null}
        </Sheet>
      ) : null}
    </Screen>
  );
}

function CouponForm({ coupon, onClose, onSaved }: { coupon: CouponJson | null; onClose(): void; onSaved(): void }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { ownerId, owner, venues } = useOwner();
  const currency = coupon?.currency ?? owner.defaultCurrency;
  // Fields the app doesn't show (cap, min spend, per-player limit) stay as loaded, so the PATCH diff leaves them alone.
  const [d, setD] = useState<CouponDraft>(coupon ? draftFromCoupon(coupon) : EMPTY_COUPON_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (patch: Partial<CouponDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const err = (field: string) => (errors[field] ? tr(errors[field]) : undefined);

  const submit = async () => {
    if (busy) return;
    setError(null);
    const res = couponBody(d, coupon, currency);
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    setErrors({});
    if (coupon && Object.keys(res.body).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      if (coupon) await apiPatch(ownerPath(ownerId, `/coupons/${encodeURIComponent(coupon.id)}`), res.body);
      else await apiPost(ownerPath(ownerId, '/coupons'), res.body);
      onSaved();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!coupon) return;
    Alert.alert(tr('owner.coupons.deleteTitle', { code: coupon.code }), tr('owner.coupons.deleteBody'), [
      { text: tr('owner.venues.cancel'), style: 'cancel' },
      {
        text: tr('owner.coupons.deleteConfirm'),
        style: 'destructive',
        onPress: async () => {
          setError(null);
          try {
            await apiDelete(ownerPath(ownerId, `/coupons/${encodeURIComponent(coupon.id)}`));
            onSaved();
            onClose();
          } catch (e) {
            setError(e);
          }
        },
      },
    ]);
  };

  const toggleVenue = (id: string) =>
    setD((prev) => {
      const on = prev.venueIds.includes(id);
      const venueIds = on ? prev.venueIds.filter((v) => v !== id) : [...prev.venueIds, id];
      return { ...prev, allVenues: false, venueIds };
    });

  return (
    <>
      {error !== null ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(error, tr)}
        </Text>
      ) : null}
      <Field
        label={tr('owner.coupons.field.code')}
        hint={tr('owner.coupons.field.codeHint')}
        value={d.code}
        onChangeText={(code) => set({ code })}
        maxLength={CODE_MAX}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        error={err('code')}
      />
      <Segmented<CouponType>
        label={tr('mobile.owner.setup.coupons.discount')}
        options={[
          { value: 'percent', label: tr('mobile.owner.setup.coupons.typePercent') },
          { value: 'fixed', label: tr('mobile.owner.setup.coupons.typeFixed', { currency }) },
        ]}
        value={d.type}
        onChange={(type) => set({ type, value: '' })}
      />
      <View style={{ flexDirection: 'row', gap: t.space3 }}>
        <View style={{ flex: 1 }}>
          <Field
            label={d.type === 'percent' ? tr('owner.coupons.field.percent') : tr('owner.coupons.field.amount', { currency })}
            value={d.value}
            onChangeText={(value) => set({ value })}
            keyboardType="decimal-pad"
            error={err('value')}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label={tr('owner.coupons.field.maxUses')}
            hint={tr('owner.coupons.field.blankUnlimited')}
            value={d.maxUses}
            onChangeText={(maxUses) => set({ maxUses })}
            keyboardType="number-pad"
            error={err('maxUses')}
          />
        </View>
      </View>
      <DateStepper label={tr('mobile.owner.setup.coupons.starts')} value={d.validFrom} onChange={(validFrom) => set({ validFrom })} emptyLabel={tr('mobile.owner.setup.coupons.now')} />
      <DateStepper
        label={tr('mobile.owner.setup.coupons.ends')}
        value={d.validUntil}
        onChange={(validUntil) => set({ validUntil })}
        emptyLabel={tr('mobile.owner.setup.coupons.noEnd')}
        error={err('validUntil')}
      />
      {venues.length > 1 ? (
        <View style={{ gap: t.space2 }}>
          <Text variant="label" tone="strong">
            {tr('owner.coupons.field.venues')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
            <Chip
              selected={d.allVenues}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: d.allVenues }}
              accessibilityLabel={tr('owner.coupons.allVenues')}
              onPress={() => set({ allVenues: true, venueIds: [] })}
            >
              <Text variant="label" tone={d.allVenues ? 'primary' : 'default'}>
                {tr('owner.coupons.allVenues')}
              </Text>
            </Chip>
            {venues.map((v) => {
              const on = !d.allVenues && d.venueIds.includes(v.id);
              return (
                <Chip key={v.id} selected={on} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={v.name} onPress={() => toggleVenue(v.id)}>
                  <Text variant="label" tone={on ? 'primary' : 'default'}>
                    {v.name}
                  </Text>
                </Chip>
              );
            })}
          </View>
          {err('venues') ? (
            <Text variant="caption" tone="danger">
              {err('venues')}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Group>
        <Row title={tr('owner.coupons.field.active')} detail={tr('owner.coupons.field.activeHint')} toggle={{ value: d.active, onChange: (active) => set({ active }) }} />
      </Group>
      <Text variant="caption" tone="muted">
        {tr('mobile.owner.setup.coupons.webOnly')}
      </Text>
      <Button label={tr('owner.coupons.save')} loading={busy} onPress={() => void submit()} />
      {coupon ? <Button variant="ghost" tone="danger" label={tr('owner.coupons.delete')} onPress={confirmDelete} /> : null}
    </>
  );
}
