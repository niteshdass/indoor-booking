import { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { apiGet } from '../../lib/api';
import { fontFamily } from '../../theme/fonts';
import { useTheme } from '../../theme/ThemeProvider';
import { Badge, Field, Icon, Sheet, Text } from '../../ui';
import { ownerPath } from '../labels';
import { useOwner } from '../OwnerProvider';

/** Mirrors apps/web/src/owner/CustomerFields.tsx. `playerId` is set only when the customer was picked from a past booking by a registered player. */
export type Customer = { name: string; phone: string; playerId?: string };

type Suggestion = { name: string; phone: string; playerId: string | null };

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

/** Same list as the web PhoneInput. */
export const DIAL_CODES = [
  { code: 'BD', dial: '+880' },
  { code: 'RU', dial: '+7' },
  { code: 'IN', dial: '+91' },
  { code: 'GB', dial: '+44' },
  { code: 'US', dial: '+1' },
  { code: 'AE', dial: '+971' },
] as const;
const DEFAULT_DIAL = '+880';

function dialOf(value: string): string {
  const hit = [...DIAL_CODES].sort((a, b) => b.dial.length - a.dial.length).find((d) => value.startsWith(d.dial));
  return hit?.dial ?? DEFAULT_DIAL;
}

/** Name 1-80 characters (trimmed) and a phone number. */
export const customerErrors = (c: Customer) => ({
  name: c.name.trim().length < 1 || c.name.trim().length > 80,
  phone: c.phone === '',
});

/** The customer part of a walk-in request body. */
export const customerBody = (c: Customer) => ({
  name: c.name.trim(),
  phone: c.phone,
  ...(c.playerId ? { playerId: c.playerId } : {}),
});

/** Name with past-customer suggestions, then the phone as country code + number (E.164 out, as on the web). */
export function CustomerFields({ value, onChange, tried }: { value: Customer; onChange(next: Customer): void; tried: boolean }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { ownerId } = useOwner();
  const bad = customerErrors(value);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // Remounts the phone field on a pick, so its country code follows the picked number.
  const [picks, setPicks] = useState(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setSuggestions([]);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      apiGet<{ customers: Suggestion[] }>(ownerPath(ownerId, `/customers?q=${encodeURIComponent(q)}`))
        .then((res) => live && setSuggestions(res.customers))
        // Suggestions are a convenience; on failure the fields still work by hand.
        .catch(() => live && setSuggestions([]));
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [ownerId, query]);

  const pick = (s: Suggestion) => {
    onChange({ name: s.name, phone: s.phone, ...(s.playerId ? { playerId: s.playerId } : {}) });
    setPicks((n) => n + 1);
    setQuery('');
    setSuggestions([]);
  };

  const shown = query.trim().length >= MIN_QUERY && suggestions.length > 0;

  return (
    <View style={{ gap: t.space3 }}>
      <View style={{ gap: t.space1 }}>
        <Field
          label={tr('owner.walkIn.name')}
          value={value.name}
          maxLength={80}
          autoComplete="off"
          autoCorrect={false}
          textContentType="name"
          hint={tr('owner.walkIn.customerSearchHint')}
          error={tried && bad.name ? tr('owner.walkIn.nameRequired') : undefined}
          onChangeText={(name) => {
            // A typed name is a new person until they pick someone again.
            onChange({ name, phone: value.phone });
            setQuery(name);
          }}
        />
        {shown ? (
          <View accessibilityLabel={tr('owner.walkIn.customerSuggestions')} style={{ backgroundColor: t.bgSurfaceRaised, borderRadius: t.radiusMd, borderWidth: t.hairline, borderColor: t.borderSubtle, ...t.shadowMd }}>
            {suggestions.map((s, i) => (
              <Pressable
                key={s.playerId ?? s.phone}
                accessibilityRole="button"
                accessibilityLabel={[s.name, s.phone, s.playerId ? tr('owner.walkIn.registeredPlayer') : null].filter(Boolean).join(', ')}
                onPress={() => pick(s)}
                style={({ pressed }) => ({
                  minHeight: t.controlLg,
                  justifyContent: 'center',
                  paddingHorizontal: t.space3,
                  paddingVertical: t.space2,
                  gap: t.space1,
                  backgroundColor: pressed ? t.bgHover : 'transparent',
                  borderTopWidth: i > 0 ? t.hairline : 0,
                  borderTopColor: t.borderSubtle,
                })}
              >
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.space2 }}>
                  <Text weight="semibold" tone="strong">
                    {s.name}
                  </Text>
                  {s.playerId ? <Badge label={tr('owner.walkIn.registeredPlayer')} tone="info" /> : null}
                </View>
                {s.phone ? (
                  <Text variant="label" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
                    {s.phone}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <PhoneField
        key={picks}
        label={tr('owner.walkIn.phoneLabel')}
        value={value.phone}
        onChange={(phone) => onChange({ name: value.name, phone })}
        error={tried && bad.phone ? tr('owner.walkIn.phoneRequired') : undefined}
      />
    </View>
  );
}

/** Country code (opens a sheet) and the national number; emits `dial + digits`, or '' while the number is empty. */
function PhoneField({ label, value, onChange, error }: { label: string; value: string; onChange(v: string): void; error?: string }) {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const [dial, setDial] = useState(() => dialOf(value));
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const national = value.startsWith(dial) ? value.slice(dial.length) : '';
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([i18n.language], { type: 'region' });
    } catch {
      return null;
    }
  }, [i18n.language]);
  const emit = (d: string, digits: string) => onChange(digits ? d + digits : '');
  return (
    <View style={{ gap: t.space1 }}>
      <Text variant="label" tone="strong">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', gap: t.space2 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${tr('auth.phone.country')}, ${dial}`}
          onPress={() => setOpen(true)}
          style={({ pressed }) => ({
            minHeight: t.controlLg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space1,
            paddingHorizontal: t.space3,
            borderRadius: t.radiusMd,
            backgroundColor: pressed ? t.controlFillHover : t.controlFill,
          })}
        >
          <Text weight="medium" tone="strong">
            {dial}
          </Text>
          <Icon name="chevronDown" color={t.textMuted} size={t.iconSm} />
        </Pressable>
        <TextInput
          accessibilityLabel={`${label}, ${tr('auth.phone.number')}`}
          value={national}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChangeText={(v) => emit(dial, v.replace(/\D/g, ''))}
          style={{
            flex: 1,
            minHeight: t.controlLg,
            paddingHorizontal: t.space3,
            borderRadius: t.radiusMd,
            borderWidth: t.focusWidth,
            borderColor: error ? t.danger : focused ? t.primary : 'transparent',
            backgroundColor: t.controlFill,
            color: t.textStrong,
            fontFamily: fontFamily('sans', 'regular', i18n.language),
            fontSize: t.textMd,
          }}
        />
      </View>
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={tr('auth.phone.country')}>
        {DIAL_CODES.map((d) => {
          const on = d.dial === dial;
          return (
            <Pressable
              key={d.dial}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => {
                setDial(d.dial);
                emit(d.dial, national);
                setOpen(false);
              }}
              style={({ pressed }) => ({
                minHeight: t.controlLg,
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.space3,
                paddingHorizontal: t.space3,
                borderRadius: t.radiusMd,
                backgroundColor: on ? t.primarySoft : pressed ? t.bgHover : 'transparent',
              })}
            >
              <Text weight={on ? 'semibold' : 'regular'} tone="strong" style={{ flex: 1 }}>
                {`${names?.of(d.code) ?? d.code} (${d.dial})`}
              </Text>
              {on ? <Icon name="check" color={t.primary} size={t.iconSm} /> : null}
            </Pressable>
          );
        })}
      </Sheet>
    </View>
  );
}
