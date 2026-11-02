import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localParts } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button, type ButtonProps } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Select } from '../../components/ui/Select';
import { TextField } from '../../components/ui/TextField';
import { apiDownload, saveDownload } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { EXPORT_KINDS, EXPORT_MAX_DAYS, exportPath, initialRange, rangeErrors, type ExportKind, type ExportRange } from './exportRange';
import styles from './ExportCsv.module.css';

export type ExportPreset = {
  /** The page's venue, preselected; null starts on All venues. */
  venueId: string | null;
  kind?: ExportKind;
  /** The page's own date range, when it has one. */
  from?: string | null;
  to?: string | null;
  /** Length of the default range ending today, when the page has no range. */
  days?: number;
};

/** "Export CSV" for a page header: shown only with `reports.view`, opens the export dialog prefilled from the page. */
export function ExportCsvButton({ size = 'md', ...preset }: ExportPreset & { size?: ButtonProps['size'] }) {
  const { t } = useTranslation();
  const { can } = useOwner();
  const [open, setOpen] = useState(false);
  if (!can('reports.view')) return null;
  return (
    <>
      <Button variant="secondary" size={size} icon="download" onClick={() => setOpen(true)}>
        {t('owner.export.button')}
      </Button>
      <ExportCsvDialog open={open} preset={preset} onClose={() => setOpen(false)} />
    </>
  );
}

/** Picks bookings or payments, a venue-local date range and a venue, then downloads the CSV. */
export function ExportCsvDialog({ open, preset, onClose }: { open: boolean; preset: ExportPreset; onClose: () => void }) {
  const { t } = useTranslation();
  const { ownerId, venues } = useOwner();
  const id = useId();
  const [kind, setKind] = useState<ExportKind>('bookings');
  const [venueId, setVenueId] = useState<string | null>(null);
  const [range, setRange] = useState<ExportRange>({ from: '', to: '' });
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!open) return;
    // "Today" is the preset venue's (all venues: the first one's), as the pages count it.
    const zone = (venues.find((v) => v.id === preset.venueId) ?? venues[0])?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    setKind(preset.kind ?? 'bookings');
    setVenueId(preset.venueId);
    setRange(initialRange(localParts(new Date(), zone).date, preset));
    setChecked(false);
    setError(null);
    // Reset on each open only.
  }, [open]);

  const errors = checked ? rangeErrors(range) : {};
  const close = () => !busy.current && onClose();

  const submit = async () => {
    if (busy.current) return;
    setChecked(true);
    const found = rangeErrors(range);
    if (found.from || found.to) return;
    busy.current = true;
    setSubmitting(true);
    setError(null);
    try {
      saveDownload(await apiDownload(exportPath(ownerId, kind, venueId, range)));
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  const set = (patch: Partial<ExportRange>) => {
    setRange((r) => ({ ...r, ...patch }));
    setError(null);
  };

  return (
    <Dialog open={open} onClose={close} title={t('owner.export.title')}>
      {open && (
        <form
          className={styles.body}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset className={styles.fieldset} disabled={submitting}>
            <legend className={styles.legend}>{t('owner.export.what')}</legend>
            <div className={styles.options}>
              {EXPORT_KINDS.map((k) => (
                <label key={k} className={styles.option}>
                  <input
                    type="radio"
                    name={`${id}-kind`}
                    className={styles.radio}
                    value={k}
                    checked={kind === k}
                    onChange={() => {
                      setKind(k);
                      setError(null);
                    }}
                  />
                  <span className={styles.optionLabel}>{t(`owner.export.kind.${k}`)}</span>
                  <span className={styles.optionHint}>{t(`owner.export.kindHint.${k}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className={styles.pair}>
            <TextField
              label={t('owner.export.from')}
              type="date"
              required
              value={range.from}
              disabled={submitting}
              error={errors.from && t(errors.from)}
              onChange={(e) => set({ from: e.target.value })}
            />
            <TextField
              label={t('owner.export.to')}
              type="date"
              required
              value={range.to}
              min={range.from || undefined}
              disabled={submitting}
              error={errors.to && t(errors.to, { max: EXPORT_MAX_DAYS })}
              onChange={(e) => set({ to: e.target.value })}
            />
          </div>
          {venues.length > 1 && (
            <Select
              icon="venue"
              layout="stacked"
              label={t('owner.venue')}
              value={venueId ?? ''}
              disabled={submitting}
              onChange={(e) => {
                setVenueId(e.target.value || null);
                setError(null);
              }}
              options={[{ value: '', label: t('owner.export.allVenues') }, ...venues.map((v) => ({ value: v.id, label: v.name }))]}
            />
          )}
          <p className={styles.note}>{t('owner.export.note')}</p>
          {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
          <div className={styles.actions}>
            <Button type="button" variant="secondary" disabled={submitting} onClick={onClose}>
              {t('owner.export.cancel')}
            </Button>
            <Button icon="download" type="submit" loading={submitting}>
              {t('owner.export.download')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
