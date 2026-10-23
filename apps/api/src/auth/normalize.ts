import { parsePhoneNumberWithError } from 'libphonenumber-js';
import { AppError } from '../errors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new AppError(400, 'invalid_email', 'Invalid email address');
  return email;
}

/** E.164; the number must carry its +country code (no default country — worldwide users). */
export function normalizePhone(input: string): string {
  const raw = input.trim();
  const invalid = new AppError(
    400,
    'invalid_phone',
    'Invalid phone number; include the country code, e.g. +8801712345678',
  );
  if (!raw.startsWith('+')) throw invalid;
  try {
    const phone = parsePhoneNumberWithError(raw);
    if (!phone.isValid()) throw invalid;
    return phone.number;
  } catch {
    throw invalid;
  }
}
