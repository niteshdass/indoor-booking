import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import styles from './venues.module.css';

export type LocationPickerProps = {
  lat: number | null;
  lng: number | null;
  onChange(lat: number, lng: number): void;
};

const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© OpenStreetMap contributors';
const EMPTY_ZOOM = 2;
const PIN_ZOOM = 15;

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

/** OpenStreetMap map with one draggable pin. Click the map or drag the pin to set the position. */
export function LocationPicker({ lat, lng, onChange }: LocationPickerProps) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const emit = useRef(onChange);
  emit.current = onChange;
  /** The last position this component reported, so its own echo does not re-centre the map. */
  const reported = useRef<string | null>(null);

  const report = (a: number, b: number) => {
    const c = toCoord(a, b);
    reported.current = `${c.lat},${c.lng}`;
    emit.current(c.lat, c.lng);
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const m = L.map(el, { worldCopyJump: true }).setView([0, 0], EMPTY_ZOOM);
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => report(e.latlng.lat, e.latlng.lng));
    map.current = m;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => m.invalidateSize());
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      m.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

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

  return (
    <div className={styles.mapFrame}>
      <div ref={host} className={styles.map} role="region" aria-label={t('owner.venues.mapLabel')} />
    </div>
  );
}
