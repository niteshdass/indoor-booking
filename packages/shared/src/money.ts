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

export function currencyExponent(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency) || !SUPPORTED_CURRENCIES.has(currency)) {
    throw new InvalidCurrencyError(currency);
  }
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits as number;
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

/** Percentage of a minor-unit amount, rounded half up to a whole minor unit. */
export function percentOf(minor: number, percent: number): number {
  assertMinor(minor);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new InvalidMoneyError(`Percent must be between 0 and 100, got ${percent}`);
  }
  return Math.round((minor * percent) / 100);
}
