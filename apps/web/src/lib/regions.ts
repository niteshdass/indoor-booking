import { isTimeZone } from '@booking/shared';

type Option = { value: string; label: string };

/** ISO 3166-1 alpha-2 codes (plus XK, Kosovo). Intl has no list of regions, only names for them. */
const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ');

/** ICU still lists some zones under their old names; show and store the current ones. */
const ZONE_RENAMES: Readonly<Record<string, string>> = {
  'America/Godthab': 'America/Nuuk',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

function displayNames(lang: string, type: 'region' | 'currency'): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([lang], { type, fallback: 'none' });
  } catch {
    return null;
  }
}

const byLabel = (lang: string) => (a: Option, b: Option) => a.label.localeCompare(b.label, lang);

/** Keeps a saved value the list doesn't know, so the select still shows it. */
const withCurrent = (options: Option[], current: string) =>
  current && !options.some((o) => o.value === current) ? [{ value: current, label: current }, ...options] : options;

/** Every country by its name in `lang`, sorted by that name. */
export function countryOptions(lang: string, current = ''): Option[] {
  const names = displayNames(lang, 'region');
  const options = COUNTRY_CODES.map((code) => ({ value: code, label: names?.of(code) ?? code })).sort(byLabel(lang));
  return withCurrent(options, current);
}

/** Every currency the runtime knows, as "BDT · Bangladeshi Taka" in `lang`, sorted by code. */
export function currencyOptions(lang: string, current = ''): Option[] {
  const names = displayNames(lang, 'currency');
  const options = Intl.supportedValuesOf('currency').map((code) => {
    const name = names?.of(code);
    return { value: code, label: name && name !== code ? `${code} · ${name}` : code };
  });
  return withCurrent(options, current);
}

function offsetOf(zone: string, at: Date): string {
  try {
    const part = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? '';
  } catch {
    return '';
  }
}

/** Every IANA zone as "Asia/Dhaka (GMT+6)", sorted by name; the offset is today's, so it follows summer time. */
export function timeZoneOptions(current = '', at = new Date()): Option[] {
  const zones = new Set(['UTC']);
  for (const z of Intl.supportedValuesOf('timeZone')) {
    const name = ZONE_RENAMES[z] ?? z;
    zones.add(isTimeZone(name) ? name : z);
  }
  const options = [...zones].sort().map((zone) => {
    const offset = offsetOf(zone, at);
    const label = zone.replace(/_/g, ' ');
    return { value: zone, label: offset && offset !== 'GMT' ? `${label} (${offset})` : label };
  });
  return withCurrent(options, current);
}

/** The browser's own zone, when it is a name the API accepts. */
export function localTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const name = ZONE_RENAMES[zone] ?? zone;
    return isTimeZone(name) ? name : '';
  } catch {
    return '';
  }
}
