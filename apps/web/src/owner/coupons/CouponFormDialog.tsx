// Not `CouponForm.tsx`: on case-insensitive file systems that name collides with `couponForm.ts`.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { COUPON_TYPES, type CouponJson, type CouponType } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Dialog } from '../../components/ui/Dialog';
import { Select } from '../../components/ui/Select';
import { TextField } from '../../components/ui/TextField';
import { apiPatch, apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { CODE_MAX, couponBody, draftFromCoupon, EMPTY_COUPON_DRAFT, type CouponDraft } from './couponForm';
import styles from './coupons.module.css';

type Props = { open: boolean; coupon: CouponJson | null; onClose(): void; onSaved(): void };

/** Create (coupon null) or edit dialog. The body is mounted only while open so every opening starts from a fresh draft. */
export function CouponForm({ open, coupon, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} title={t(coupon ? 'owner.coupons.formTitleEdit' : 'owner.coupons.formTitleNew')}>
      {open && <CouponFormBody coupon={coupon} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function CouponFormBody({ coupon, onClose, onSaved }: Omit<Props, 'open'>) {
  const { t } = useTranslation();
  const { ownerId, owner, venues } = useOwner();
  const currency = coupon?.currency ?? owner.defaultCurrency;
  const [d, setD] = useState<CouponDraft>(coupon ? draftFromCoupon(coupon) : EMPTY_COUPON_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (patch: Partial<CouponDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const err = (field: string) => (errors[field] ? t(errors[field]) : undefined);
  const toggleVenue = (id: string, on: boolean) =>
    setD((prev) => ({ ...prev, venueIds: on ? [...prev.venueIds, id] : prev.venueIds.filter((v) => v !== id) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const res = couponBody(d, coupon, currency);
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    setErrors({});
    if (coupon && Object.keys(res.body).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      if (coupon) await apiPatch(ownerPath(ownerId, `/coupons/${encodeURIComponent(coupon.id)}`), res.body);
      else await apiPost(ownerPath(ownerId, '/coupons'), res.body);
      onSaved();
      onClose();
    } catch (e2) {
      setError(e2);
    }
    setBusy(false);
  };

  return (
    <form className={styles.body} onSubmit={submit} noValidate>
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      <TextField
        icon="tag"
        label={t('owner.coupons.field.code')}
        className={styles.codeField}
        maxLength={CODE_MAX}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        value={d.code}
        hint={t('owner.coupons.field.codeHint')}
        error={err('code')}
        onChange={(e) => set({ code: e.target.value.toUpperCase() })}
      />
      <div className={styles.pair}>
        <Select
          icon="percent"
          layout="stacked"
          label={t('owner.coupons.field.type')}
          value={d.type}
          options={COUPON_TYPES.map((x) => ({ value: x, label: t(`owner.coupons.type.${x}`) }))}
          onChange={(e) => set({ type: e.target.value as CouponType })}
        />
        <TextField
          icon={d.type === 'percent' ? 'percent' : 'money'}
          label={d.type === 'percent' ? t('owner.coupons.field.percent') : t('owner.coupons.field.amount', { currency })}
          inputMode="decimal"
          value={d.value}
          error={err('value')}
          onChange={(e) => set({ value: e.target.value })}
        />
      </div>
      <div className={styles.pair}>
        {d.type === 'percent' && (
          <TextField
            icon="money"
            label={t('owner.coupons.field.maxDiscount', { currency })}
            inputMode="decimal"
            value={d.maxDiscount}
            hint={t('owner.coupons.field.blankNoCap')}
            error={err('maxDiscount')}
            onChange={(e) => set({ maxDiscount: e.target.value })}
          />
        )}
        <TextField
          icon="money"
          label={t('owner.coupons.field.minSubtotal', { currency })}
          inputMode="decimal"
          value={d.minSubtotal}
          hint={t('owner.coupons.field.blankNoMin')}
          error={err('minSubtotal')}
          onChange={(e) => set({ minSubtotal: e.target.value })}
        />
      </div>
      <div className={styles.pair}>
        <TextField
          label={t('owner.coupons.field.validFrom')}
          type="date"
          value={d.validFrom}
          hint={t('owner.coupons.field.blankAnyDate')}
          onChange={(e) => set({ validFrom: e.target.value })}
        />
        <TextField
          label={t('owner.coupons.field.validUntil')}
          type="date"
          value={d.validUntil}
          min={d.validFrom || undefined}
          hint={t('owner.coupons.field.untilHint')}
          error={err('validUntil')}
          onChange={(e) => set({ validUntil: e.target.value })}
        />
      </div>
      <div className={styles.pair}>
        <TextField
          icon="hash"
          label={t('owner.coupons.field.maxUses')}
          inputMode="numeric"
          value={d.maxUses}
          hint={t('owner.coupons.field.blankUnlimited')}
          error={err('maxUses')}
          onChange={(e) => set({ maxUses: e.target.value })}
        />
        <TextField
          icon="person"
          label={t('owner.coupons.field.maxUsesPerCustomer')}
          inputMode="numeric"
          value={d.maxUsesPerCustomer}
          hint={t('owner.coupons.field.blankUnlimited')}
          error={err('maxUsesPerCustomer')}
          onChange={(e) => set({ maxUsesPerCustomer: e.target.value })}
        />
      </div>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{t('owner.coupons.field.venues')}</legend>
        <Checkbox label={t('owner.coupons.allVenues')} checked={d.allVenues} onChange={(on) => set({ allVenues: on })} />
        {!d.allVenues &&
          venues.map((v) => (
            <Checkbox key={v.id} label={v.name} checked={d.venueIds.includes(v.id)} onChange={(on) => toggleVenue(v.id, on)} />
          ))}
        {errors.venues && <p className={styles.error}>{t(errors.venues)}</p>}
      </fieldset>
      <Checkbox label={t('owner.coupons.field.active')} hint={t('owner.coupons.field.activeHint')} checked={d.active} onChange={(on) => set({ active: on })} />
      <div className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          {t('owner.venues.cancel')}
        </Button>
        <Button icon="check" type="submit" loading={busy}>
          {t('owner.coupons.save')}
        </Button>
      </div>
    </form>
  );
}
