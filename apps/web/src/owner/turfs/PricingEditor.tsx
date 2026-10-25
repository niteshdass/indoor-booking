import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Select } from '../../components/ui/Select';
import { TextField } from '../../components/ui/TextField';
import { ApiError, apiPut } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { OwnerTurf, TurfPricing } from '../types';
import { RULE_KINDS, draftFromPricing, pricingFromDraft, type PricingDraft, type RuleDraft } from './pricingForm';
import styles from './turfs.module.css';

type Props = { turf: OwnerTurf; currency: string; onSaved(pricing: TurfPricing): void };

const NEW_RULE: RuleDraft = { kind: 'weekday', date: '', allDay: true, start: '', end: '', price: '' };

/** Base price plus tiered rules; saved as one PUT of the whole object. Read-only without `pricing.edit`. */
export function PricingEditor({ turf, currency, onSaved }: Props) {
  const { t, i18n } = useTranslation();
  const { ownerId, can } = useOwner();
  const editable = can('pricing.edit');
  const [draft, setDraft] = useState<PricingDraft>(() => draftFromPricing(turf.pricing, currency, i18n.language));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const edit = (next: PricingDraft) => {
    setDraft(next);
    setDone(false);
    if (submitted) {
      const res = pricingFromDraft(next, currency);
      setErrors(res.ok ? {} : res.errors);
    }
  };
  const setRule = (i: number, patch: Partial<RuleDraft>) =>
    edit({ ...draft, rules: draft.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !editable) return;
    setSubmitted(true);
    setError(null);
    setDone(false);
    const res = pricingFromDraft(draft, currency);
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const out = await apiPut<{ pricing: TurfPricing }>(
        ownerPath(ownerId, `/venues/${encodeURIComponent(turf.venueId)}/turfs/${encodeURIComponent(turf.id)}/pricing`),
        res.pricing,
      );
      onSaved(out.pricing);
      setDone(true);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  const message = (err: unknown) =>
    err instanceof ApiError && err.code === 'validation_error' && /overlap/i.test(err.message)
      ? t('owner.pricing.overlap')
      : errorMessage(err, t);
  const fieldError = (key: string) => (errors[key] ? t(errors[key]) : undefined);

  return (
    <form className={styles.card} onSubmit={submit} noValidate>
      <h2 className={styles.heading}>{t('owner.pricing.title')}</h2>
      {turf.pricing === null && <Alert tone="warning">{t('owner.pricing.unpriced')}</Alert>}
      {error !== null && <Alert tone="danger">{message(error)}</Alert>}
      {done && <Alert tone="success">{t('owner.pricing.saved')}</Alert>}
      <TextField
        label={t('owner.pricing.base')}
        hint={t('owner.pricing.baseHint', { currency })}
        inputMode="decimal"
        value={draft.base}
        disabled={!editable}
        error={fieldError('base')}
        onChange={(e) => edit({ ...draft, base: e.target.value })}
      />
      <p className={styles.muted}>{t('owner.pricing.priority')}</p>
      {RULE_KINDS.map((kind) => {
        const rows = draft.rules.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === kind);
        if (rows.length === 0) return null;
        return (
          <div key={kind} className={styles.tier}>
            <h3 className={styles.tierTitle}>{t(`owner.pricing.tier.${kind}`)}</h3>
            {rows.map(({ r, i }) => (
              <fieldset key={i} className={styles.rule}>
                <legend className={styles.legend}>{t('owner.pricing.rule', { n: i + 1 })}</legend>
                <div className={styles.ruleFields}>
                  <Select
                    layout="stacked"
                    label={t('owner.pricing.kind')}
                    value={r.kind}
                    disabled={!editable}
                    options={RULE_KINDS.map((k) => ({ value: k, label: t(`owner.pricing.tier.${k}`) }))}
                    onChange={(e) => setRule(i, { kind: e.target.value as RuleDraft['kind'] })}
                  />
                  <TextField
                    label={t('owner.pricing.price')}
                    inputMode="decimal"
                    value={r.price}
                    disabled={!editable}
                    error={fieldError(`rule.${i}.price`)}
                    onChange={(e) => setRule(i, { price: e.target.value })}
                  />
                  {r.kind === 'date' && (
                    <TextField
                      label={t('owner.pricing.date')}
                      type="date"
                      value={r.date}
                      disabled={!editable}
                      error={fieldError(`rule.${i}.date`)}
                      onChange={(e) => setRule(i, { date: e.target.value })}
                    />
                  )}
                </div>
                <Checkbox
                  label={t('owner.pricing.allDay')}
                  checked={r.allDay}
                  disabled={!editable}
                  onChange={(on) => setRule(i, { allDay: on })}
                />
                {!r.allDay && (
                  <div className={styles.ruleFields}>
                    <TextField
                      label={t('owner.pricing.from')}
                      type="time"
                      value={r.start}
                      disabled={!editable}
                      error={fieldError(`rule.${i}.time`)}
                      onChange={(e) => setRule(i, { start: e.target.value })}
                    />
                    <TextField
                      label={t('owner.pricing.to')}
                      type="time"
                      value={r.end}
                      disabled={!editable}
                      hint={r.end !== '' && r.end <= r.start ? t('owner.hours.nextDay') : undefined}
                      onChange={(e) => setRule(i, { end: e.target.value })}
                    />
                  </div>
                )}
                {fieldError(`rule.${i}.range`) && <p className={styles.error}>{fieldError(`rule.${i}.range`)}</p>}
                {editable && (
                  <div>
                    <Button variant="ghost" onClick={() => edit({ ...draft, rules: draft.rules.filter((_, j) => j !== i) })}>
                      {t('owner.pricing.removeRule')}
                    </Button>
                  </div>
                )}
              </fieldset>
            ))}
          </div>
        );
      })}
      {editable && (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => edit({ ...draft, rules: [...draft.rules, { ...NEW_RULE }] })}>
            {t('owner.pricing.addRule')}
          </Button>
          <Button type="submit" loading={busy}>
            {t('owner.pricing.save')}
          </Button>
        </div>
      )}
    </form>
  );
}
