import { WEEKDAYS, isIsoDate, parseMoney, type Weekday } from '@booking/shared';

export type OverrideType = 'block' | 'modify' | 'add' | 'close';

export type OverrideDraft = {
  type: OverrideType;
  when: 'date' | 'recurring';
  date: string;
  weekdays: Weekday[];
  from: string;
  until: string;
  start: string;
  end: string;
  slotStart: string;
  price: string;
  reason: string;
};

export const REASON_MAX = 200;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The discriminated POST body for a draft. Errors map a field (`date`, `weekdays`, `from`, `until`, `start`,
 * `end`, `slotStart`, `price`, `reason`) to the i18n key of its message. `end <= start` ends the next day, so it is never an error.
 */
export function overrideBody(
  d: OverrideDraft,
  currency: string,
): { ok: true; body: object } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const body: Record<string, unknown> = { type: d.type };

  if (d.when === 'date') {
    if (!isIsoDate(d.date)) errors.date = 'owner.override.err.date';
    body.date = d.date;
  } else {
    if (d.weekdays.length === 0) errors.weekdays = 'owner.override.err.weekdays';
    if (!isIsoDate(d.from)) errors.from = 'owner.override.err.from';
    const until = d.until.trim();
    if (until !== '' && (!isIsoDate(until) || (isIsoDate(d.from) && until < d.from))) errors.until = 'owner.override.err.until';
    body.recurrence = {
      weekdays: WEEKDAYS.filter((w) => d.weekdays.includes(w)),
      from: d.from,
      ...(until === '' ? {} : { until }),
    };
  }

  if (d.type !== 'close') {
    if (!TIME_RE.test(d.start)) errors.start = 'owner.override.err.time';
    if (!TIME_RE.test(d.end)) errors.end = 'owner.override.err.time';
    body.start = d.start;
    body.end = d.end;
  }
  if (d.type === 'modify') {
    if (!TIME_RE.test(d.slotStart)) errors.slotStart = 'owner.override.err.slotStart';
    body.slotStart = d.slotStart;
  }
  if ((d.type === 'modify' || d.type === 'add') && d.price.trim() !== '') {
    try {
      body.price = parseMoney(d.price.trim(), currency);
    } catch {
      errors.price = 'owner.override.err.price';
    }
  }

  const reason = d.reason.trim();
  if (reason.length > REASON_MAX) errors.reason = 'owner.override.err.reason';
  else if (reason !== '') body.reason = reason;

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, body };
}
