import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import styles from './venues.module.css';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { TextField } from '../../components/ui/TextField';
import { apiPost } from '../../lib/apiClient';
import { coordsFromText, isShortMapLink, searchPlaces, type Place } from '../../lib/geo';
import { MAP_TILES, SATELLITE_TILES } from '../../lib/mapTiles';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';

export type LocationPickerProps = {
  lat: number | null;
  lng: number | null;
  /** Venue country (ISO alpha-2): place search looks there first. */
  country: string;
  onChange(lat: number, lng: number): void;
  /** A searched place was picked; the form may fill an empty city from it. */
  onPlace?(place: Place): void;
};

const EMPTY_ZOOM = 2;
const PIN_ZOOM = 15;
/** Close enough to tell one pitch from the next on aerial photos. */
const FIELD_ZOOM = 18;

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; what: 'find' | 'locate' }
  | { kind: 'note'; key: string; meters?: number }
  | { kind: 'error'; key: string };

/** Six decimals (about 0.1 m), plain notation, no -0; longitude wrapped into [-180, 180]. */
export function toCoord(lat: number, lng: number): { lat: number; lng: number } {
  const wrapped = lng > 180 || lng < -180 ? ((((lng + 180) % 360) + 360) % 360) - 180 : lng;
  const round = (n: number) => Number(n.toFixed(6)) + 0;
  return { lat: round(Math.max(-90, Math.min(90, lat))), lng: round(wrapped) };
}

/** Pin built with the DOM; focusable styling lives on the marker wrapper. */
function makeIcon(): L.DivIcon {
  const el = document.createElement('span');
  el.className = styles.pin!;
  return L.divIcon({ className: styles.pinWrap, html: el, iconSize: [0, 0] });
}

/**
 * OpenStreetMap map with one draggable pin. The owner gets near the field by searching a place, pasting a map
 * link or coordinates, or using the device's location; then fine-tunes by clicking or dragging, on aerial photos
 * if they like.
 */
