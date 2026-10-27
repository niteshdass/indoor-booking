/** Up to two initials for an avatar disc or org mark; spreads each word so an emoji or astral letter stays whole. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join('');
}
