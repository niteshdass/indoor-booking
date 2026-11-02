import { currencyExponent } from '@booking/shared';

export type Cell = string | number | null | undefined;

/** Byte-order mark: without it Excel reads UTF-8 as the system code page and garbles Bangla and Cyrillic names. */
export const BOM = '﻿';

/**
 * One CSV field (RFC 4180). Text that a spreadsheet would run as a formula (leading = + - @, tab or
 * carriage return) gets a leading apostrophe, so a customer named "=HYPERLINK(…)" stays text.
 */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: readonly Cell[]): string {
  return cells.map(csvCell).join(',') + '\r\n';
}

/** Minor units as a plain decimal in major units ("1250.50"): no symbol or grouping, so a spreadsheet reads it as a number. */
export function csvMoney(minor: number, currency: string): number | string {
  const exponent = currencyExponent(currency);
  if (exponent === 0) return minor;
  const digits = String(minor).padStart(exponent + 1, '0');
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}
