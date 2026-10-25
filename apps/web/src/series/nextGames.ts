import type { SeriesGameJson } from '@booking/shared';

/** Games that are still alive; a player can cancel these. */
const OPEN_GAME = new Set(['pending', 'awaiting_payment', 'confirmed']);

/** A series card's "Next games": open games that have not ended, soonest first. */
export function nextGames(games: SeriesGameJson[], now: number): SeriesGameJson[] {
  return games
    .filter((g) => OPEN_GAME.has(g.status) && Date.parse(g.endAt) > now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}
