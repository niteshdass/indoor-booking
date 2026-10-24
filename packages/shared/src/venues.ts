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

const TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

/** True for an IANA time zone name known to the runtime (or 'UTC'). */
export function isTimeZone(tz: string): boolean {
  return tz === 'UTC' || TIME_ZONES.has(tz);
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
