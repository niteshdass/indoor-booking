import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  DEFAULT_OWNER_SETTINGS,
  WEEKDAYS,
  currencyExponent,
  parseMoney,
  type OwnerSettings,
  type PaymentPolicy,
  type RefundRule,
} from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { PaymentMethodsFields } from './PaymentMethodsFields';
import { HoursEditor, weekdayNames } from './HoursEditor';
import { settingsErrors, settingsPatch, type Draft, type SettingsError, type SettingsLevel, type StoredSettings } from './settingsPatch';
import styles from './settings.module.css';

export type { SettingsLevel };

type Props = {
  level: SettingsLevel;
  /** What is stored at this level; absent keys inherit (venue) or use defaults (owner). */
  stored: StoredSettings;
  effective: OwnerSettings;
  /** The level above (the owner's settings); null at owner level. */
  inherited: OwnerSettings | null;
  currency: string;
  onSave(patch: Record<string, unknown>): Promise<void>;
  disabled?: boolean;
  /** The owner's Stripe account is connected and on; the card switch stays off until then. */
  stripeReady?: boolean;
  canConnectStripe?: boolean;
  /** Content for the Stripe tab (outside the form); the tab only shows when given. */
  stripe?: ReactNode;
};

const SECTIONS = ['hours', 'booking', 'payments', 'refunds', 'stripe'] as const;
type SettingsSection = (typeof SECTIONS)[number];

/** The tab that holds the field each validation error belongs to. */
const ERROR_SECTION: Record<SettingsError, SettingsSection> = {
  hours: 'hours',
  window: 'booking',
  autoReject: 'booking',
  percent: 'payments',
  amount: 'payments',
  wallet: 'payments',
  refund: 'refunds',
  duplicate: 'refunds',
};

const MAX_RULES = 10;
const numText = (n: number) => (Number.isFinite(n) ? String(n) : '');
const toNum = (s: string) => (s.trim() === '' ? NaN : Number(s));
const clone = <T,>(v: T): T => structuredClone(v);

