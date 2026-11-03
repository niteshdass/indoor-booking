import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Icon } from '../../components/ui/Icon';
import { useOwner } from '../OwnerProvider';
import type { OwnerVenue, Permission } from '../types';
import styles from './FirstWeek.module.css';

/** Shown for this long after a venue is created, unless closed or finished earlier. */
const SHOW_DAYS = 30;
const DAY_MS = 86_400_000;

type Item = { key: string; to: string; perm: Permission; auto?: boolean };
type Saved = { done: string[]; hidden: boolean };

const storeKey = (venueId: string) => `first-week:${venueId}`;

function load(venueId: string): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey(venueId)) ?? 'null') as Partial<Saved> | null;
    return { done: Array.isArray(saved?.done) ? saved.done : [], hidden: saved?.hidden === true };
  } catch {
    return { done: [], hidden: false };
  }
}

function save(venueId: string, s: Saved) {
  try {
    localStorage.setItem(storeKey(venueId), JSON.stringify(s));
  } catch {
    // The list still works for this visit.
  }
}

/**
 * Today's "first week" list for a new venue: the steps that take an owner from the paper book to the app. Publish
 * and photos tick themselves; the others are ticked by hand. Remembered per venue in this browser.
 */
export function FirstWeek({ venue, now = new Date() }: { venue: OwnerVenue; now?: Date }) {
  const { t } = useTranslation();
  const { can } = useOwner();
  const [saved, setSaved] = useState(() => load(venue.id));
  const at = `?venue=${encodeURIComponent(venue.id)}`;
  const page = `../venues/${encodeURIComponent(venue.id)}`;

  const items: Item[] = (
    [
      { key: 'publish', to: page, perm: 'venue.manage', auto: venue.published },
      { key: 'photos', to: page, perm: 'venue.manage', auto: venue.photos.length > 0 },
      { key: 'paper', to: `../walk-in${at}`, perm: 'booking.create' },
      { key: 'weekly', to: `../series/new${at}`, perm: 'booking.create' },
      { key: 'helper', to: '../staff', perm: 'staff.manage' },
    ] satisfies Item[]
  ).filter((i) => can(i.perm));
  const isDone = (i: Item) => i.auto ?? saved.done.includes(i.key);
  const doneCount = items.filter(isDone).length;
  const age = now.getTime() - new Date(venue.createdAt).getTime();

  if (!can('venue.manage') || saved.hidden || items.length === 0 || doneCount === items.length || !(age < SHOW_DAYS * DAY_MS)) return null;

  const update = (next: Saved) => {
    setSaved(next);
    save(venue.id, next);
  };
  const tick = (key: string, on: boolean) =>
    update({ ...saved, done: on ? [...saved.done.filter((k) => k !== key), key] : saved.done.filter((k) => k !== key) });

  return (
    <section className={styles.card} aria-labelledby="first-week">
      <div className={styles.head}>
        <h2 id="first-week" className={styles.title}>
          {t('owner.firstWeek.title')} <span className={styles.count}>{t('owner.firstWeek.progress', { done: doneCount, total: items.length })}</span>
        </h2>
        <Button variant="ghost" size="sm" icon="close" onClick={() => update({ ...saved, hidden: true })}>
          {t('owner.firstWeek.hide')}
        </Button>
      </div>
      <p className={styles.lead}>{t('owner.firstWeek.lead')}</p>
      <ol className={styles.list}>
        {items.map((i) => {
          const done = isDone(i);
          return (
            <li key={i.key} className={[styles.item, done && styles.done].filter(Boolean).join(' ')}>
              {i.auto !== undefined ? (
                <span className={styles.auto}>
                  <span className={[styles.mark, done && styles.markOn].filter(Boolean).join(' ')} aria-hidden="true">
                    {done && <Icon name="check" />}
                  </span>
                  <span className={styles.text}>
                    <span className={styles.label}>{t(`owner.firstWeek.${i.key}`)}</span>
                    <span className={styles.hint}>{t(done ? 'owner.firstWeek.doneAuto' : `owner.firstWeek.${i.key}Hint`)}</span>
                  </span>
                </span>
              ) : (
                <Checkbox
                  className={styles.text}
                  label={t(`owner.firstWeek.${i.key}`)}
                  hint={t(`owner.firstWeek.${i.key}Hint`)}
                  checked={done}
                  onChange={(on) => tick(i.key, on)}
                />
              )}
              {!done && (
                <Link to={i.to} className={styles.go}>
                  {t(`owner.firstWeek.${i.key}Go`)}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
