import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PhoneInput } from '../components/ui/PhoneInput';
import { TextField } from '../components/ui/TextField';
import { apiGet } from '../lib/apiClient';
import { useOwner } from './OwnerProvider';
import { ownerPath } from './ownerApi';
import styles from './CustomerFields.module.css';

/** `playerId` is set only when the customer was picked from a past booking by a registered player. */
export type Customer = { name: string; phone: string; playerId?: string };

type Suggestion = { name: string; phone: string; playerId: string | null };

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

/** Name 1-80 characters (trimmed) and a phone number. */
export const customerErrors = (c: Customer) => ({
  name: c.name.trim().length < 1 || c.name.trim().length > 80,
  phone: c.phone === '',
});

/** The customer part of a walk-in or series request body. */
export const customerBody = (c: Customer) => ({
  name: c.name.trim(),
  phone: c.phone,
  ...(c.playerId ? { playerId: c.playerId } : {}),
});

/**
 * Walk-in style customer: name and phone; errors show once `tried`. Typing a name or number
 * suggests people who booked with the owner before; picking one fills both fields.
 */
export function CustomerFields({ value, onChange, tried }: { value: Customer; onChange: (next: Customer) => void; tried: boolean }) {
  const { t } = useTranslation();
  const bad = customerErrors(value);
  const { ownerId } = useOwner();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Remounts the phone field on a pick, so its country code follows the picked number.
  const [picks, setPicks] = useState(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setSuggestions([]);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      apiGet<{ customers: Suggestion[] }>(ownerPath(ownerId, `/customers?q=${encodeURIComponent(q)}`))
        .then((res) => {
          if (!live) return;
          setSuggestions(res.customers);
          setActive(-1);
        })
        // Suggestions are a convenience; on failure the fields still work by hand.
        .catch(() => live && setSuggestions([]));
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [ownerId, query]);

  const shown = open && suggestions.length > 0;

  const pick = (s: Suggestion) => {
    onChange({ name: s.name, phone: s.phone, ...(s.playerId ? { playerId: s.playerId } : {}) });
    setPicks((n) => n + 1);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!shown) {
      if (e.key === 'ArrowDown' && suggestions.length > 0) setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(suggestions[active]!);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <>
      <div className={styles.combo}>
        <TextField
          label={t('owner.walkIn.name')}
          value={value.name}
          maxLength={80}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={listId}
          aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
          hint={t('owner.walkIn.customerSearchHint')}
          error={tried && bad.name ? t('owner.walkIn.nameRequired') : undefined}
          onChange={(e) => {
            // A typed name is a new person until they pick someone again.
            onChange({ name: e.target.value, phone: value.phone });
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        <ul id={listId} role="listbox" aria-label={t('owner.walkIn.customerSuggestions')} className={styles.list} hidden={!shown}>
          {suggestions.map((s, i) => (
            <li
              key={s.playerId ?? s.phone}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={styles.option}
              // mousedown, not click: picking must happen before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className={styles.name}>{s.name}</span>
              <span className={styles.meta}>
                {s.phone && <span className={styles.phone}>{s.phone}</span>}
                {s.playerId && <span className={styles.player}>{t('owner.walkIn.registeredPlayer')}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <PhoneInput
        key={picks}
        label={t('owner.walkIn.phoneLabel')}
        value={value.phone}
        onChange={(phone) => onChange({ name: value.name, phone })}
        error={tried && bad.phone ? t('owner.walkIn.phoneRequired') : undefined}
      />
    </>
  );
}
