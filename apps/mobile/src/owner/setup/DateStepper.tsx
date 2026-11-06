import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { addDays } from '@booking/shared';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon, Sheet, Text } from '../../ui';
import { formatDay, formatMonth, monthOf, monthWeeks, shiftMonth, todayIso, weekdayNames } from './dates';

type Props = {
  label: string;
  /** YYYY-MM-DD, or '' when `emptyLabel` is given (e.g. "Now", "No end"). */
  value: string;
  onChange(value: string): void;
  emptyLabel?: string;
  error?: string;
  /** The venue's zone, so "today" (the first step from blank, the calendar's marker) is the venue's day. */
  timeZone?: string;
};

/**
 * A whole-day picker without a native date dependency: ‹ day › steppers for small moves, the date itself opens a month
 * calendar for far ones, plus "Clear" when the date is optional.
 */
export function DateStepper({ label, value, onChange, emptyLabel, error, timeZone }: Props) {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const shown = value === '' ? (emptyLabel ?? tr('mobile.owner.setup.dateNote')) : formatDay(value, i18n.language);
  const step = (n: number) => onChange(value === '' ? todayIso(new Date(), timeZone) : addDays(value, n));
  const [calendar, setCalendar] = useState(false);
  return (
    <View style={{ gap: t.space1 }}>
      <Text variant="label" tone="strong">
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space2,
          backgroundColor: t.controlFill,
          borderRadius: t.radiusMd,
          borderWidth: t.hairline,
          borderColor: error ? t.danger : 'transparent',
        }}
      >
        <StepIcon icon="arrowLeft" label={tr('mobile.owner.setup.closures.dayBefore')} onPress={() => step(-1)} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${shown}`}
          accessibilityHint={tr('mobile.owner.setup.calendar.open')}
          onPress={() => setCalendar(true)}
          style={{ flex: 1, minHeight: t.controlLg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: t.space1 }}
        >
          <Icon name="calendar" color={t.textMuted} size={t.iconSm} />
          <Text tone={value === '' ? 'muted' : 'strong'} weight="semibold" style={{ flexShrink: 1, textAlign: 'center' }}>
            {shown}
          </Text>
        </Pressable>
        <StepIcon icon="arrowRight" label={tr('mobile.owner.setup.closures.dayAfter')} onPress={() => step(1)} />
      </View>
      {emptyLabel !== undefined && value !== '' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${tr('mobile.owner.setup.coupons.clear')}: ${label}`}
          onPress={() => onChange('')}
          style={{ alignSelf: 'flex-start', minHeight: t.controlLg, justifyContent: 'center' }}
        >
          <Text variant="label" tone="primary">
            {tr('mobile.owner.setup.coupons.clear')}
          </Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}
      {calendar ? (
        <MonthSheet
          title={label}
          value={value}
          today={todayIso(new Date(), timeZone)}
          onClose={() => setCalendar(false)}
          onPick={(d) => {
            onChange(d);
            setCalendar(false);
          }}
        />
      ) : null}
    </View>
  );
}

/** One month at a time, Monday first; tapping a day picks it. Opens on the chosen day's month, else this month. */
function MonthSheet({ title, value, today, onClose, onPick }: { title: string; value: string; today: string; onClose(): void; onPick(date: string): void }) {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const lang = i18n.language;
  const [month, setMonth] = useState(() => monthOf(value || today));
  const cell = { flex: 1, minHeight: t.controlLg, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <Sheet visible onClose={onClose} title={title}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
        <StepIcon icon="arrowLeft" label={tr('mobile.owner.setup.calendar.prevMonth')} onPress={() => setMonth((m) => shiftMonth(m, -1))} />
        <Text weight="semibold" tone="strong" accessibilityRole="header" accessibilityLiveRegion="polite" style={{ flex: 1, textAlign: 'center' }}>
          {formatMonth(month, lang)}
        </Text>
        <StepIcon icon="arrowRight" label={tr('mobile.owner.setup.calendar.nextMonth')} onPress={() => setMonth((m) => shiftMonth(m, 1))} />
      </View>
      <View>
        <View style={{ flexDirection: 'row' }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {weekdayNames(lang).map((d) => (
            <View key={d} style={cell}>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {d}
              </Text>
            </View>
          ))}
        </View>
        {monthWeeks(month).map((week, w) => (
          <View key={w} style={{ flexDirection: 'row' }}>
            {week.map((d, i) => {
              if (d === null) return <View key={i} style={cell} />;
              const on = d === value;
              return (
                <Pressable
                  key={d}
                  accessibilityRole="button"
                  accessibilityLabel={formatDay(d, lang)}
                  accessibilityState={{ selected: on }}
                  onPress={() => onPick(d)}
                  style={({ pressed }) => ({ ...cell, borderRadius: t.radiusFull, backgroundColor: on ? t.primary : pressed ? t.controlFillHover : 'transparent' })}
                >
                  <Text weight={on || d === today ? 'semibold' : 'regular'} tone={d === today ? 'primary' : 'strong'} style={on ? { color: t.primaryFg } : undefined}>
                    {String(Number(d.slice(8)))}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </Sheet>
  );
}

function StepIcon({ icon, label, onPress }: { icon: 'arrowLeft' | 'arrowRight'; label: string; onPress(): void }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: t.controlLg,
        height: t.controlLg,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: t.radiusMd,
        backgroundColor: pressed ? t.controlFillHover : 'transparent',
      })}
    >
      <Icon name={icon} color={t.textStrong} size={t.iconSm} />
    </Pressable>
  );
}
