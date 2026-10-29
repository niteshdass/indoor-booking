import type { RefundRule } from './settings';
import type { PaymentStatus } from './statuses';
import { paymentStatusFor } from './booking';

const MS_PER_HOUR = 3_600_000;

/**
 * The tier a cancellation falls into: the first rule (highest minHoursBefore first) that the
 * cancellation still meets. Null when it is after the start or earlier than every threshold.
 */
export function matchRefundRule(rules: readonly RefundRule[], startAt: Date, now: Date): RefundRule | null {
  const hoursBefore = (startAt.getTime() - now.getTime()) / MS_PER_HOUR;
  if (hoursBefore < 0) return null;
  const sorted = [...rules].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  return sorted.find((rule) => hoursBefore >= rule.minHoursBefore) ?? null;
}

/** Refund for a cancellation. Staff cancellations always refund in full; amounts floor to minor units. */
export function cancellationRefund(input: {
  rules: readonly RefundRule[];
  startAt: Date;
  now: Date;
  refundable: number;
  byStaff: boolean;
}): { percent: number; amount: number; rule: RefundRule | null } {
  const rule = matchRefundRule(input.rules, input.startAt, input.now);
  const percent = input.byStaff ? 100 : (rule?.percent ?? 0);
  // Integer basis points: 375 * 18.4 / 100 is 68.99999… in floating point, and would floor a unit short.
  const basisPoints = Math.round(percent * 100);
  return { percent, amount: Math.floor((input.refundable * basisPoints) / 10_000), rule };
}

/** Payment status once refunds are counted: refunded amounts take precedence over how much was paid. */
export function bookingPaymentStatus(amountPaid: number, amountRefunded: number, total: number): PaymentStatus {
  if (amountRefunded > 0) {
    return amountRefunded >= amountPaid ? 'refunded' : 'partially_refunded';
  }
  return paymentStatusFor(amountPaid, total);
}
