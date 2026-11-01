/** Bangladesh SMS providers the platform can send through, for Bangladeshi mobile numbers. */
export const BD_SMS_PROVIDERS = ['ssl_wireless', 'bulksmsbd'] as const;
export type BdSmsProvider = (typeof BD_SMS_PROVIDERS)[number];

/** A Bangladeshi mobile number in E.164 (+8801XXXXXXXXX). */
export const isBdNumber = (to: string): boolean => /^\+8801\d{9}$/.test(to);

// GSM 03.38 default alphabet and its extension table (each extension character takes two septets).
const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM_EXTENDED = new Set('^{}\\[~]|€\f');

/**
 * How many SMS parts `text` is billed as. GSM-7 text fits 160 septets in one part and 153 per part
 * once split; anything else (Bangla, Russian, emoji) is UCS-2 at 70 and 67 UTF-16 units. Empty is 0.
 */
export function smsSegments(text: string): number {
  if (text.length === 0) return 0;
  let septets = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.has(ch)) septets += 1;
    else if (GSM_EXTENDED.has(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) return septets <= 160 ? 1 : Math.ceil(septets / 153);
  return text.length <= 70 ? 1 : Math.ceil(text.length / 67);
}

/** An owner's SMS balance and use, on the owner's settings page. Credits count SMS parts. */
export type OwnerSmsUsageJson = {
  /** False while the platform does not meter SMS: every owner's messages go out uncharged. */
  metered: boolean;
  credits: number;
  /** Since the start of this calendar month (UTC). */
  thisMonth: { messages: number; segments: number };
};
