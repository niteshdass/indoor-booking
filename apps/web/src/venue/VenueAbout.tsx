import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Amenity } from '@booking/shared';
import type { PublicVenue } from '../lib/types';
import styles from './VenueAbout.module.css';
import { MAP_TILES } from '../lib/mapTiles';

/** 24px stroke icons, one per amenity. */
const AMENITY_ICONS: Record<Amenity, string> = {
  parking: 'M4 4h16v16H4zM10 16V8h3a2.5 2.5 0 0 1 0 5h-3',
  shower: 'M4 20V8a4 4 0 0 1 8 0M8 8h8M10 12v1M13 12v1M16 12v1M10 16v1M13 16v1M16 16v1',
  locker: 'M5 3h14v18H5zM12 3v18M9 9v2M15 9v2',
  changing_room: 'M10 6a2 2 0 1 1 2 2v2l-8 6h16l-8-6',
  toilets: 'M7 4.5h.01M17 4.5h.01M5 8h4l1 6H8v6H6v-6H4zM15 8h4v7h-1v5h-2v-5h-1z',
  cafe: 'M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 11h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3',
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  floodlights: 'M12 2v2M4.9 5.6l1.4 1.4M19.1 5.6l-1.4 1.4M8 13a4 4 0 1 1 8 0v2H8zM12 15v6M9 21h6',
  first_aid: 'M4 7h16v13H4zM9 7V4h6v3M12 10v7M8.5 13.5h7',
  equipment_rental: 'M14.5 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM10.3 13.7 3 21',
  seating: 'M6 10V5h12v5M4 10h16v4H4zM6 14v6M18 14v6',
  prayer_room: 'M12 3v2M5 21v-9a7 7 0 0 1 14 0v9zM10 21v-4a2 2 0 0 1 4 0v4',
};


function LocationMap({ lat, lng, name }: { lat: number; lng: number; name: string }) {
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

export function VenueAbout({ venue }: { venue: PublicVenue }) {
  const { t } = useTranslation();
  const { lat, lng } = venue.location;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return (
    <div className={styles.about}>
      {venue.amenities.length > 0 && (
        <section className={styles.section} aria-labelledby="venue-amenities-heading">
          <h2 id="venue-amenities-heading" className={styles.heading}>
            {t('venue.amenities')}
          </h2>
          <ul className={styles.amenities}>
            {venue.amenities.map((a) => (
              <li key={a} className={styles.amenity}>
                <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d={AMENITY_ICONS[a]} />
                </svg>
                {t(`amenities.${a}`)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={styles.section} aria-labelledby="venue-location-heading">
        <h2 id="venue-location-heading" className={styles.heading}>
          {t('venue.location')}
        </h2>
        <LocationMap lat={lat} lng={lng} name={venue.name} />
        <div className={styles.place}>
          <p className={styles.address}>
            {venue.address}, {venue.city}
          </p>
          <a className={styles.directions} href={directions} target="_blank" rel="noopener noreferrer">
            {t('venue.directions')}
          </a>
        </div>
      </section>
    </div>
  );
}