export function LocationPicker({ lat, lng, country, onChange, onPlace }: LocationPickerProps) {
  const { t, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const layers = useRef<{ map: L.TileLayer; satellite: L.TileLayer } | null>(null);
  const emit = useRef(onChange);
  emit.current = onChange;
  /** The last position this component reported, so its own echo does not re-centre the map. */
  const reported = useRef<string | null>(null);
  const searching = useRef<AbortController | null>(null);

  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [satellite, setSatellite] = useState(false);

  const report = (a: number, b: number) => {
    const c = toCoord(a, b);
    reported.current = `${c.lat},${c.lng}`;
    emit.current(c.lat, c.lng);
  };

  /** Pin at a point and show it close up. */
  const goTo = (a: number, b: number, zoom = FIELD_ZOOM) => {
    map.current?.setView([a, b], zoom);
    report(a, b);
  };

  const pickPlace = (p: Place) => {
    setPlaces([]);
    const m = map.current;
    if (m && p.bounds) {
      const [s, w, n, e] = p.bounds;
      m.fitBounds([[s, w], [n, e]], { maxZoom: FIELD_ZOOM });
      report(p.lat, p.lng);
    } else goTo(p.lat, p.lng);
    setStatus({ kind: 'note', key: 'owner.venues.pinPlaced' });
    onPlace?.(p);
  };

  const find = async () => {
    const text = query.trim();
    if (!text) return;
    searching.current?.abort();
    setPlaces([]);
    const direct = coordsFromText(text);
    if (direct) {
      goTo(direct.lat, direct.lng);
      setStatus({ kind: 'note', key: 'owner.venues.pinPlaced' });
      return;
    }
    const ctrl = new AbortController();
    searching.current = ctrl;
    setStatus({ kind: 'busy', what: 'find' });
    try {
      if (isShortMapLink(text)) {
        const { url } = await apiPost<{ url: string }>(ownerPath(ownerId, '/map-link'), { url: text });
        const c = coordsFromText(url);
        if (ctrl.signal.aborted) return;
        if (c) {
          goTo(c.lat, c.lng);
          setStatus({ kind: 'note', key: 'owner.venues.pinPlaced' });
        } else setStatus({ kind: 'error', key: 'owner.venues.linkNoCoords' });
        return;
      }
      if (/^https?:\/\//i.test(text)) {
        setStatus({ kind: 'error', key: 'owner.venues.linkNoCoords' });
        return;
      }
      let found = await searchPlaces(text, { country, lang: i18n.language, signal: ctrl.signal });
      // A place across the border is better than nothing (venues near it, or a country not yet chosen).
      if (found.length === 0 && country) found = await searchPlaces(text, { lang: i18n.language, signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (found.length === 0) setStatus({ kind: 'error', key: 'owner.venues.noPlace' });
      else if (found.length === 1) pickPlace(found[0]!);
      else {
        setPlaces(found);
        setStatus({ kind: 'note', key: 'owner.venues.pickPlace' });
      }
    } catch {
      if (ctrl.signal.aborted) return;
      setStatus({ kind: 'error', key: isShortMapLink(text) ? 'owner.venues.linkNoCoords' : 'owner.venues.placeError' });
    }
  };

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setStatus({ kind: 'error', key: 'owner.venues.locateUnavailable' });
      return;
    }
    setStatus({ kind: 'busy', what: 'locate' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        goTo(pos.coords.latitude, pos.coords.longitude);
        setStatus({ kind: 'note', key: 'owner.venues.located', meters: Math.max(1, Math.round(pos.coords.accuracy)) });
      },
      (err) =>
        setStatus({
          kind: 'error',
          key: err.code === err.PERMISSION_DENIED ? 'owner.venues.locateDenied' : 'owner.venues.locateUnavailable',
        }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // The picker sits inside the venue form: Enter searches instead of saving the venue.
    if (e.key === 'Enter') {
      e.preventDefault();
      void find();
    }
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const m = L.map(el, { worldCopyJump: true, maxZoom: SATELLITE_TILES.maxZoom }).setView([0, 0], EMPTY_ZOOM);
    const base = L.tileLayer(MAP_TILES.url, { attribution: MAP_TILES.attribution, maxZoom: SATELLITE_TILES.maxZoom, maxNativeZoom: MAP_TILES.maxZoom });
    const photo = L.tileLayer(SATELLITE_TILES.url, {
      attribution: SATELLITE_TILES.attribution,
      maxZoom: SATELLITE_TILES.maxZoom,
      maxNativeZoom: SATELLITE_TILES.maxNativeZoom,
    });
    base.addTo(m);
    layers.current = { map: base, satellite: photo };
    m.on('click', (e: L.LeafletMouseEvent) => report(e.latlng.lat, e.latlng.lng));
    map.current = m;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => m.invalidateSize());
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      searching.current?.abort();
      m.remove();
      map.current = null;
      marker.current = null;
      layers.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const l = layers.current;
    if (!m || !l) return;
    const [on, off] = satellite ? [l.satellite, l.map] : [l.map, l.satellite];
    off.remove();
    if (!m.hasLayer(on)) on.addTo(m);
  }, [satellite]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (lat === null || lng === null) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    const pos: L.LatLngTuple = [lat, lng];
    if (marker.current) marker.current.setLatLng(pos);
    else {
      const pin = L.marker(pos, { draggable: true, keyboard: true, title: t('owner.venues.pinLabel'), alt: t('owner.venues.pinLabel'), icon: makeIcon() });
      pin.on('dragend', () => {
        const p = pin.getLatLng();
        report(p.lat, p.lng);
      });
      pin.addTo(m);
      marker.current = pin;
    }
    if (reported.current !== `${lat},${lng}`) m.setView(pos, Math.max(m.getZoom(), PIN_ZOOM));
    else if (!m.getBounds().contains(pos)) m.panTo(pos);
  }, [lat, lng, t]);

  const busy = status.kind === 'busy' ? status.what : null;
  const message =
    status.kind === 'note' || status.kind === 'error'
      ? t(status.key, status.kind === 'note' && status.meters !== undefined ? { meters: status.meters } : undefined)
      : busy === 'locate'
        ? t('owner.venues.locating')
        : '';

  return (
    <div className={styles.picker}>
      <div className={styles.finder}>
        <TextField
          className={styles.finderField}
          icon="search"
          type="search"
          enterKeyHint="search"
          label={t('owner.venues.findPlace')}
          placeholder={t('owner.venues.findPlaceholder')}
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className={styles.finderActions}>
          <Button variant="secondary" icon="search" loading={busy === 'find'} disabled={!query.trim()} onClick={() => void find()}>
            {t('owner.venues.find')}
          </Button>
          <Button variant="secondary" icon="locate" loading={busy === 'locate'} onClick={locate}>
            {t('owner.venues.myLocation')}
          </Button>
        </div>
      </div>

      {places.length > 0 && (
        <ul className={styles.places} aria-label={t('owner.venues.placesFound')}>
          {places.map((p) => (
            <li key={`${p.lat},${p.lng},${p.label}`}>
              <button type="button" className={styles.place} onClick={() => pickPlace(p)}>
                <Icon name="pin" className={styles.placeIcon} />
                <span>{p.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className={[styles.finderStatus, status.kind === 'error' && styles.finderError].filter(Boolean).join(' ')} role="status">
        {message}
      </p>

      <div className={[styles.mapFrame, satellite && styles.onPhoto].filter(Boolean).join(' ')}>
        <div ref={host} className={styles.map} role="region" aria-label={t('owner.venues.mapLabel')} />
        <div className={styles.mapStyle} role="group" aria-label={t('owner.venues.mapStyle')}>
          <button type="button" className={styles.mapStyleBtn} aria-pressed={!satellite} onClick={() => setSatellite(false)}>
            {t('owner.venues.mapView')}
          </button>
          <button type="button" className={styles.mapStyleBtn} aria-pressed={satellite} onClick={() => setSatellite(true)}>
            {t('owner.venues.satelliteView')}
          </button>
        </div>
      </div>
    </div>
  );
}
