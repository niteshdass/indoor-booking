import { z } from 'zod';
import { WALLET_PROVIDERS, WEEKDAYS, assertMinor, type EffectiveSettings } from '@booking/shared';
import { normalizePhone } from '../auth/normalize';
import { AppError } from '../errors';

/** HH:MM, 24-hour. */
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
/** close <= open means the session ends the next day. */
export const dayHoursSchema = z.union([z.literal('closed'), z.object({ open: timeSchema, close: timeSchema }).strict()]);
export const hoursPatchSchema = z
  .object(Object.fromEntries(WEEKDAYS.map((d) => [d, dayHoursSchema.nullable().optional()])) as Record<
    (typeof WEEKDAYS)[number],
    z.ZodOptional<z.ZodNullable<typeof dayHoursSchema>>
  >)
  .strict();

const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9;
const percent = z.number().min(0).max(100).refine(twoDecimals, 'At most 2 decimal places');

export function paymentPolicySchema({ allowFixed }: { allowFixed: boolean }) {
  const none = z.object({ type: z.literal('none') }).strict();
  const full = z.object({ type: z.literal('full') }).strict();
  const partialPercent = z
    .object({
      type: z.literal('partial_percent'),
      percent: percent.refine((p) => p > 0 && p < 100, 'Must be between 0 and 100'),
    })
    .strict();
  const partialFixed = z
    .object({
      type: z.literal('partial_fixed'),
      amount: z
        .number()
        .int()
        .positive()
        .refine((n) => {
          try {
            assertMinor(n);
            return true;
          } catch {
            return false;
          }
        }, 'Invalid amount'),
    })
    .strict();
  // A fixed amount is in the venue's currency, so only a venue can set one.
  return allowFixed
    ? z.discriminatedUnion('type', [none, full, partialPercent, partialFixed])
    : z.discriminatedUnion('type', [none, full, partialPercent]);
}

export const refundRulesSchema = z
  .array(z.object({ minHoursBefore: z.number().int().min(0).max(8760), percent }).strict())
  .max(10)
  .refine((rules) => new Set(rules.map((r) => r.minHoursBefore)).size === rules.length, 'Thresholds must be unique')
  .transform((rules) => [...rules].sort((x, y) => y.minHoursBefore - x.minHoursBefore));

export const weekendDaysSchema = z
  .array(z.enum(WEEKDAYS))
  .max(7)
  .refine((days) => new Set(days).size === days.length, 'Days must be unique');

const guestBookingSchema = z.object({ allowed: z.boolean(), requireOtp: z.boolean() }).strict();

const walletSchema = z
  .object({
    provider: z.enum(WALLET_PROVIDERS),
    number: z.string().transform((raw, ctx) => {
      try {
        // A local number (01712345678) is read as Bangladeshi.
        const n = normalizePhone(/^01/.test(raw.trim()) ? `+880${raw.trim().slice(1)}` : raw);
        if (/^\+8801[3-9]\d{8}$/.test(n)) return n;
      } catch {
        // falls through to the issue below
      }
      ctx.addIssue({ code: 'custom', message: 'Use a Bangladesh mobile number, e.g. 01712345678' });
      return z.NEVER;
    }),
    accountType: z.enum(['personal', 'merchant', 'agent']),
    note: z.string().trim().max(140).optional(),
  })
  .strict();

export const paymentMethodsSchema = z
  .object({
    manualWallets: z
      .array(walletSchema)
      .max(3)
      .refine((w) => new Set(w.map((x) => x.provider)).size === w.length, 'One number per provider'),
    gateways: z
      .array(z.enum(['stripe', 'sslcommerz']))
      .refine((g) => new Set(g).size === g.length, 'Gateways must be unique'),
  })
  .strict();

/** An advance needs a way to pay it; checked only when a patch touches the policy or the methods. */
export function assertCanPay(settings: Pick<EffectiveSettings, 'paymentPolicy' | 'paymentMethods'>): void {
  const { manualWallets, gateways } = settings.paymentMethods;
  if (settings.paymentPolicy.type !== 'none' && manualWallets.length === 0 && gateways.length === 0) {
    throw new AppError(400, 'no_payment_method', 'Turn on at least one way to pay online, or set the advance to none');
  }
}

const venueFields = {
  paymentMethods: paymentMethodsSchema.nullable().optional(),
  hours: hoursPatchSchema.nullable().optional(),
  weekendDays: weekendDaysSchema.nullable().optional(),
  guestBooking: guestBookingSchema.nullable().optional(),
  refundRules: refundRulesSchema.nullable().optional(),
  bookingWindowDays: z.number().int().min(1).max(365).nullable().optional(),
};

/** null resets a key to the default. */
export const ownerSettingsPatchSchema = z
  .object({
    ...venueFields,
    paymentPolicy: paymentPolicySchema({ allowFixed: false }).nullable().optional(),
    pendingAutoRejectHours: z.number().int().min(0).max(72).nullable().optional(),
  })
  .strict();

/** null resets a key to "inherit from owner". */
export const venueSettingsPatchSchema = z
  .object({ ...venueFields, paymentPolicy: paymentPolicySchema({ allowFixed: true }).nullable().optional() })
  .strict();

export const turfSettingsPatchSchema = z.object({ hours: hoursPatchSchema.nullable().optional() }).strict();

/** Applies a validated patch to stored (partial) settings: null deletes, hours merge per day (a null day resets it). */
export function applyPatch<T>(stored: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = structuredClone((stored ?? {}) as Record<string, unknown>);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete out[key];
    else if (key === 'hours') {
      const hours: Record<string, unknown> = { ...((out.hours as object | undefined) ?? {}), ...(value as object) };
      for (const [day, h] of Object.entries(hours)) if (h === null) delete hours[day];
      out.hours = hours;
    } else out[key] = value;
  }
  return out as T;
}
