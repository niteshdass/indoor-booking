import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { SearchResult } from '@booking/shared';
import { Button } from '../components/ui/Button';
import { money } from '../lib/format';
import styles from './ResultsMap.module.css';

export type LatLng = { lat: number; lng: number };
export type ResultsMapProps = {
  results: SearchResult[];
  center: LatLng | null;
  onSearchArea(center: LatLng): void;
  onSelect(slug: string): void;
};

const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© OpenStreetMap contributors';
const CENTER_ZOOM = 12;
const FIT_MAX_ZOOM = 15;

/** Pin text: the price when there is one, else the venue name. */
export function pinLabel(r: SearchResult, lang: string): string {
  return r.fromPrice === null ? r.name : money(r.fromPrice, r.currency, lang);
}

/** Pin element built with the DOM: the text may come from a venue owner and is never parsed as HTML. */
export function buildPin(text: string, className: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

/** Rounds to 5 decimals (plain decimal notation, no -0) and wraps longitude into [-180, 180]. */
export function roundAndWrap(c: LatLng): LatLng {
  const round = (n: number) => Number(n.toFixed(5)) + 0;
  const lng = c.lng > 180 || c.lng < -180 ? ((((c.lng + 180) % 360) + 360) % 360) - 180 : c.lng;
  return { lat: round(c.lat), lng: round(lng) };
}

/**
 * Whether the map should fit its view to the results. Only a fresh result set does: appended pages
 * (prev is a prefix of next), identical sets (language change) and empty sets (refetch in flight) keep the view.
 */
export function shouldFit(prev: string[], next: string[]): boolean {
  if (next.length === 0) return false;
  if (prev.length === 0) return true;
  return !(prev.length <= next.length && prev.every((slug, i) => slug === next[i]));
}

export function makePinIcon(r: SearchResult, lang: string): L.DivIcon {
  return L.divIcon({ className: styles.pinWrap, html: buildPin(pinLabel(r, lang), styles.pin!), iconSize: [0, 0] });
}

export function ResultsMap({ results, center, onSearchArea, onSelect }: ResultsMapProps) {
  const { t, i18n } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const handlers = useRef({ onSearchArea, onSelect });
  handlers.current = { onSearchArea, onSelect };
  const slugs = useRef<string[]>([]);
  const positioned = useRef(false);
  const pendingFit = useRef<L.LatLngBounds | null>(null);

  const fit = (m: L.Map, bounds: L.LatLngBounds) => {
    // A hidden pane has no size; fitting now would pick a nonsense zoom, so wait until it is shown.
    if (m.getSize().x === 0 || m.getSize().y === 0) {
      pendingFit.current = bounds;
      return;
    }
    pendingFit.current = null;
    m.fitBounds(bounds, { padding: [32, 32], maxZoom: FIT_MAX_ZOOM });
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const m = L.map(el, { worldCopyJump: true }).setView([0, 0], 1);
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            m.invalidateSize();
            if (pendingFit.current && m.getSize().x > 0 && m.getSize().y > 0) fit(m, pendingFit.current);
          });
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    if (!m || !group) return;
    group.clearLayers();
    const points: L.LatLngTuple[] = [];
    for (const r of results) {
      const pos: L.LatLngTuple = [r.location.lat, r.location.lng];
      points.push(pos);
      const marker = L.marker(pos, { keyboard: true, title: r.name, alt: r.name, icon: makePinIcon(r, i18n.language) });
      const aria = r.fromPrice === null ? r.name : t('search.pinAria', { name: r.name, price: money(r.fromPrice, r.currency, i18n.language) });
      marker.on('add', () => marker.getElement()?.setAttribute('aria-label', aria));
      marker.on('click', () => handlers.current.onSelect(r.slug));
      marker.addTo(group);
    }
    const next = results.map((r) => r.slug);
    if (shouldFit(slugs.current, next)) {
      fit(m, L.latLngBounds(points));
      positioned.current = true;
    } else if (next.length === 0 && !positioned.current && center) {
      m.setView([center.lat, center.lng], CENTER_ZOOM);
      positioned.current = true;
    }
    // An empty set keeps the previous slugs: the refetch that follows must not look like a fresh search.
    if (next.length > 0) slugs.current = next;
    // center only matters before the map has been positioned.
  }, [results, i18n.language, t, center]);

  const searchArea = () => {
    const m = map.current;
    if (!m) return;
    const c = m.getCenter();
    handlers.current.onSearchArea(roundAndWrap({ lat: c.lat, lng: c.lng }));
  };

  return (
    <div className={styles.wrap}>
      <div ref={host} className={styles.map} role="region" aria-label={t('search.mapLabel')} />
      <div className={styles.action}>
        <Button size="sm" variant="secondary" onClick={searchArea}>
          {t('search.searchArea')}
        </Button>
      </div>
    </div>
  );
}
