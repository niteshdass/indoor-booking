// All money is stored as integer minor units (cents, paisa, ...) plus an ISO 4217 code.

export class InvalidCurrencyError extends Error {
  constructor(currency: string) {
    super(`Invalid currency code: "${currency}"`);
    this.name = 'InvalidCurrencyError';
  }
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

// ISO 4217 minor-unit exponents that differ from the default of 2. Kept explicit so stored
// amounts never depend on the runtime's ICU data (which e.g. reports 0 digits for IDR/HUF).
const ISO_4217_EXPONENTS: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

export function currencyExponent(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency) || !SUPPORTED_CURRENCIES.has(currency)) {
    throw new InvalidCurrencyError(currency);
  }
  return ISO_4217_EXPONENTS[currency] ?? 2;
}

export function assertMinor(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidMoneyError(`Invalid minor-unit amount: ${value}`);
  }
}

/** Parses a decimal string such as "12.50" into minor units. Never rounds. */
export function parseMoney(input: string, currency: string): number {
  const exponent = currencyExponent(currency);
  if (!/^\d+(\.\d+)?$/.test(input)) {
    throw new InvalidMoneyError(`Invalid amount: "${input}"`);
  }
  const [whole = '', fraction = ''] = input.split('.');
  if (fraction.length > exponent) {
    throw new InvalidMoneyError(`${currency} allows at most ${exponent} decimal places`);
  }
  const minor = Number(whole + fraction.padEnd(exponent, '0'));
  assertMinor(minor);
  return minor;
}

export function formatMoney(minor: number, currency: string, locale?: string): string {
  const exponent = currencyExponent(currency);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    minor / 10 ** exponent,
  );
}

/**
 * Percentage (0..100, at most 2 decimals) of a minor-unit amount, rounded half up to a whole
 * minor unit. Computed in integer basis points so fractional percents are exact.
 */
export function percentOf(minor: number, percent: number): number {
  assertMinor(minor);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new InvalidMoneyError(`Percent must be between 0 and 100, got ${percent}`);
  }
  const basisPoints = Math.round(percent * 100);
  if (Math.abs(basisPoints - percent * 100) > 1e-6) {
    throw new InvalidMoneyError(`Percent allows at most 2 decimal places, got ${percent}`);
  }
  return Number((BigInt(minor) * BigInt(basisPoints) + 5000n) / 10000n);
}
