import { describe, expect, it, vi } from 'vitest';
import { tileConfig } from '../src/lib/mapTiles';

describe('map tiles', () => {
  it('uses the configured provider and keeps the OpenStreetMap credit next to its own', () => {
    const c = tileConfig({
      VITE_MAP_TILE_URL: 'https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=k',
      VITE_MAP_TILE_ATTRIBUTION: '&copy; MapTiler',
      PROD: true,
    });
    expect(c.url).toBe('https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=k');
    expect(c.attribution).toMatch(/^&copy; MapTiler .*OpenStreetMap/);
  });

  it('a provider without its own credit still shows the OpenStreetMap one', () => {
    const c = tileConfig({ VITE_MAP_TILE_URL: 'https://tiles.example/{z}/{x}/{y}.png' });
    expect(c.attribution).toContain('openstreetmap.org/copyright');
  });

  it('falls back to OpenStreetMap when unset, warning in a production build', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(tileConfig({ PROD: false }).url).toContain('tile.openstreetmap.org');
    expect(warn).not.toHaveBeenCalled();
    expect(tileConfig({ VITE_MAP_TILE_URL: ' ', PROD: true }).url).toContain('tile.openstreetmap.org');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
