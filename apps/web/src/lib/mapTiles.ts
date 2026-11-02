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

const ESRI_IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = 'Imagery &copy; Esri, Maxar, Earthstar Geographics';

type SatelliteEnv = { VITE_MAP_SATELLITE_URL?: string; VITE_MAP_SATELLITE_ATTRIBUTION?: string };

/**
 * Aerial photos for the venue location picker, so an owner can drop the pin on the field itself. Esri's World
 * Imagery by default; a production build can point VITE_MAP_SATELLITE_URL at a keyed provider (MapTiler satellite…).
 * Imagery is sharp to about zoom 18; past that Leaflet scales those tiles up.
 */
export function satelliteConfig(env: SatelliteEnv): TileConfig & { maxNativeZoom: number } {
  const url = env.VITE_MAP_SATELLITE_URL?.trim();
  if (!url) return { url: ESRI_IMAGERY_URL, attribution: ESRI_ATTRIBUTION, maxZoom: 20, maxNativeZoom: 18 };
  return { url, attribution: env.VITE_MAP_SATELLITE_ATTRIBUTION?.trim() || '', maxZoom: 20, maxNativeZoom: 18 };
}

export const SATELLITE_TILES = satelliteConfig({
  VITE_MAP_SATELLITE_URL: import.meta.env.VITE_MAP_SATELLITE_URL,
  VITE_MAP_SATELLITE_ATTRIBUTION: import.meta.env.VITE_MAP_SATELLITE_ATTRIBUTION,
});
