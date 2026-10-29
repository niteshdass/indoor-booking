import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SPORTS, type Sport } from '@booking/shared';
import { Button } from '../components/ui/Button';
import { moneyShort } from '../lib/format';
import { EMPTY_CRITERIA, criteriaToParams } from '../search/searchParams';
import { SportCourt, TILE_SPORTS } from './SportCourt';
import styles from './LandingPage.module.css';

/** Demo prices in BDT minor units, formatted in the reader's language. */
const DEMO_SLOTS = [
  { time: '17:00', price: null },
  { time: '18:00', price: 120000 },
  { time: '19:00', price: 150000, pick: true },
  { time: '20:00', price: null },
  { time: '21:00', price: 150000 },
  { time: '22:00', price: 110000 },
];

/** Sets `data-inview` once the element scrolls into view, so its CSS entrance plays then rather than off screen. */
function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView] as const;
}

function Check() {
  return (
    <svg className={styles.checkIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

const FEATURE_ICONS: Record<string, string> = {
  weekly:
    'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 2v4M8 2v4M3 10h18M8 15h2M14 15h2',
  map: 'M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  lookup: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  reviews: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
};

function HeroSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const id = useId();
  const [sport, setSport] = useState<Sport | ''>('');
  const [date, setDate] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = criteriaToParams({
      ...EMPTY_CRITERIA,
      sport: sport || null,
      date: date || null,
      available: true,
    });
    navigate(`/search?${p.toString()}`);
  }

  return (
    <form className={styles.search} onSubmit={submit} aria-label={t('landing.searchLabel')}>
      <div className={styles.field}>
        <label htmlFor={`${id}-sport`}>{t('search.sport')}</label>
        <span className={styles.selectWrap}>
          <select
            id={`${id}-sport`}
            value={sport}
            onChange={(e) => setSport(e.target.value as Sport | '')}
          >
            <option value="">{t('search.anySport')}</option>
            {SPORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sports.${s}`)}
              </option>
            ))}
          </select>
          <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-date`}>{t('search.date')}</label>
        <input
          id={`${id}-date`}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <Button type="submit" size="lg" className={styles.searchButton}>
        {t('landing.submit')}
      </Button>
    </form>
  );
}

const DEMO_STEPS = ['find', 'pick', 'book', 'done'] as const;
type DemoStep = (typeof DEMO_STEPS)[number];

/** How long each step of the demo holds, in ms, before the next one plays. */
const STEP_MS: Record<DemoStep, number> = { find: 2800, pick: 2200, book: 1900, done: 2800 };

/** The card rises in after the court lines draw; the first step waits for it. */
const FIRST_LEAD_MS = 1000;

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Loops the booking story (find, pick, book, done) while the panel is on screen.
 * With reduced motion it holds on the finished booking.
 */
function useDemoStep() {
  const ref = useRef<HTMLDivElement>(null);
  const [still] = useState(prefersReducedMotion);
  const [running, setRunning] = useState(false);
  const [lap, setLap] = useState(0);
  const [index, setIndex] = useState(still ? DEMO_STEPS.length - 1 : 0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setRunning(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setRunning(!!entry?.isIntersecting), {
      threshold: 0.3,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (still || !running) return;
    const step = DEMO_STEPS[index]!;
    const hold = STEP_MS[step] + (lap === 0 && index === 0 ? FIRST_LEAD_MS : 0);
    const id = window.setTimeout(() => {
      if (index === DEMO_STEPS.length - 1) setLap((l) => l + 1);
      setIndex((i) => (i + 1) % DEMO_STEPS.length);
    }, hold);
    return () => window.clearTimeout(id);
  }, [still, running, index, lap]);

  return { ref, index, step: DEMO_STEPS[index]!, first: lap === 0 && !still };
}

function SearchGlyph() {
  return (
    <svg className={styles.demoIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" />
    </svg>
  );
}

function CourtDemo() {
  const { t, i18n } = useTranslation();
  const { ref, index, step, first } = useDemoStep();
  const pick = DEMO_SLOTS.find((s) => s.pick)!;
  const price = moneyShort(pick.price!, 'BDT', i18n.language);
  const scene = (s: DemoStep) => ({
    className: styles.scene,
    'data-scene': s,
    'data-active': step === s || undefined,
  });

  return (
    <div ref={ref} className={styles.panel} role="img" aria-label={t('landing.demo.label')}>
      <div className={styles.court} />
      <svg
        className={styles.lines}
        viewBox="0 0 200 260"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="1" y="1" width="198" height="258" />
        <line x1="1" y1="130" x2="199" y2="130" />
        <line x1="1" y1="58" x2="199" y2="58" />
        <line x1="1" y1="202" x2="199" y2="202" />
        <line x1="100" y1="58" x2="100" y2="202" />
      </svg>
      <span className={styles.rally} aria-hidden="true">
        <span className={styles.ball} />
      </span>
      <div className={styles.slotCard} data-first={first || undefined} aria-hidden="true">
        <ol className={styles.demoSteps}>
          {DEMO_STEPS.map((s, i) => {
            const done = i < index || step === 'done';
            return (
              <li
                key={s}
                className={styles.demoStep}
                data-state={done ? 'done' : i === index ? 'now' : undefined}
              >
                <span className={styles.stepDot}>{done ? <Check /> : i + 1}</span>
                {t(`landing.demo.steps.${s}`)}
              </li>
            );
          })}
        </ol>

        <div className={styles.stage}>
          <div {...scene('find')}>
            <div className={styles.fakeSearch}>
              <span className={styles.fakeField}>
                <small>{t('search.sport')}</small>
                <span className={styles.typed}>{t('sports.padel')}</span>
              </span>
              <span className={styles.fakeField}>
                <small>{t('search.date')}</small>
                <span className={`${styles.typed} ${styles.typedLate}`}>
                  {t('landing.demo.today')}
                </span>
              </span>
              <span className={`${styles.fakeGo} ${styles.tap}`}>
                <SearchGlyph />
              </span>
            </div>
            <div className={styles.result}>
              <span>
                <strong>{t('landing.demo.court')}</strong>
                <small>{t('landing.demo.venue')}</small>
              </span>
              <span className={styles.free}>{t('landing.demo.free')}</span>
            </div>
          </div>

          <div {...scene('pick')}>
            <div className={styles.slotHead}>
              <strong>{t('landing.demo.court')}</strong>
              <span>{t('landing.demo.venue')}</span>
            </div>
            <div className={styles.slots}>
              {DEMO_SLOTS.map((s) => (
                <span
                  key={s.time}
                  className={[
                    styles.slot,
                    s.price === null && styles.booked,
                    s.pick && `${styles.pick} ${styles.tap}`,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {s.time}
                  <small>
                    {s.price === null
                      ? t('landing.demo.booked')
                      : moneyShort(s.price, 'BDT', i18n.language)}
                  </small>
                </span>
              ))}
            </div>
          </div>

          <div {...scene('book')}>
            <dl className={styles.summary}>
              <div>
                <dt>{t('landing.demo.court')}</dt>
                <dd>{t('landing.demo.venue')}</dd>
              </div>
              <div>
                <dt>{t('landing.demo.when', { time: pick.time })}</dt>
                <dd className={styles.summaryPrice}>{price}</dd>
              </div>
            </dl>
            <span className={`${styles.fakeBook} ${styles.tap}`}>
              {t('landing.demo.book', { time: pick.time })}
            </span>
          </div>

          <div {...scene('done')}>
            <div className={styles.done}>
              <span className={styles.doneMark}>
                <Check />
              </span>
              <strong>{t('landing.demo.confirm')}</strong>
              <small>
                {t('landing.demo.court')}, {t('landing.demo.venue')}
              </small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type Block = { left: number; width: number; kind: 'ok' | 'wait' | 'walk'; label: string };

function PortalPreview() {
  const { t, i18n } = useTranslation();
  const [ref, inView] = useInView<HTMLDivElement>();
  const lanes: { court: string; blocks: Block[] }[] = [
    {
      court: `${t('sports.padel')} 1`,
      blocks: [
        { left: 4, width: 18, kind: 'ok', label: 'Ivanov' },
        { left: 30, width: 22, kind: 'ok', label: 'Team Orbit' },
        { left: 62, width: 14, kind: 'walk', label: t('landing.owners.walkIn') },
      ],
    },
    {
      court: `${t('sports.padel')} 2`,
      blocks: [
        { left: 12, width: 26, kind: 'ok', label: t('landing.owners.weekly') },
        { left: 56, width: 18, kind: 'wait', label: t('landing.owners.awaiting') },
      ],
    },
    {
      court: t('sports.futsal'),
      blocks: [
        { left: 0, width: 34, kind: 'ok', label: 'FC Sever' },
        { left: 66, width: 30, kind: 'ok', label: 'Petrova' },
      ],
    },
    {
      court: t('sports.tennis'),
      blocks: [
        { left: 20, width: 16, kind: 'walk', label: t('landing.owners.coach') },
        { left: 44, width: 20, kind: 'ok', label: 'Smirnov' },
      ],
    },
  ];
  return (
    <div
      ref={ref}
      className={styles.preview}
      data-inview={inView || undefined}
      role="img"
      aria-label={t('landing.owners.previewLabel')}
    >
      <div className={styles.previewTop} aria-hidden="true">
        <div>
          <strong>{t('landing.owners.previewTitle')}</strong>
          <span>{t('landing.owners.previewDate')}</span>
        </div>
        <span className={styles.openPill}>{t('landing.owners.previewOpen')}</span>
      </div>
      <div className={styles.kpis} aria-hidden="true">
        <div className={styles.kpi}>
          <span>{t('landing.owners.kpiBookings')}</span>
          <b>38</b>
        </div>
        <div className={styles.kpi}>
          <span>{t('landing.owners.kpiRevenue')}</span>
          <b>{moneyShort(4860000, 'BDT', i18n.language)}</b>
        </div>
        <div className={styles.kpi}>
          <span>{t('landing.owners.kpiUsed')}</span>
          <b>72%</b>
        </div>
      </div>
      <div className={styles.timeline} aria-hidden="true">
        {lanes.map((lane, li) => (
          <div key={lane.court} className={styles.lane}>
            <span className={styles.laneName}>{lane.court}</span>
            <div className={styles.track}>
              {lane.blocks.map((b, bi) => (
                <span
                  key={b.left}
                  className={`${styles.blk} ${styles[b.kind]}`}
                  style={
                    { left: `${b.left}%`, width: `${b.width}%`, '--i': li + bi } as CSSProperties
                  }
                >
                  {b.label}
                </span>
              ))}
              <span className={styles.now} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LandingPage() {
  const { t } = useTranslation();
  const steps = ['pick', 'pay', 'play'] as const;
  const features = ['weekly', 'map', 'lookup', 'reviews'] as const;
  const points = ['point1', 'point2', 'point3', 'point4'] as const;
  const faq = ['account', 'cancel', 'find', 'lang'] as const;

  return (
    <>
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={`${styles.wrap} ${styles.heroGrid}`}>
            <div>
              <h1 className={styles.heroTitle}>{t('landing.title')}</h1>
              <p className={styles.lede}>{t('landing.lede')}</p>
              <HeroSearch />
              <p className={styles.note}>{t('landing.note')}</p>
            </div>
            <div className={styles.stack}>
              <span className={`${styles.backCourt} ${styles.clay}`} aria-hidden="true" />
              <span className={`${styles.backCourt} ${styles.wood}`} aria-hidden="true" />
              <CourtDemo />
            </div>
          </div>
        </section>

        <section className={`${styles.block} ${styles.flushTop}`} aria-labelledby="landing-sports">
          <div className={styles.wrap}>
            <div className={styles.sectionHead}>
              <h2 id="landing-sports">{t('landing.sports.title')}</h2>
              <p>{t('landing.sports.lede')}</p>
            </div>
            <ul className={styles.sports}>
              {TILE_SPORTS.map((s) => (
                <li key={s}>
                  <Link className={styles.sport} to={`/search?sport=${s}&available=true`}>
                    <SportCourt sport={s} />
                    <span>
                      <strong>{t(`sports.${s}`)}</strong>
                      <span>{t('landing.sports.cta')}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={`${styles.block} ${styles.band}`} aria-labelledby="landing-steps">
          <div className={styles.wrap}>
            <div className={styles.sectionHead}>
              <h2 id="landing-steps">{t('landing.steps.title')}</h2>
            </div>
            <ol className={styles.steps}>
              {steps.map((k) => (
                <li key={k}>
                  <h3>{t(`landing.steps.${k}`)}</h3>
                  <p>{t(`landing.steps.${k}Text`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.block} aria-labelledby="landing-features">
          <div className={styles.wrap}>
            <div className={styles.sectionHead}>
              <h2 id="landing-features">{t('landing.features.title')}</h2>
            </div>
            <div className={styles.features}>
              {features.map((k) => (
                <div key={k} className={styles.feature}>
                  <span className={styles.featureIcon}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d={FEATURE_ICONS[k]} />
                    </svg>
                  </span>
                  <div>
                    <h3>{t(`landing.features.${k}`)}</h3>
                    <p>{t(`landing.features.${k}Text`)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          className={`${styles.block} ${styles.owners}`}
          data-surface="night"
          aria-labelledby="landing-owners"
        >
          <div className={`${styles.wrap} ${styles.ownersGrid}`}>
            <div>
              <div className={styles.sectionHead}>
                <h2 id="landing-owners">{t('landing.owners.title')}</h2>
                <p>{t('landing.owners.lede')}</p>
              </div>
              <ul className={styles.checks}>
                {points.map((k) => (
                  <li key={k}>
                    <Check />
                    {t(`landing.owners.${k}`)}
                  </li>
                ))}
              </ul>
              <div className={styles.ownerCta}>
                <Button to="/list-your-venue" variant="ball" size="lg">
                  {t('landing.owners.cta')}
                </Button>
              </div>
            </div>
            <PortalPreview />
          </div>
        </section>

        <section className={styles.block} aria-labelledby="landing-faq">
          <div className={styles.wrap}>
            <div className={styles.sectionHead}>
              <h2 id="landing-faq">{t('landing.faq.title')}</h2>
            </div>
            <div className={styles.faq}>
              {faq.map((k, i) => (
                <details key={k} open={i === 0}>
                  <summary>{t(`landing.faq.${k}Q`)}</summary>
                  <p>{t(`landing.faq.${k}A`)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.closing}>
          <div className={styles.wrap}>
            <div className={styles.closingBand}>
              <h2>{t('landing.band.title')}</h2>
              <Button to="/search?available=true" variant="ball" size="lg">
                {t('landing.band.cta')}
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.wrap}>
          <div className={styles.footerCols}>
            <p className={styles.footerBrand}>{t('app.name')}</p>
            <nav aria-labelledby="landing-footer-players">
              <h2 id="landing-footer-players">{t('landing.footer.players')}</h2>
              <ul>
                <li>
                  <Link to="/search">{t('nav.findCourt')}</Link>
                </li>
                <li>
                  <Link to="/me/bookings">{t('nav.myBookings')}</Link>
                </li>
              </ul>
            </nav>
            <nav aria-labelledby="landing-footer-venues">
              <h2 id="landing-footer-venues">{t('landing.footer.venues')}</h2>
              <ul>
                <li>
                  <Link to="/list-your-venue">{t('landing.footer.list')}</Link>
                </li>
                <li>
                  <Link to="/owner">{t('landing.footer.portal')}</Link>
                </li>
              </ul>
            </nav>
          </div>
          <p className={styles.legal}>
            {t('landing.footer.rights', { year: new Date().getFullYear() })}
          </p>
        </div>
      </footer>
    </>
  );
}
