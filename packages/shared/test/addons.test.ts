import { describe, it, expect } from 'vitest';
import {
  addonLineTotal,
  AddonQuoteError,
  quoteAddons,
  type OfferedAddon,
  type QuoteSlot,
} from '../src/addons';
import { InvalidMoneyError } from '../src/money';
import { rangeCovers } from '../src/pricing';
import { hmToMin } from '../src/time';

function slot(localStart: string, minutes: number): QuoteSlot {
  const startAt = new Date(`2026-12-16T${localStart}:00Z`);
  return { startAt, endAt: new Date(startAt.getTime() + minutes * 60_000), localStart };
}

const racket: OfferedAddon = {
  addonId: 'racket', name: 'Racket', pricingType: 'per_unit', unitPrice: 150,
  maxQuantity: 4, stock: null, autoApply: null,
};
const towel: OfferedAddon = {
  addonId: 'towel', name: 'Towel', pricingType: 'per_booking', unitPrice: 50,
  maxQuantity: 1, stock: null, autoApply: null,
};
const coach: OfferedAddon = {
  addonId: 'coach', name: 'Coach', pricingType: 'per_hour', unitPrice: 1200,
  maxQuantity: 1, stock: null, autoApply: null,
};
const floodlight: OfferedAddon = {
  addonId: 'floodlight', name: 'Floodlight', pricingType: 'per_hour', unitPrice: 1200,
  maxQuantity: 1, stock: null,
  autoApply: { range: { start: '18:00', end: '06:00' }, outdoorOnly: true },
};
const slots2 = [slot('10:00', 60), slot('11:00', 60)];

function codeOf(fn: () => unknown): AddonQuoteError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AddonQuoteError);
    return err as AddonQuoteError;
  }
  throw new Error('did not throw');
}

describe('addonLineTotal', () => {
  it('prices each type', () => {
    expect(addonLineTotal('per_booking', 500, 1, 60)).toBe(500);
    expect(addonLineTotal('per_unit', 150, 4, 60)).toBe(600);
    expect(addonLineTotal('per_hour', 1200, 1, 90)).toBe(1800);
    expect(addonLineTotal('per_hour', 1005, 1, 90)).toBe(1508);
    expect(addonLineTotal('per_hour', 1, 1, 30)).toBe(1);
  });

  it('rejects unsafe totals', () => {
    expect(() => addonLineTotal('per_unit', Number.MAX_SAFE_INTEGER, 2, 60)).toThrow(InvalidMoneyError);
  });
});

describe('rangeCovers', () => {
  it('matches times of day modulo 1440', () => {
    const night = { start: '18:00', end: '06:00' };
    expect(rangeCovers(undefined, 0)).toBe(true);
    expect(rangeCovers(night, hmToMin('01:00'))).toBe(true);
    expect(rangeCovers(night, hmToMin('17:00'))).toBe(false);
  });
});

