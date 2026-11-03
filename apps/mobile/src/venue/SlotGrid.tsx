import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney, isSelectable, localParts, type SlotDay, type SlotJson } from '@booking/shared';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';

export interface SlotGridProps {
  day: SlotDay;
  /** Venue IANA timezone: slot times are shown on its clock, not the phone's. */
  timeZone: string;
  selected: string[];
  onToggle(startAt: string): void;
}

type Period = 'morning' | 'afternoon' | 'evening';

/** Cells per row: fixed, so a short last row does not stretch. */
const COLUMNS = 3;

const periodOf = (hm: string): Period => {
  const h = Number(hm.slice(0, 2));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
};

function Cell({ slot, time, currency, selected, width, onPress }: { slot: SlotJson; time: string; currency: string; selected: boolean; width: number; onPress(): void }) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const priced = slot.price !== null;
  const open = slot.status === 'available' && priced;
  // Why a cell cannot be tapped, in words: status is never shown by color alone.
  const stateKey = slot.status === 'available' ? (priced ? null : 'unavailable') : slot.status;
  const stateLabel = stateKey ? tr(`slots.${stateKey}`) : null;
  const price = stateLabel ?? formatMoney(slot.price ?? 0, currency, i18n.language);
  const fg = selected ? t.brandFg : open ? t.textStrong : t.textSubtle;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={stateLabel ? `${time}, ${stateLabel}` : selected ? `${time}, ${price}, ${tr('slots.selected')}` : `${time}, ${price}`}
      accessibilityState={{ disabled: !open, selected }}
      disabled={!open}
      onPress={onPress}
      style={{
        // Until the row is measured, cells grow from the slot minimum.
        ...(width > 0 ? { width } : { flexGrow: 1, minWidth: t.slotMin }),
        minHeight: t.controlLg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: t.space1,
        paddingVertical: t.space1,
        borderRadius: t.radiusMd,
        borderWidth: t.focusWidth,
        borderColor: selected ? t.brand : open ? t.borderStrong : t.borderSubtle,
        backgroundColor: selected ? t.brand : open ? t.bgSurface : t.bgSubtle,
      }}
    >
      <Text variant="label" weight="bold" style={{ color: fg }}>
        {selected ? `✓ ${time}` : time}
      </Text>
      <Text variant="caption" numberOfLines={1} style={{ color: fg, textDecorationLine: open ? 'none' : 'line-through' }}>
        {price}
      </Text>
    </Pressable>
  );
}

/**
 * The day's slots by time of day, or the reason there are none. Past times are left out (a period with only past times
 * goes too). Selected slots carry a check mark as well as the brand fill.
 */
export function SlotGrid({ day, timeZone, selected, onToggle }: SlotGridProps) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const [width, setWidth] = useState(0);
  if (day.status === 'closed') return <Text tone="muted" accessibilityRole="alert">{tr('slots.closed')}</Text>;
  if (day.status === 'outside_window') return <Text tone="muted" accessibilityRole="alert">{tr('slots.outsideWindow')}</Text>;
  if (day.slots.length === 0) return <Text tone="muted" accessibilityRole="alert">{tr('slots.none')}</Text>;
  const upcoming = day.slots.filter((s) => s.status !== 'past');
  if (upcoming.length === 0) return <Text tone="muted" accessibilityRole="alert">{tr('slots.allPast')}</Text>;

  const groups = new Map<Period, { slot: SlotJson; time: string }[]>();
  for (const slot of upcoming) {
    const time = localParts(new Date(slot.startAt), timeZone).hm;
    const p = periodOf(time);
    groups.set(p, [...(groups.get(p) ?? []), { slot, time }]);
  }
  const cell = width > 0 ? (width - t.space2 * (COLUMNS - 1)) / COLUMNS : 0;

  return (
    <View style={{ gap: t.space3 }} accessibilityLabel={tr('slots.grid')} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {[...groups].map(([period, items]) => {
        const free = items.filter((i) => isSelectable(i.slot)).length;
        return (
          <View key={period} style={{ gap: t.space2 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: t.space2 }}>
              <Text variant="label" weight="semibold" tone="strong" accessibilityRole="header">
                {tr(`slots.${period}`)}
              </Text>
              <Text variant="caption" tone={free > 0 ? 'success' : 'muted'}>
                {free > 0 ? tr('slots.freeCount', { count: free }) : tr('slots.noneFree')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
              {items.map(({ slot, time }) => (
                <Cell
                  key={slot.startAt}
                  slot={slot}
                  time={time}
                  currency={day.currency}
                  selected={selected.includes(slot.startAt)}
                  width={cell}
                  onPress={() => onToggle(slot.startAt)}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
