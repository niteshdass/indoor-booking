import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { SearchResult } from '@booking/shared';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { moneyShort } from '../lib/format';
import { toBbox, type Bbox } from './searchParams';
import styles from './ResultsMap.module.css';

export type LatLng = { lat: number; lng: number };
export type ResultsMapProps = {
  results: SearchResult[];
  center: LatLng | null;
  /** The map area the list is limited to; while set, new results never move the map. */
  bbox: Bbox | null;
  /** The user moved the map: limit the search to this area. */
  onArea(bbox: Bbox): void;
  onSelect(slug: string): void;
  /** Identifies the search; a new value makes the next non-empty result set fit the view. */
  fitKey?: string;
};

const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© OpenStreetMap contributors';
const CENTER_ZOOM = 12;
const FIT_MAX_ZOOM = 15;
const AT_CENTER = 0.0001; // degrees
/** Wait this long after the map stops before searching, so a few quick zooms make one request. */
export const AREA_DEBOUNCE_MS = 400;

/** Pin text: the price when there is one, else the venue name. */
export function pinLabel(r: SearchResult, lang: string): string {
  return r.fromPrice === null ? r.name : moneyShort(r.fromPrice, r.currency, lang);
}

/** Pin element built with the DOM: the text may come from a venue owner and is never parsed as HTML. */
export function buildPin(text: string, className: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * Whether the map should fit its view to the results: the first non-empty set of each search (`key`) does.
 * Appended pages and language changes keep the key, and an empty set (refetch in flight) waits for results.
 */
export function shouldFit(fittedKey: string | null, key: string, count: number): boolean {
  return count > 0 && fittedKey !== key;
}

export type ViewState = {
  fittedKey: string | null;
  centeredKey: string | null;
  key: string;
  count: number;
  hasCenter: boolean;
  /** The map is already centred on `center` (e.g. after "Search this area"). */
  atCenter: boolean;
};

/**
 * What the map should do with its view: 'fit' the results, 'center' on the search centre (empty result set of a
 * new search), 'mark' the key as handled without moving, or leave it ('none').
 */
/** Before any result or location: Dhaka, the first market (PRODUCT.md), rather than the whole world. */
const START = { center: [23.78, 90.4] as [number, number], zoom: 11 };

export function viewAction(v: ViewState): 'fit' | 'center' | 'mark' | 'none' {
  if (shouldFit(v.fittedKey, v.key, v.count)) return 'fit';
  if (v.count === 0 && v.hasCenter && v.centeredKey !== v.key)
    return v.atCenter ? 'mark' : 'center';
  return 'none';
}

const bboxKey = (b: Bbox) => `${b.west},${b.south},${b.east},${b.north}`;

/** The map's view as a search box (null for a pane with no size). */
function viewBbox(m: L.Map): Bbox | null {
  if (m.getSize().x === 0 || m.getSize().y === 0) return null;
  const b = m.getBounds();
  return toBbox({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
}

export function makePinIcon(r: SearchResult, lang: string): L.DivIcon {
  return L.divIcon({
    className: styles.pinWrap,
    html: buildPin(pinLabel(r, lang), styles.pin!),
    iconSize: [0, 0],
  });
}

export function ResultsMap({
  results,
  center,
  bbox,
  onArea,
  onSelect,
  fitKey = '',
}: ResultsMapProps) {
  const { t, i18n } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const handlers = useRef({ onArea, onSelect });
  handlers.current = { onArea, onSelect };
  const fittedKey = useRef<string | null>(null);
  const centeredKey = useRef<string | null>(null);
  const pendingFit = useRef<{ bounds: L.LatLngBounds; padding: number } | null>(null);
  /** Set while the map is moved by code: those moves are not the user choosing an area. */
  const quiet = useRef(0);
  /** The last area this map reported or showed, so a box coming back through the URL does not move it again. */
  const shownArea = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(follow);
  followRef.current = follow;
  /** Moved by the user since the last search, with "search as I move" off. */
  const [moved, setMoved] = useState(false);

  // Code moves are never animated, so every move event they cause fires inside the call.
  const quietly = (f: () => void) => {
    quiet.current += 1;
    try {
      f();
    } finally {
      quiet.current -= 1;
    }
  };

  const fit = (m: L.Map, bounds: L.LatLngBounds, padding = 32) => {
    // A hidden pane has no size; fitting now would pick a nonsense zoom, so wait until it is shown.
    if (m.getSize().x === 0 || m.getSize().y === 0) {
      pendingFit.current = { bounds, padding };
      return;
    }
    pendingFit.current = null;
    quietly(() => m.fitBounds(bounds, { padding: [padding, padding], maxZoom: FIT_MAX_ZOOM, animate: false }));
  };

  const report = (m: L.Map) => {
    const area = viewBbox(m);
    if (!area) return;
    shownArea.current = bboxKey(area);
    setMoved(false);
    handlers.current.onArea(area);
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const m = L.map(el, { worldCopyJump: true }).setView(START.center, START.zoom);
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    m.on('moveend', () => {
      if (quiet.current > 0) return;
      if (timer.current) clearTimeout(timer.current);
      if (!followRef.current) {
        setMoved(true);
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        report(m);
      }, AREA_DEBOUNCE_MS);
    });
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            quietly(() => m.invalidateSize());
            if (pendingFit.current && m.getSize().x > 0 && m.getSize().y > 0)
              fit(m, pendingFit.current.bounds, pendingFit.current.padding);
          });
    ro?.observe(el);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      ro?.disconnect();
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  // Show an area that came from the URL (a shared link, back and forward) rather than from moving this map.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!bbox) {
      shownArea.current = null;
      return;
    }
    if (shownArea.current === bboxKey(bbox)) return;
    shownArea.current = bboxKey(bbox);
    const east = bbox.east < bbox.west ? bbox.east + 360 : bbox.east;
    fit(m, L.latLngBounds([bbox.south, bbox.west], [bbox.north, east]), 0);
  }, [bbox]);

  const locked = bbox !== null;
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
        icon: makePinIcon(r, i18n.language),
      });
      const aria =
        r.fromPrice === null
          ? r.name
          : t('search.pinAria', {
              name: r.name,
              price: moneyShort(r.fromPrice, r.currency, i18n.language),
            });
      marker.on('add', () => marker.getElement()?.setAttribute('aria-label', aria));
      marker.on('click', () => handlers.current.onSelect(r.slug));
      marker.addTo(group);
    }
    if (locked) return;
    const action = viewAction({
      fittedKey: fittedKey.current,
      centeredKey: centeredKey.current,
      key: fitKey,
      count: results.length,
      hasCenter: center !== null,
      atCenter:
        center !== null &&
        Math.abs(m.getCenter().lat - center.lat) < AT_CENTER &&
        Math.abs(m.getCenter().lng - center.lng) < AT_CENTER,
    });
    if (action === 'fit') {
      fit(m, L.latLngBounds(points));
      fittedKey.current = fitKey;
    } else if (action === 'center' && center) {
      quietly(() => m.setView([center.lat, center.lng], CENTER_ZOOM, { animate: false }));
      centeredKey.current = fitKey;
    } else if (action === 'mark') {
      centeredKey.current = fitKey;
    }
  }, [results, i18n.language, t, center, fitKey, locked]);

  const searchArea = () => {
    if (map.current) report(map.current);
  };

  const toggleFollow = (on: boolean) => {
    setFollow(on);
    if (on && moved) searchArea();
  };

  return (
    <div className={styles.wrap}>
      <div ref={host} className={styles.map} role="region" aria-label={t('search.mapLabel')} />
      <div className={styles.action}>
        <Checkbox
          className={styles.follow}
          label={t('search.followMap')}
          checked={follow}
          onChange={toggleFollow}
        />
        {!follow && moved && (
          <Button size="sm" variant="secondary" onClick={searchArea}>
            {t('search.searchArea')}
          </Button>
        )}
      </div>
    </div>
  );
}
