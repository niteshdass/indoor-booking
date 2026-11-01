const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export type TileConfig = { url: string; attribution: string; maxZoom: number };

type TileEnv = { VITE_MAP_TILE_URL?: string; VITE_MAP_TILE_ATTRIBUTION?: string; PROD?: boolean };

/**
 * Where every map loads its tiles. The OpenStreetMap servers forbid production traffic, so a production build
 * reads a keyed provider (MapTiler, Stadia, Carto…) from VITE_MAP_TILE_URL, with that provider's credit in
 * VITE_MAP_TILE_ATTRIBUTION. The OpenStreetMap credit is always kept: every one of those maps is built on its data.
 */
export function tileConfig(env: TileEnv): TileConfig {
  const url = env.VITE_MAP_TILE_URL?.trim();
  if (!url) {
    if (env.PROD) console.warn('VITE_MAP_TILE_URL is not set: maps fall back to the OpenStreetMap tile servers');
    return { url: OSM_URL, attribution: OSM_ATTRIBUTION, maxZoom: 19 };
  }
  const credit = env.VITE_MAP_TILE_ATTRIBUTION?.trim();
  return { url, attribution: credit ? `${credit} ${OSM_ATTRIBUTION}` : OSM_ATTRIBUTION, maxZoom: 19 };
}

export const MAP_TILES: TileConfig = tileConfig(import.meta.env);
