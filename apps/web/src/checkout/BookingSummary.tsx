import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AddonLine, WalletProvider } from '@booking/shared';
import { PROVIDER_NAMES } from '../lib/wallets';
import { formatDate, formatTime, money } from '../lib/format';
import { playerFee } from '../lib/platformFee';
import type { PublicTurf, PublicVenue, QuoteJson } from '../lib/types';
import styles from './BookingSummary.module.css';

function duration(minutes: number, t: TFunction): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t('checkout.durationM', { minutes: rest });
  if (rest === 0) return t('checkout.durationH', { hours });
  return t('checkout.durationHM', { hours, minutes: rest });
}

function addonLabel(a: AddonLine, t: TFunction): string {
  if (a.pricingType === 'per_unit') return `${a.name} × ${a.quantity}`;
  if (a.pricingType === 'per_hour' && a.minutes) return `${a.name} · ${duration(a.minutes, t)}`;
  return a.name;
}

/** "Pay ৳500.00 now by bKash or card · rest at venue", or why nothing can be paid online. */
function HowToPay({ due, currency, methods }: { due: number; currency: string; methods: { wallets: WalletProvider[]; card: boolean } }) {
  const { t, i18n } = useTranslation();
  const names = [...methods.wallets.map((w) => PROVIDER_NAMES[w]), ...(methods.card ? [t('checkout.card')] : [])];
  if (names.length === 0) return <p className={styles.howToPay}>{t('checkout.noMethods')}</p>;
  const list = new Intl.ListFormat(i18n.language, { type: 'disjunction' }).format(names);
  return <p className={styles.howToPay}>{t('checkout.payBy', { amount: money(due, currency, i18n.language), methods: list, interpolation: { escapeValue: false } })}</p>;
}

type Item = { turfId?: string; date: string; quote: QuoteJson };

/** Items grouped by court and date, in order. */
function byDay(items: Item[]): [string, Item[]][] {
  const out: [string, Item[]][] = [];
  for (const item of items) {
    const key = `${item.turfId ?? ''}|${item.date}`;
    const last = out[out.length - 1];
    if (last && last[0] === key) last[1].push(item);
    else out.push([key, [item]]);
  }
  return out;
}

type Props = {
  venue: PublicVenue;
  turf: PublicTurf;
  date: string;
  quote: QuoteJson;
  /** Several bookings at once, each on its own court, day and times: one row each, add-ons counted on each. */
  items?: Item[] | null;
  groupTotal?: number;
  groupDue?: number;
  busy?: boolean;
  /** What the venue takes online; absent when the quote did not say. */
  paymentMethods?: { wallets: WalletProvider[]; card: boolean };
  children?: ReactNode;
};

