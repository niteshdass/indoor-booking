// Not `AddonForm.tsx`: on case-insensitive file systems that name collides with `addonForm.ts`.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ADDON_PRICING_TYPES, type AddonPricingType } from '@booking/shared';
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
import type { Addon } from '../types';
import { addonBody, draftFromAddon, EMPTY_ADDON_DRAFT, NAME_MAX, type AddonDraft } from './addonForm';
import styles from './addons.module.css';

type Props = { open: boolean; addon: Addon | null; onClose(): void; onSaved(): void };

/** Create (addon null) or edit dialog. The body is mounted only while open so every opening starts from a fresh draft. */
export function AddonForm({ open, addon, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} title={t(addon ? 'owner.addons.formTitleEdit' : 'owner.addons.formTitleNew')}>
      {open && <AddonFormBody addon={addon} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function AddonFormBody({ addon, onClose, onSaved }: Omit<Props, 'open'>) {
  const { t } = useTranslation();
  const { ownerId, owner } = useOwner();
  const currency = addon?.currency ?? owner.defaultCurrency;
  const [d, setD] = useState<AddonDraft>(addon ? draftFromAddon(addon) : EMPTY_ADDON_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (patch: Partial<AddonDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const err = (field: string) => (errors[field] ? t(errors[field]) : undefined);
  const nextDay = d.autoApply && !d.autoAllDay && d.autoStart !== '' && d.autoEnd !== '' && d.autoEnd <= d.autoStart;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const res = addonBody(d, addon, currency);
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    setErrors({});
    if (addon && Object.keys(res.body).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      if (addon) await apiPatch(ownerPath(ownerId, `/addons/${encodeURIComponent(addon.id)}`), res.body);
      else await apiPost(ownerPath(ownerId, '/addons'), res.body);
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
      <TextField icon="tag" label={t('owner.addons.field.name')} maxLength={NAME_MAX} value={d.name} error={err('name')} onChange={(e) => set({ name: e.target.value })} />
      <Select
        icon="tag"
        layout="stacked"
        label={t('owner.addons.field.type')}
        value={d.pricingType}
        options={ADDON_PRICING_TYPES.map((x) => ({ value: x, label: t(`owner.addons.type.${x}`) }))}
        onChange={(e) => set({ pricingType: e.target.value as AddonPricingType })}
      />
      <div className={styles.pair}>
        <TextField
          icon="money"
          label={t('owner.addons.field.price', { currency })}
          inputMode="decimal"
          value={d.price}
          error={err('price')}
          onChange={(e) => set({ price: e.target.value })}
        />
        <TextField
          icon="box"
          label={t('owner.addons.field.maxQuantity')}
          inputMode="numeric"
          value={d.maxQuantity}
          error={err('maxQuantity')}
          onChange={(e) => set({ maxQuantity: e.target.value })}
        />
      </div>
      <TextField
        icon="box"
        label={t('owner.addons.field.stock')}
        inputMode="numeric"
        value={d.stock}
        hint={t('owner.addons.field.stockHint')}
        error={err('stock')}
        onChange={(e) => set({ stock: e.target.value })}
      />
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{t('owner.addons.autoTitle')}</legend>
        <Checkbox label={t('owner.addons.autoApply')} hint={t('owner.addons.autoHint')} checked={d.autoApply} onChange={(on) => set({ autoApply: on })} />
        {errors.autoApply && <p className={styles.error}>{t(errors.autoApply)}</p>}
        {d.autoApply && (
          <>
            <Checkbox label={t('owner.addons.autoAllDay')} checked={d.autoAllDay} onChange={(on) => set({ autoAllDay: on })} />
            {!d.autoAllDay && (
              <div className={styles.pair}>
                <TextField label={t('owner.addons.autoStart')} type="time" value={d.autoStart} error={err('autoRange')} onChange={(e) => set({ autoStart: e.target.value })} />
                <TextField
                  label={t('owner.addons.autoEnd')}
                  type="time"
                  value={d.autoEnd}
                  hint={nextDay ? t('owner.addons.nextDay') : undefined}
                  onChange={(e) => set({ autoEnd: e.target.value })}
                />
              </div>
            )}
            <Checkbox label={t('owner.addons.outdoorOnly')} checked={d.outdoorOnly} onChange={(on) => set({ outdoorOnly: on })} />
          </>
        )}
      </fieldset>
      <div className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          {t('owner.venues.cancel')}
        </Button>
        <Button icon="check" type="submit" loading={busy}>
          {t('owner.addons.save')}
        </Button>
      </div>
    </form>
  );
}
