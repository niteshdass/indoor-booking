import { describe, it, expect } from 'vitest';
import { matchRefundRule, cancellationRefund, bookingPaymentStatus } from '../src/refunds';
import type { RefundRule } from '../src/settings';

const rules: RefundRule[] = [
  { minHoursBefore: 96, percent: 100 },
  { minHoursBefore: 72, percent: 40 },
  { minHoursBefore: 48, percent: 20 },
];
const startAt = new Date('2026-11-10T18:00:00Z');
const hoursBefore = (h: number) => new Date(startAt.getTime() - h * 3_600_000);

describe('matchRefundRule', () => {
  it('gives the 96 h rule 100 h before the start', () => {
    expect(matchRefundRule(rules, startAt, hoursBefore(100))).toEqual({ minHoursBefore: 96, percent: 100 });
  });

  it('gives the 72 h rule 80 h before the start', () => {
    expect(matchRefundRule(rules, startAt, hoursBefore(80))).toEqual({ minHoursBefore: 72, percent: 40 });
  });

  it('is inclusive at exactly the threshold', () => {
    expect(matchRefundRule(rules, startAt, hoursBefore(72))).toEqual({ minHoursBefore: 72, percent: 40 });
  });

  it('gives null below the lowest threshold', () => {
    expect(matchRefundRule(rules, startAt, hoursBefore(47))).toBeNull();
  });

  it('gives null after the start', () => {
    expect(matchRefundRule(rules, startAt, new Date(startAt.getTime() + 3_600_000))).toBeNull();
  });

  it('does not depend on the order of the rules', () => {
    const shuffled: RefundRule[] = [
      { minHoursBefore: 48, percent: 20 },
      { minHoursBefore: 96, percent: 100 },
      { minHoursBefore: 72, percent: 40 },
    ];
    for (const h of [100, 80, 72, 47]) {
      expect(matchRefundRule(shuffled, startAt, hoursBefore(h))).toEqual(
        matchRefundRule(rules, startAt, hoursBefore(h)),
      );
    }
  });

  it('gives null for no rules', () => {
    expect(matchRefundRule([], startAt, hoursBefore(100))).toBeNull();
  });
});

describe('cancellationRefund', () => {
  it('has no floating-point shortfall: 375 at 18.4% is 69, not 68', () => {
    const r = cancellationRefund({ rules: [{ minHoursBefore: 0, percent: 18.4 }], startAt, now: hoursBefore(1), refundable: 375, byStaff: false });
    expect(r.amount).toBe(69);
  });

  it('applies the matched rule to the refundable amount', () => {
    expect(
      cancellationRefund({ rules, startAt, now: hoursBefore(80), refundable: 5000, byStaff: false }),
    ).toEqual({ percent: 40, amount: 2000, rule: { minHoursBefore: 72, percent: 40 } });
  });

  it('floors the amount', () => {
    const r = cancellationRefund({ rules, startAt, now: hoursBefore(50), refundable: 999, byStaff: false });
    expect(r.percent).toBe(20);
    expect(r.amount).toBe(199);
  });

  it('refunds everything when staff cancel, whatever the rules say', () => {
    expect(
      cancellationRefund({ rules: [], startAt, now: hoursBefore(1), refundable: 5000, byStaff: true }),
    ).toEqual({ percent: 100, amount: 5000, rule: null });
  });

  it('refunds nothing when the refundable amount is zero', () => {
    expect(
      cancellationRefund({ rules, startAt, now: hoursBefore(100), refundable: 0, byStaff: false }).amount,
    ).toBe(0);
  });

  it('refunds nothing when no rule matches', () => {
    expect(
      cancellationRefund({ rules, startAt, now: hoursBefore(1), refundable: 5000, byStaff: false }),
    ).toEqual({ percent: 0, amount: 0, rule: null });
  });
});

describe('bookingPaymentStatus', () => {
  it('is paid when fully paid and nothing refunded', () => {
    expect(bookingPaymentStatus(5000, 0, 5000)).toBe('paid');
  });

  it('is partially paid when some is paid', () => {
    expect(bookingPaymentStatus(2000, 0, 5000)).toBe('partially_paid');
  });

  it('is partially refunded when a part is refunded', () => {
    expect(bookingPaymentStatus(5000, 2000, 5000)).toBe('partially_refunded');
  });

  it('is refunded when the whole paid amount is refunded', () => {
    expect(bookingPaymentStatus(5000, 5000, 5000)).toBe('refunded');
  });

  it('is unpaid when nothing is paid', () => {
    expect(bookingPaymentStatus(0, 0, 5000)).toBe('unpaid');
  });
});