export function BookingSummary({ venue, turf, date, quote, items, groupTotal, groupDue, busy = false, paymentMethods, children }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const fmt = (n: number) => money(n, quote.currency, lang);
  const multi = items && items.length > 1 ? items : null;
  const due = multi ? (groupDue ?? 0) : quote.advanceRequired;
  const total = multi ? (groupTotal ?? multi.reduce((n, d) => n + d.quote.total, 0)) : quote.total;
  // Already in each quote's total; shown so the player sees what the total is made of.
  const fee = multi ? multi.reduce((n, d) => n + playerFee(d.quote.platformFee), 0) : playerFee(quote.platformFee);
  const feeRow = (className?: string) =>
    fee > 0 && (
      <div className={[styles.row, className].filter(Boolean).join(' ')}>
        <dt>{t('checkout.platformFee')}</dt>
        <dd>{fmt(fee)}</dd>
      </div>
    );
  const span = (q: QuoteJson) => {
    const first = q.slots[0];
    const last = q.slots[q.slots.length - 1];
    return first && last ? `${formatTime(first.startAt, venue.timezone, lang)}–${formatTime(last.endAt, venue.timezone, lang)}` : '';
  };

  if (multi) {
    const courts = new Set(multi.map((x) => x.turfId ?? turf.id));
    const courtName = (id: string | undefined) => venue.turfs.find((x) => x.id === (id ?? turf.id))?.name ?? '';
    return (
      <section className={styles.summary} aria-label={t('checkout.summary')} aria-busy={busy || undefined}>
        <header className={styles.head}>
          <h2 className={styles.venue}>{venue.name}</h2>
          <p className={styles.meta}>
            {courts.size > 1 ? t('venue.courtCount', { count: courts.size }) : turf.name} · {t('checkout.bookingCount', { count: multi.length })}
          </p>
        </header>

        <ul className={[styles.days, busy ? styles.busy : ''].filter(Boolean).join(' ')}>
          {byDay(multi).map(([key, list]) => (
            <li key={key} className={styles.day}>
              <h3 className={styles.dayTitle}>
                {courts.size > 1 && `${courtName(list[0]!.turfId)} · `}
                {formatDate(list[0]!.date, venue.timezone, lang)}
              </h3>
              <dl className={styles.lines}>
                {list.map((x) => (
                  <div key={x.quote.slots[0]?.startAt} className={styles.row}>
                    <dt>{span(x.quote)}</dt>
                    <dd>{fmt(x.quote.subtotal)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>

        <dl className={[styles.rows, busy ? styles.busy : ''].filter(Boolean).join(' ')}>
          {quote.addons.map((a) => (
            <div key={`${a.addonId}-${a.auto}`} className={styles.row}>
              <dt>
                {addonLabel(a, t)}
                <span className={styles.auto}>{t('checkout.perDay')}</span>
                {a.auto && <span className={styles.auto}>{t('checkout.autoAdded')}</span>}
              </dt>
              <dd>{fmt(multi.reduce((n, d) => n + (d.quote.addons.find((x) => x.addonId === a.addonId && x.auto === a.auto)?.total ?? 0), 0))}</dd>
            </div>
          ))}
          {feeRow(styles.sep)}
          <div className={[styles.row, styles.total, fee > 0 ? '' : styles.sep].filter(Boolean).join(' ')}>
            <dt>{t('checkout.total')}</dt>
            <dd>{fmt(total)}</dd>
          </div>
          {due > 0 && (
            <>
              <div className={styles.row}>
                <dt>{t('checkout.advanceDue')}</dt>
                <dd>{fmt(due)}</dd>
              </div>
              <div className={styles.row}>
                <dt>{t('checkout.payLater')}</dt>
                <dd>{fmt(total - due)}</dd>
              </div>
            </>
          )}
        </dl>
        {due > 0 && paymentMethods && <HowToPay due={due} currency={quote.currency} methods={paymentMethods} />}
        {children && <div className={styles.cta}>{children}</div>}
      </section>
    );
  }

  return (
    <section className={styles.summary} aria-label={t('checkout.summary')} aria-busy={busy || undefined}>
      <header className={styles.head}>
        <h2 className={styles.venue}>{venue.name}</h2>
        <p className={styles.meta}>
          {turf.name} · {formatDate(date, venue.timezone, lang)}
        </p>
      </header>

      <dl className={[styles.rows, busy ? styles.busy : ''].filter(Boolean).join(' ')}>
        {quote.slots.map((s) => (
          <div key={s.startAt} className={styles.row}>
            <dt>
              {formatTime(s.startAt, venue.timezone, lang)}–{formatTime(s.endAt, venue.timezone, lang)}
            </dt>
            <dd>{fmt(s.price)}</dd>
          </div>
        ))}
        {quote.addons.map((a) => (
          <div key={`${a.addonId}-${a.auto}`} className={styles.row}>
            <dt>
              {addonLabel(a, t)}
              {a.auto && <span className={styles.auto}>{t('checkout.autoAdded')}</span>}
            </dt>
            <dd>{fmt(a.total)}</dd>
          </div>
        ))}
        <div className={[styles.row, styles.sep].join(' ')}>
          <dt>{t('checkout.subtotal')}</dt>
          <dd>{fmt(quote.subtotal)}</dd>
        </div>
        <div className={styles.row}>
          <dt>{t('checkout.addonsTotal')}</dt>
          <dd>{fmt(quote.addonsTotal)}</dd>
        </div>
        {feeRow()}
        <div className={[styles.row, styles.total].join(' ')}>
          <dt>{t('checkout.total')}</dt>
          <dd>{fmt(quote.total)}</dd>
        </div>
        {due > 0 && (
          <>
            <div className={styles.row}>
              <dt>{t('checkout.advanceDue')}</dt>
              <dd>{fmt(due)}</dd>
            </div>
            <div className={styles.row}>
              <dt>{t('checkout.payLater')}</dt>
              <dd>{fmt(quote.total - due)}</dd>
            </div>
          </>
        )}
      </dl>
      {due > 0 && paymentMethods && <HowToPay due={due} currency={quote.currency} methods={paymentMethods} />}
      {children && <div className={styles.cta}>{children}</div>}
    </section>
  );
}
