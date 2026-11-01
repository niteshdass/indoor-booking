import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FEE_PAYERS,
  PLATFORM_FEE_MAX_PERCENT,
  PLATFORM_FEE_MODES,
  formatMoney,
  platformFeeFor,
  type AdminSettingsJson,
  type FeePayer,
  type OwnerApprovalMode,
  type PlatformFeeMode,
} from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { Card, serverFields, useSection, type ServerField, type Store } from './shared';
import settings from '../../owner/settings/settings.module.css';
import styles from './GeneralTab.module.css';

const APPROVALS: OwnerApprovalMode[] = ['manual', 'automatic'];
/** The same limit as the API's fixed-fee schema. */
const FIXED_MAX = 1_000_000;
/** The example's court price: ৳1,000 in minor units. */
const EXAMPLE_BASE = 100_000;
const EXAMPLE_CURRENCY = 'BDT';

/** A positive amount with at most 2 decimals, up to `max`; a comma is read as the decimal point. Null when it is not one. */
function parseAmount(text: string, max: number): number | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const n = Number(clean);
  return n > 0 && n <= max ? n : null;
}

type Option<T extends string> = { value: T; label: string; hint?: string };

/** A segmented single choice (radio group) whose options can carry a hint line. */
function Choice<T extends string>({ legend, value, options, onChange }: { legend: string; value: T; options: Option<T>[]; onChange(v: T): void }) {
  const name = useId();
  return (
    <fieldset className={styles.choice}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.options}>
        {options.map((o) => {
          const id = `${name}-${o.value}`;
          return (
            <label key={o.value} className={styles.option}>
              <input
                className={styles.radio}
                type="radio"
                name={name}
                value={o.value}
                checked={o.value === value}
                aria-labelledby={`${id}-label`}
                aria-describedby={o.hint ? `${id}-hint` : undefined}
                onChange={() => onChange(o.value)}
              />
              <span id={`${id}-label`} className={styles.optionLabel}>
                {o.label}
              </span>
              {o.hint && (
                <span id={`${id}-hint`} className={styles.optionHint}>
                  {o.hint}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Admin > Settings > General: venue signup approval and the platform fee. The saved payout wallets go along unchanged. */
export function GeneralTab({ data, store }: { data: AdminSettingsJson; store: Store }) {
  const { t, i18n } = useTranslation();
  const general = data.general;
  const s = useSection('general', store);
  const [approval, setApproval] = useState<OwnerApprovalMode>(general.ownerApproval);
  const [mode, setMode] = useState<PlatformFeeMode>(general.fee.mode);
  const [fixed, setFixed] = useState(general.fee.fixed !== null ? String(general.fee.fixed) : '');
  const [percent, setPercent] = useState(general.fee.percent !== null ? String(general.fee.percent) : '');
  const [payer, setPayer] = useState<FeePayer>(general.fee.payer);
  const [submitted, setSubmitted] = useState(false);
  /** Fields edited since the last save; their server errors no longer apply. */
  const [touched, setTouched] = useState<ReadonlySet<ServerField>>(new Set());

  const fixedValue = parseAmount(fixed, FIXED_MAX);
  const percentValue = parseAmount(percent, PLATFORM_FEE_MAX_PERCENT);
  const badFixed = mode === 'fixed' && fixedValue === null;
  const badPercent = mode === 'percent' && percentValue === null;
  const fromServer = new Set([...serverFields(s.failure)].filter((f) => !touched.has(f)));
  const touch = (f: ServerField) => !touched.has(f) && setTouched(new Set([...touched, f]));
  const g = (key: string, opts?: Record<string, unknown>) => t(`admin.settings.general.${key}`, opts);

  const fee = { mode, fixed: mode === 'fixed' ? fixedValue : null, percent: mode === 'percent' ? percentValue : null, payer };
  const snapshot = mode === 'free' ? null : platformFeeFor(fee, EXAMPLE_BASE, EXAMPLE_CURRENCY);
  const money = (minor: number) => formatMoney(minor, EXAMPLE_CURRENCY, i18n.language);

  const save = () => {
    setSubmitted(true);
    if (badFixed || badPercent) return;
    setTouched(new Set());
    void s.save({ ownerApproval: approval, fee, payout: { bkash: general.payout.bkash, nagad: general.payout.nagad } });
  };

  return (
    <>
      <Card title={g('signup.title')} intro={g('signup.intro')}>
        <Choice<OwnerApprovalMode>
          legend={g('approval.label')}
          value={approval}
          onChange={setApproval}
          options={APPROVALS.map((v) => ({ value: v, label: g(`approval.${v}`), hint: g(`approval.${v}Hint`) }))}
        />
      </Card>

      <Card title={g('fee.title')} intro={g('fee.intro')}>
        <Choice<PlatformFeeMode>
          legend={g('fee.mode')}
          value={mode}
          onChange={setMode}
          options={PLATFORM_FEE_MODES.map((v) => ({ value: v, label: g(`mode.${v}`), hint: g(`mode.${v}Hint`) }))}
        />
        {mode === 'fixed' && (
          <TextField
            icon="money"
            label={g('fee.fixed')}
            hint={g('fee.fixedHint')}
            inputMode="decimal"
            autoComplete="off"
            placeholder="50"
            value={fixed}
            onChange={(e) => {
              setFixed(e.target.value);
              touch('fixed');
            }}
            error={(submitted && badFixed) || fromServer.has('fixed') ? g('errors.fixed') : undefined}
          />
        )}
        {mode === 'percent' && (
          <TextField
            icon="percent"
            label={g('fee.percent')}
            hint={g('fee.percentHint')}
            inputMode="decimal"
            autoComplete="off"
            placeholder="5"
            value={percent}
            onChange={(e) => {
              setPercent(e.target.value);
              touch('percent');
            }}
            error={(submitted && badPercent) || fromServer.has('percent') ? g('errors.percent') : undefined}
          />
        )}
        {mode !== 'free' && (
          <Choice<FeePayer>
            legend={g('fee.payer')}
            value={payer}
            onChange={setPayer}
            options={FEE_PAYERS.map((v) => ({ value: v, label: g(`payer.${v}`), hint: g(`payer.${v}Hint`) }))}
          />
        )}
        {snapshot && (
          <p className={styles.example} aria-live="polite">
            <span className={styles.exampleLabel}>{g('exampleLabel')}</span>{' '}
            {payer === 'player'
              ? g('examplePlayer', { base: money(EXAMPLE_BASE), total: money(EXAMPLE_BASE + snapshot.amount), fee: money(snapshot.amount) })
              : g('exampleOwner', { base: money(EXAMPLE_BASE), fee: money(snapshot.amount) })}
          </p>
        )}
      </Card>

      <div className={`${styles.wide} ${settings.stack}`}>
        {s.error && <Alert tone="danger">{s.error}</Alert>}
        <div className={settings.actions}>
          {s.saved && (
            <p className={`${settings.muted} ${styles.savedNote}`} role="status">
              {t('admin.settings.saved')}
            </p>
          )}
          <Button icon="check" loading={s.busy} onClick={save}>
            {g('save')}
          </Button>
        </div>
      </div>
    </>
  );
}