describe('quoteAddons', () => {
  it('quotes selected add-ons in order', () => {
    const q = quoteAddons({
      offered: [racket, towel, coach], slots: slots2, indoor: true,
      selection: [{ addonId: 'coach' }, { addonId: 'racket', quantity: 3 }, { addonId: 'towel' }],
    });
    expect(q.lines.map((l) => [l.addonId, l.total, l.minutes, l.auto])).toEqual([
      ['coach', 2400, 120, false],
      ['racket', 450, null, false],
      ['towel', 50, null, false],
    ]);
    expect(q.total).toBe(2900);
  });

  it('auto-applies across midnight', () => {
    const slots = [slot('17:00', 60), slot('18:00', 60), slot('01:00', 60)];
    const outdoor = quoteAddons({ offered: [floodlight, racket], slots, indoor: false, selection: [{ addonId: 'racket' }] });
    expect(outdoor.lines[0]).toMatchObject({ addonId: 'floodlight', auto: true, minutes: 120, total: 2400 });
    expect(outdoor.lines[1]!.addonId).toBe('racket');
    const indoor = quoteAddons({ offered: [floodlight], slots, indoor: true, selection: [] });
    expect(indoor.lines).toEqual([]);

    const flat: OfferedAddon = { ...towel, addonId: 'fee', autoApply: { outdoorOnly: false } };
    expect(quoteAddons({ offered: [flat], slots, indoor: true, selection: [] }).total).toBe(50);
    expect(quoteAddons({ offered: [flat], slots: [slot('10:00', 60)], indoor: true, selection: [] }).total).toBe(50);

    const noMatch = quoteAddons({ offered: [floodlight], slots: slots2, indoor: false, selection: [] });
    expect(noMatch.lines).toEqual([]);
  });

  it('charges auto per_booking once when a slot matches', () => {
    const night: OfferedAddon = { ...towel, addonId: 'night', autoApply: { range: { start: '18:00', end: '06:00' }, outdoorOnly: false } };
    const q = quoteAddons({ offered: [night], slots: [slot('17:00', 60), slot('18:00', 60), slot('19:00', 60)], indoor: true, selection: [] });
    expect(q.lines).toHaveLength(1);
    expect(q.total).toBe(50);
  });

  it('rejects bad selections', () => {
    const offered = [racket, towel, floodlight];
    const run = (selection: { addonId: string; quantity?: number }[]) =>
      codeOf(() => quoteAddons({ offered, slots: slots2, indoor: false, selection }));
    expect(run([{ addonId: 'nope' }])).toMatchObject({ code: 'addon_unavailable', addonId: 'nope' });
    expect(run([{ addonId: 'floodlight' }])).toMatchObject({ code: 'addon_auto', addonId: 'floodlight' });
    expect(run([{ addonId: 'racket' }, { addonId: 'racket' }])).toMatchObject({ code: 'duplicate_addon', addonId: 'racket' });
    for (const quantity of [0, 5, 1.5]) {
      expect(run([{ addonId: 'racket', quantity }])).toMatchObject({ code: 'invalid_quantity', addonId: 'racket' });
    }
    expect(run([{ addonId: 'towel', quantity: 2 }])).toMatchObject({ code: 'invalid_quantity', addonId: 'towel' });
  });

  it('checks stock against units in use', () => {
    const limited = { ...racket, stock: 3 };
    const run = (quantity: number, inUse?: Record<string, number>) =>
      quoteAddons({ offered: [limited], slots: slots2, indoor: true, selection: [{ addonId: 'racket', quantity }], inUse });
    expect(run(1, { racket: 2 }).total).toBe(150);
    expect(codeOf(() => run(2, { racket: 2 }))).toMatchObject({ code: 'addon_out_of_stock', addonId: 'racket' });
    expect(run(3).total).toBe(450);
    expect(codeOf(() => quoteAddons({ offered: [{ ...towel, stock: 0 }], slots: slots2, indoor: true, selection: [{ addonId: 'towel' }] })).code).toBe('addon_out_of_stock');
    expect(quoteAddons({ offered: [towel], slots: slots2, indoor: true, selection: [{ addonId: 'towel' }], inUse: { towel: 999 } }).total).toBe(50);
  });

  it('throws on empty slots', () => {
    expect(() => quoteAddons({ offered: [towel], slots: [], indoor: true, selection: [] })).toThrow();
  });
});

describe('addonLineTotal input guards', () => {
  it('guards inputs', () => {
    expect(() => addonLineTotal('per_hour', 10.5, 1, 60)).toThrow(InvalidMoneyError);
    const msg = 'Add-on quantity and minutes must be whole numbers';
    expect(() => addonLineTotal('per_hour', 1200, 1, 90.5)).toThrow(new RangeError(msg));
    expect(() => addonLineTotal('per_unit', 150, 1.5, 60)).toThrow(new RangeError(msg));
    expect(() => addonLineTotal('per_unit', 150, 0, 60)).toThrow(RangeError);
    expect(addonLineTotal('per_hour', 1200, 1, 90)).toBe(1800);
    expect(addonLineTotal('per_unit', 150, 2, 60)).toBe(300);
    expect(addonLineTotal('per_booking', 50, 1, 60)).toBe(50);
  });
});
