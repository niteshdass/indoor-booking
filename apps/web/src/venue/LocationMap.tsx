import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import styles from './VenueAbout.module.css';
import { MAP_TILES } from '../lib/mapTiles';

/** The venue's pin on a small map; split from VenueAbout so Leaflet stays out of the main bundle. */
export function LocationMap({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const m = L.map(el, { scrollWheelZoom: false, dragging: !L.Browser.mobile, zoomControl: true }).setView([lat, lng], 15);
    L.tileLayer(MAP_TILES.url, { attribution: MAP_TILES.attribution, maxZoom: MAP_TILES.maxZoom }).addTo(m);
    const pin = document.createElement('span');
    pin.className = styles.pin!;
    L.marker([lat, lng], {
      icon: L.divIcon({ html: pin, className: styles.pinWrap, iconSize: [0, 0] }),
      keyboard: false,
      title: name,
    }).addTo(m);
    return () => {
      m.remove();
    };
  }, [lat, lng, name]);
  return <div ref={ref} className={styles.map} role="region" aria-label={t('venue.mapLabel', { name })} />;
}
