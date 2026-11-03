import { describe, expect, it } from 'vitest';
import { defaultAnswers, firstUnfinished, plainDigits, priceMinor, stepErrors, toBusinessSetup, toVenueSetup, type Answers } from '../../src/onboarding/answers';

const numbered = (n: number) => `Turf ${n}`;

function filled(over: Partial<Answers> = {}): Answers {
  return { ...defaultAnswers(), name: 'Dhanmondi Turf', city: 'Dhaka', address: 'Road 27', lat: 23.75, lng: 90.37, price: '1500', ...over };
}

describe('setup answers', () => {
  it('reads Bangla digits and thousands commas in prices', () => {
    expect(plainDigits('১,৫০০')).toBe('1500');
    expect(priceMinor('১৫০০', 'BDT')).toBe(150_000);
    expect(priceMinor('1 500', 'BDT')).toBe(150_000);
    expect(priceMinor('0', 'BDT')).toBeNull();
    expect(priceMinor('abc', 'BDT')).toBeNull();
  });

  it('lists what is missing on each step', () => {
    const a = defaultAnswers();
    expect(stepErrors('name', a, numbered)).toEqual(['name']);
    expect(stepErrors('place', a, numbered)).toEqual(['city', 'address', 'pin']);
    expect(stepErrors('turfs', { ...a, sports: [] }, numbered)).toEqual(['sports']);
    expect(stepErrors('turfs', { ...a, turfCount: 2, turfNames: ['', 'turf 1'] }, numbered)).toEqual(['turfNames']);
    expect(stepErrors('hours', { ...a, closedDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, numbered)).toEqual(['allClosed']);
    expect(stepErrors('hours', { ...a, hours: 'custom', open: '', close: '22:00' }, numbered)).toEqual(['times']);
    expect(stepErrors('price', { ...a, price: '1500', evening: true }, numbered)).toEqual(['eveningPrice']);
    expect(stepErrors('payment', { ...a, wallets: { bkash: '12345' } }, numbered)).toEqual(['wallet']);
    expect(stepErrors('payment', { ...a, wallets: { bkash: '০১৭১২৩৪৫৬৭৮', nagad: '' } }, numbered)).toEqual([]);
    expect(firstUnfinished(a, numbered)).toBe('name');
    expect(firstUnfinished(filled(), numbered)).toBeNull();
  });

  it('builds the venue with its turfs, hours, evening price and wallets', () => {
    const a = filled({
      turfCount: 2,
      turfNames: ['', 'Roof'],
      sports: ['football', 'cricket'],
      indoor: true,
      closedDays: ['fri'],
      evening: true,
      eveningFrom: '18:00',
      eveningPrice: '2000',
      wallets: { bkash: '+8801712345678', rocket: ' ' },
      publish: false,
    });
    const s = toVenueSetup(a, 'Asia/Dhaka', numbered);
    expect(s.venue).toEqual({ name: 'Dhanmondi Turf', address: 'Road 27', city: 'Dhaka', timezone: 'Asia/Dhaka', location: { lat: 23.75, lng: 90.37 } });
    const range = { start: '18:00', end: '00:00' };
    const pricing = { base: 150_000, rules: [{ kind: 'weekday', range, price: 200_000 }, { kind: 'weekend', range, price: 200_000 }] };
    expect(s.turfs).toEqual([
      { name: 'Turf 1', sports: ['football', 'cricket'], indoor: true, slotLengthMin: 90, pricing },
      { name: 'Roof', sports: ['football', 'cricket'], indoor: true, slotLengthMin: 90, pricing },
    ]);
    expect(s.settings.hours.fri).toBe('closed');
    expect(s.settings.hours.mon).toEqual({ open: '06:00', close: '00:00' });
    expect(s.settings.weekendDays).toEqual(['fri', 'sat']);
    expect(s.settings.paymentMethods).toEqual({ manualWallets: [{ provider: 'bkash', number: '01712345678', accountType: 'personal' }], gateways: [] });
    expect(s.publish).toBe(false);
  });

  it('sends no wallets outside Bangladesh and names the business after the venue', () => {
    const s = toBusinessSetup(filled({ country: 'RU', currency: 'RUB', wallets: { bkash: '01712345678' }, hours: 'allDay' }), 'Europe/Moscow', 'ru', numbered);
    expect(s.business).toEqual({ name: 'Dhanmondi Turf', country: 'RU', currency: 'RUB', locale: 'ru' });
    expect(s.settings.paymentMethods.manualWallets).toEqual([]);
    expect(s.settings.weekendDays).toEqual(['sat', 'sun']);
    expect(s.settings.hours.sun).toEqual({ open: '00:00', close: '00:00' });
  });
});
