import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BOOKING_STATUSES } from '@booking/shared';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, Chip, Field, Sheet, Text } from '../../ui';
import type { OwnerTurf, OwnerVenue } from '../types';
import { activeCount, BOOKING_SORTS, isDate, rangeError, type BookingFilters } from './filters';

export interface FilterSheetProps {
  visible: boolean;
  onClose(): void;
  filters: BookingFilters;
  onChange(patch: Partial<BookingFilters>): void;
  venues: OwnerVenue[];
  /** The courts of the chosen (or only) venue; null while there is no single venue or they are loading. */
  turfs: OwnerTurf[] | null;
  /** Matching bookings, once the list has loaded. */
  total: number | null;
}

/** Date range, venue, court, status and sort, applied as they change (as on the web panel). */
export function FilterSheet({ visible, onClose, filters, onChange, venues, turfs, total }: FilterSheetProps) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const range = rangeError(filters);
  const cleared = { venueId: null, turfId: null, status: null, from: null, to: null };
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('owner.bookings.filters')}>
      <View style={{ flexDirection: 'row', gap: t.space3 }}>
        <View style={{ flex: 1 }}>
          <DateField label={tr('owner.bookings.from')} value={filters.from} onChange={(from) => onChange({ from })} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label={tr('owner.bookings.to')} value={filters.to} onChange={(to) => onChange({ to })} />
        </View>
      </View>
      {range ? (
        <Text variant="caption" tone="danger" accessibilityRole="alert">
          {tr(range)}
        </Text>
      ) : null}
      {venues.length > 1 ? (
        <Choice
          label={tr('owner.venue')}
          value={filters.venueId}
          // Courts belong to a venue, so changing venue clears the court.
          onChange={(venueId) => onChange({ venueId, turfId: null })}
          options={[{ value: null, label: tr('owner.bookings.allVenues') }, ...venues.map((v) => ({ value: v.id, label: v.name }))]}
        />
      ) : null}
      {turfs && turfs.length > 0 ? (
        <Choice
          label={tr('owner.bookings.turf')}
          value={filters.turfId}
          onChange={(turfId) => onChange({ turfId })}
          options={[{ value: null, label: tr('owner.bookings.allTurfs') }, ...turfs.map((x) => ({ value: x.id, label: x.name }))]}
        />
      ) : null}
      <Choice
        label={tr('owner.bookings.status')}
        value={filters.status}
        onChange={(status) => onChange({ status })}
        options={[{ value: null, label: tr('owner.bookings.allStatuses') }, ...BOOKING_STATUSES.map((s) => ({ value: s, label: tr(`status.${s}`) }))]}
      />
      <Choice
        label={tr('owner.bookings.sortLabel')}
        value={filters.sort}
        onChange={(sort) => sort && onChange({ sort })}
        options={BOOKING_SORTS.map((s) => ({ value: s, label: tr(`owner.bookings.sort.${s}`) }))}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2, marginTop: t.space2 }}>
        <Button label={tr('owner.bookings.clearFilters')} variant="ghost" disabled={activeCount(filters) === 0} onPress={() => onChange(cleared)} />
        <View style={{ flex: 1 }}>
          <Button
            label={total === null || range ? tr('owner.bookings.done') : tr('mobile.owner.bookings.show', { count: total })}
            onPress={onClose}
          />
        </View>
      </View>
    </Sheet>
  );
}

/** A `YYYY-MM-DD` field: the filter takes the date once it is a real one, and drops it when the field is emptied. */
function DateField({ label, value, onChange }: { label: string; value: string | null; onChange(v: string | null): void }) {
  const { t: tr } = useTranslation();
  const [text, setText] = useState(value ?? '');
  useEffect(() => {
    // Cleared from outside (Clear filters).
    if (value === null) setText((x) => (x && isDate(x) ? '' : x));
  }, [value]);
  const bad = text.trim() !== '' && !isDate(text.trim());
  return (
    <Field
      label={label}
      value={text}
      placeholder={tr('mobile.owner.bookings.datePlaceholder')}
      keyboardType="numbers-and-punctuation"
      autoCorrect={false}
      maxLength={10}
      error={bad ? tr('mobile.owner.bookings.dateInvalid') : undefined}
      onChangeText={(v) => {
        setText(v);
        const s = v.trim();
        if (s === '') onChange(null);
        else if (isDate(s)) onChange(s);
      }}
    />
  );
}

function Choice<V extends string | null>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: V;
  onChange(v: V): void;
  options: { value: V; label: string }[];
}) {
  const { t } = useTheme();
  return (
    <View style={{ gap: t.space2 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Chip
              key={o.value ?? ''}
              selected={on}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ checked: on }}
              onPress={() => onChange(o.value)}
            >
              <Text variant="label" weight={on ? 'semibold' : 'medium'} tone={on ? 'primary' : 'default'}>
                {o.label}
              </Text>
            </Chip>
          );
        })}
      </View>
    </View>
  );
}
