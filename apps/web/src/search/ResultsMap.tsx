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

export function ResultsMap({ results, center, onSearchArea, onSelect }: ResultsMapProps) {
  const { t, i18n } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const handlers = useRef({ onSearchArea, onSelect });
  handlers.current = { onSearchArea, onSelect };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const m = L.map(el, { worldCopyJump: true }).setView([0, 0], 1);
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => m.invalidateSize());
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
      const marker = L.marker(pos, {
        keyboard: true,
        title: r.name,
        alt: r.name,
        icon: L.divIcon({
          className: styles.pinWrap,
          html: buildPin(pinLabel(r, i18n.language), styles.pin!),
          iconSize: [0, 0],
        }),
      });
      const aria = r.fromPrice === null ? r.name : t('search.pinAria', { name: r.name, price: money(r.fromPrice, r.currency, i18n.language) });
      marker.on('add', () => marker.getElement()?.setAttribute('aria-label', aria));
      marker.on('click', () => handlers.current.onSelect(r.slug));
      marker.addTo(group);
    }
    if (points.length > 0) m.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: FIT_MAX_ZOOM });
    else if (center) m.setView([center.lat, center.lng], CENTER_ZOOM);
    else m.setView([0, 0], 1);
    // center only matters when there are no results to fit.
  }, [results, i18n.language, t]);

  useEffect(() => {
    if (results.length === 0 && center) map.current?.setView([center.lat, center.lng], CENTER_ZOOM);
  }, [center?.lat, center?.lng]);

  const searchArea = () => {
    const m = map.current;
    if (!m) return;
    const c = m.getCenter().wrap();
    const round = (n: number) => Number(n.toFixed(5));
    handlers.current.onSearchArea({ lat: round(c.lat), lng: round(c.lng) });
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