function amountText(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

/** One titled card; at venue level it carries the "inherit from owner" switch. */
function Section({
  title,
  inheritable,
  inheriting,
  onInherit,
  disabled,
  children,
}: {
  title: string;
  inheritable: boolean;
  inheriting: boolean;
  onInherit(on: boolean): void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section className={styles.card} aria-labelledby={id}>
      <h2 id={id} className={styles.heading}>
        {title}
      </h2>
      {inheritable && <Checkbox label={t('owner.settings.inherit')} checked={inheriting} disabled={disabled} onChange={onInherit} />}
      {children}
    </section>
  );
}

/** Owner- or venue-level settings editor; Task 13 mounts it with `level="venue"`. */
export function SettingsForm({ level, stored, effective, inherited, currency, onSave, disabled, stripeReady = false, canConnectStripe = true, stripe }: Props) {
  const { t, i18n } = useTranslation();
  const venue = level === 'venue';
  const sections = SECTIONS.filter((x) => x !== 'stripe' || stripe !== undefined);
  // `section`, not `tab`: the venue editor already keeps its own tab in `tab`.
  const [params, setParams] = useSearchParams();
  const requested = params.get('section');
  const tab: SettingsSection = sections.find((x) => x === requested) ?? 'hours';
  const setTab = (id: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === 'hours') next.delete('section');
        else next.set('section', id);
        return next;
      },
      { replace: true },
    );
  const [base, setBase] = useState<StoredSettings>(() => clone(venue ? stored : effective));
  const [draft, setDraft] = useState<Draft>(() => clone(venue ? stored : effective));
  const [amount, setAmount] = useState(() => {
    const p = (venue ? stored : effective).paymentPolicy;
    return p?.type === 'partial_fixed' ? amountText(p.amount, currency) : '';
  });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const errors = settingsErrors(draft);
  const names = weekdayNames(i18n.language);
  const short = weekdayNames(i18n.language, 'short');
  const from = inherited ?? effective;
  const edit = (next: Draft) => {
    setDone(false);
    setDraft(next);
  };
  const inheriting = (k: keyof OwnerSettings) => venue && draft[k] === undefined;
  const toggle = (k: keyof OwnerSettings) => (on: boolean) => {
    const next = { ...draft };
    if (on) delete next[k];
    else (next as Record<string, unknown>)[k] = k === 'hours' ? {} : clone(from[k]);
    if (k === 'paymentPolicy') {
      const p = next.paymentPolicy;
      setAmount(p?.type === 'partial_fixed' ? amountText(p.amount, currency) : '');
    }
    edit(next);
  };
  const locked = (k: keyof OwnerSettings) => disabled || inheriting(k);
  // Shown value: the draft's, or what is inherited while the section inherits.
  const value = <K extends keyof OwnerSettings>(k: K): OwnerSettings[K] => (draft[k] ?? from[k]) as OwnerSettings[K];
  const section = (k: keyof OwnerSettings, title: string, children: ReactNode) => (
    <Section title={title} inheritable={venue} inheriting={inheriting(k)} onInherit={toggle(k)} disabled={disabled}>
      {children}
    </Section>
  );

  const policy = value('paymentPolicy');
  const setPolicyType = (type: PaymentPolicy['type']) => {
    let next: PaymentPolicy;
    if (type === 'partial_percent') next = { type, percent: 50 };
    else if (type === 'partial_fixed') next = { type, amount: 0 };
    else next = { type };
    setAmount('');
    edit({ ...draft, paymentPolicy: next });
  };
  const setAmountText = (text: string) => {
    setAmount(text);
    let minor = 0;
    try {
      minor = parseMoney(text.trim(), currency);
    } catch {
      /* stays 0, which is flagged */
    }
    edit({ ...draft, paymentPolicy: { type: 'partial_fixed', amount: minor } });
  };

  const rules = value('refundRules');
  const setRules = (next: RefundRule[]) => edit({ ...draft, refundRules: next });
  const setRule = (i: number, patch: Partial<RefundRule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRule = () => {
    const used = new Set(rules.map((r) => r.minHoursBefore));
    let hours = 0;
    while (used.has(hours)) hours += 1;
    setRules([...rules, { minHoursBefore: hours, percent: 100 }]);
  };
  const dup = (i: number) => rules.some((r, j) => j !== i && r.minHoursBefore === rules[i]!.minHoursBefore);

  const methods = value('paymentMethods') ?? DEFAULT_OWNER_SETTINGS.paymentMethods;
  const noMethod = error instanceof ApiError && error.code === 'no_payment_method';
  const walletsBad = submitted && errors.has('wallet');

  const guest = value('guestBooking');
  const weekend = value('weekendDays');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (busy) return;
    if (errors.size > 0) {
      // Save covers every tab: show the first one with a problem unless this one has one.
      const bad = [...errors].map((k) => ERROR_SECTION[k]);
      if (!bad.includes(tab)) setTab(sections.find((x) => bad.includes(x)) ?? tab);
      return;
    }
    const patch = settingsPatch(level, base, draft);
    if (Object.keys(patch).length === 0) {
      setDone(true);
      return;
    }
    setBusy(true);
    try {
      await onSave(patch);
      setBase(clone(draft));
      setDone(true);
    } catch (err) {
      setError(err);
      if (err instanceof ApiError && err.code === 'no_payment_method') setTab('payments');
    }
    setBusy(false);
  };

  const showErr = (k: Parameters<typeof errors.has>[0], key: string) => (submitted && errors.has(k) ? t(key) : undefined);
  const hoursInherited = inheriting('hours');

  const hoursPanel = (
    <>
      {section(
        'hours',
        t('owner.settings.hoursTitle'),
        <>
          <HoursEditor
            value={hoursInherited ? {} : (draft.hours ?? {})}
            inherited={venue ? from.hours : undefined}
            disabled={locked('hours')}
            onChange={(h) => edit({ ...draft, hours: h })}
          />
          {hoursInherited && <p className={styles.muted}>{t('owner.settings.hoursInheriting')}</p>}
          {submitted && errors.has('hours') && <p className={styles.error}>{t('owner.settings.errors.hours')}</p>}
        </>,
      )}

      {section(
        'weekendDays',
        t('owner.settings.weekendTitle'),
        <>
          <p className={styles.muted}>{t('owner.settings.weekendHint')}</p>
          <div className={styles.chips} role="group" aria-label={t('owner.settings.weekendTitle')}>
            {WEEKDAYS.map((d) => {
              const on = weekend.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={styles.chip}
                  aria-pressed={on}
                  aria-label={names[d]}
                  title={names[d]}
                  disabled={locked('weekendDays')}
                  onClick={() => edit({ ...draft, weekendDays: WEEKDAYS.filter((x) => (x === d ? !on : weekend.includes(x))) })}
                >
                  {short[d]}
                </button>
              );
            })}
          </div>
        </>,
      )}
    </>
  );

  const bookingPanel = (
    <>
      {section(
        'bookingWindowDays',
        t('owner.settings.windowTitle'),
        <TextField
          icon="duration"
          label={t('owner.settings.bookingWindow')}
          hint={t('owner.settings.windowHint')}
          type="number"
          min={1}
          max={365}
          value={numText(value('bookingWindowDays'))}
          disabled={locked('bookingWindowDays')}
          error={showErr('window', 'owner.settings.errors.window')}
          onChange={(e) => edit({ ...draft, bookingWindowDays: toNum(e.target.value) })}
        />,
      )}

      {!venue && (
        <Section title={t('owner.settings.autoRejectTitle')} inheritable={false} inheriting={false} onInherit={() => {}}>
          <TextField
            icon="duration"
            label={t('owner.settings.autoReject')}
            hint={t('owner.settings.autoRejectHint')}
            type="number"
            min={0}
            max={72}
            value={numText(value('pendingAutoRejectHours'))}
            disabled={disabled}
            error={showErr('autoReject', 'owner.settings.errors.autoReject')}
            onChange={(e) => edit({ ...draft, pendingAutoRejectHours: toNum(e.target.value) })}
          />
        </Section>
      )}

      {section(
        'guestBooking',
        t('owner.settings.guestTitle'),
        <div className={styles.checkList}>
          <Checkbox
            label={t('owner.settings.guestAllowed')}
            checked={guest.allowed}
            disabled={locked('guestBooking')}
            onChange={(allowed) => edit({ ...draft, guestBooking: { ...guest, allowed } })}
          />
          <Checkbox
            label={t('owner.settings.guestOtp')}
            checked={guest.requireOtp}
            disabled={locked('guestBooking')}
            onChange={(requireOtp) => edit({ ...draft, guestBooking: { ...guest, requireOtp } })}
          />
        </div>,
      )}
    </>
  );

  const paymentsPanel = (
    <>
      {section(
        'paymentPolicy',
        t('owner.settings.paymentTitle'),
        <>
          <div className={styles.grid}>
            <Select
              icon="wallet"
              layout="stacked"
              label={t('owner.settings.paymentType')}
              value={policy.type}
              disabled={locked('paymentPolicy')}
              options={(['none', 'full', 'partial_percent', ...(venue ? ['partial_fixed'] : [])] as PaymentPolicy['type'][]).map((v) => ({
                value: v,
                label: t(`owner.settings.payment.${v}`),
              }))}
              onChange={(e) => setPolicyType(e.target.value as PaymentPolicy['type'])}
            />
            {policy.type === 'partial_percent' && (
              <TextField
                icon="percent"
                label={t('owner.settings.percent')}
                type="number"
                inputMode="decimal"
                min={1}
                max={99}
                step="any"
                value={numText(policy.percent)}
                disabled={locked('paymentPolicy')}
                error={showErr('percent', 'owner.settings.errors.percent')}
                onChange={(e) => edit({ ...draft, paymentPolicy: { type: 'partial_percent', percent: toNum(e.target.value) } })}
              />
            )}
            {policy.type === 'partial_fixed' && (
              <TextField
                icon="money"
                label={t('owner.settings.amount', { currency })}
                inputMode="decimal"
                value={inheriting('paymentPolicy') ? amountText(policy.amount, currency) : amount}
                disabled={locked('paymentPolicy')}
                error={showErr('amount', 'owner.settings.errors.amount')}
                onChange={(e) => setAmountText(e.target.value)}
              />
            )}
          </div>
          <p className={styles.muted}>{t('owner.settings.paymentNote')}</p>
        </>,
      )}

      {section(
        'paymentMethods',
        t('owner.settings.methods.title'),
        <>
          <p className={styles.muted}>{t('owner.settings.methods.hint')}</p>
          <PaymentMethodsFields
            value={methods}
            disabled={locked('paymentMethods')}
            stripeReady={stripeReady}
            canConnectStripe={canConnectStripe}
            onChange={(v) => edit({ ...draft, paymentMethods: v })}
          />
          {walletsBad && <p className={styles.error}>{t('owner.settings.errors.wallet')}</p>}
          {noMethod && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
        </>,
      )}
    </>
  );

  const refundsPanel = section(
        'refundRules',
        t('owner.settings.refundTitle'),
        <>
          <p className={styles.muted}>{rules.length === 0 ? t('owner.settings.refundNone') : t('owner.settings.refundHint')}</p>
          {rules.map((r, i) => (
            <div key={i} className={styles.ruleRow}>
              <TextField
                icon="duration"
                label={t('owner.settings.refundHours')}
                type="number"
                min={0}
                max={8760}
                value={numText(r.minHoursBefore)}
                disabled={locked('refundRules')}
                error={dup(i) ? t('owner.settings.duplicate') : undefined}
                onChange={(e) => setRule(i, { minHoursBefore: toNum(e.target.value) })}
              />
              <TextField
                icon="percent"
                label={t('owner.settings.refundPercent')}
                type="number"
                min={0}
                max={100}
                step="any"
                value={numText(r.percent)}
                disabled={locked('refundRules')}
                onChange={(e) => setRule(i, { percent: toNum(e.target.value) })}
              />
              {!locked('refundRules') && (
                <Button variant="secondary" icon="trash" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                  {t('owner.settings.removeRule', { n: i + 1 })}
                </Button>
              )}
            </div>
          ))}
          {submitted && errors.has('refund') && <p className={styles.error}>{t('owner.settings.errors.refund')}</p>}
          {!locked('refundRules') && rules.length < MAX_RULES && (
            <div>
              <Button variant="secondary" icon="plus" onClick={addRule}>
                {t('owner.settings.addRule')}
              </Button>
            </div>
          )}
        </>,
  );

  const panels: Record<Exclude<SettingsSection, 'stripe'>, ReactNode> = {
    hours: hoursPanel,
    booking: bookingPanel,
    payments: paymentsPanel,
    refunds: refundsPanel,
  };

  return (
    <div className={styles.page}>
      <Tabs
        label={t('owner.settings.sections')}
        tabs={sections.map((id) => ({ id, label: t(`owner.settings.tab.${id}`) }))}
        value={tab}
        onChange={setTab}
      />
      {tab === 'stripe' ? (
        <div role="tabpanel" aria-label={t('owner.settings.tab.stripe')}>
          {stripe}
        </div>
      ) : (
        <form className={styles.stack} onSubmit={submit} noValidate>
          {error !== null && !noMethod && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
          {done && <Alert tone="success">{t('owner.settings.saved')}</Alert>}

          <div role="tabpanel" aria-label={t(`owner.settings.tab.${tab}`)} className={tab === 'refunds' ? styles.stack : styles.layout}>
            {panels[tab]}
          </div>

          {!disabled && (
            <div>
              <Button icon="check" type="submit" loading={busy}>
                {t('owner.settings.save')}
              </Button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
