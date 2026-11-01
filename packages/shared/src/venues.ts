export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const SPORTS = [
  'football',
  'futsal',
  'cricket',
  'badminton',
  'tennis',
  'table_tennis',
  'basketball',
  'volleyball',
  'padel',
  'squash',
  'pickleball',
  'hockey',
] as const;
export type Sport = (typeof SPORTS)[number];

/** A sport in the platform catalog. Disabled sports leave the home page and every picker; turfs keep them. */
export type SportSetting = { sport: Sport; enabled: boolean };

/** Public list of the sports players and owners can pick, in the admin's order. */
export type SportsJson = { sports: Sport[] };

/** The admin's saved order and switches, with sports added since appended (enabled) and unknown ones dropped. */
export function mergeSportSettings(saved: readonly { sport: string; enabled: boolean }[] | null | undefined): SportSetting[] {
  const known = new Set<string>(SPORTS);
  const out: SportSetting[] = [];
  const seen = new Set<string>();
  for (const s of saved ?? []) {
    if (!known.has(s.sport) || seen.has(s.sport)) continue;
    seen.add(s.sport);
    out.push({ sport: s.sport as Sport, enabled: s.enabled });
  }
  for (const sport of SPORTS) if (!seen.has(sport)) out.push({ sport, enabled: true });
  return out;
}

export const AMENITIES = [
  'parking',
  'shower',
  'locker',
  'changing_room',
  'toilets',
  'cafe',
  'wifi',
  'floodlights',
  'first_aid',
  'equipment_rental',
  'seating',
  'prayer_room',
] as const;
export type Amenity = (typeof AMENITIES)[number];

// Area/Location form only: DateTimeFormat also accepts abbreviations (EST) and offsets (+05:30).
const ZONE_NAME_RE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/;

/**
 * True for an IANA time zone name known to the runtime (or 'UTC'). Asks DateTimeFormat rather than
 * Intl.supportedValuesOf, which lists ICU's old aliases (Asia/Calcutta) and omits current names (Asia/Kolkata).
 */
export function isTimeZone(tz: string): boolean {
  if (tz === 'UTC') return true;
  if (!ZONE_NAME_RE.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX = 60;

const CYRILLIC: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** URL slug from a display name; Cyrillic is transliterated. Never empty (falls back to 'venue'). */
export function slugify(name: string): string {
  let slug = [...name.toLowerCase()]
    .map((ch) => CYRILLIC[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > SLUG_MAX) {
    const cut = slug.slice(0, SLUG_MAX + 1);
    const lastDash = cut.lastIndexOf('-');
    slug = (lastDash > 0 ? cut.slice(0, lastDash) : cut.slice(0, SLUG_MAX)).replace(/-+$/, '');
  }
  return slug.length < 3 ? 'venue' : slug;
}
