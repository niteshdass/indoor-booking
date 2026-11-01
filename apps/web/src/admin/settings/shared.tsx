import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminSettingsJson, SettingSource } from '@booking/shared';
import { Badge, type Tone } from '../../components/ui/Badge';
import { ApiError, apiDelete, apiGet, apiPut } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import styles from '../../owner/settings/settings.module.css';

/** The tabs of Admin > Settings. */
export type SettingsTab = 'general' | 'payments' | 'sports' | 'google' | 'email' | 'sms';
/** Each PUT/DELETE path under /admin/settings. */
export type Section = SettingsTab | 'payout-stripe';
export type Store = (next: AdminSettingsJson) => void;

const SOURCE_TONE: Record<SettingSource, Tone> = { admin: 'success', server: 'info', none: 'warning' };

/** Provider errors (a refused test message) carry their own reason; everything else uses the shared messages. */
export function failureText(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError && err.code === 'delivery_failed') return t('admin.settings.testFailed', { reason: err.message });
  return errorMessage(err, t);
}

/** Which field each validation issue from the server belongs to (zod `path` joined with dots). */
export type ServerField = 'fixed' | 'percent' | 'bkash' | 'nagad';

export function serverFields(err: unknown): Set<ServerField> {
  const out = new Set<ServerField>();
  if (!(err instanceof ApiError) || err.code !== 'validation_error' || !Array.isArray(err.details)) return out;
  for (const issue of err.details as Array<{ path?: unknown }>) {
    if (!Array.isArray(issue.path)) continue;
    const [a, b] = issue.path as string[];
    if (a === 'fee' && (b === 'fixed' || b === 'percent')) out.add(b);
    if (a === 'payout' && (b === 'bkash' || b === 'nagad')) out.add(b);
  }
  return out;
}

/** Save / remove / busy / error handling shared by the cards. `save` and `remove` resolve to whether they worked. */
export function useSection(section: Section, store: Store) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const run = async (fn: () => Promise<AdminSettingsJson>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      store(await fn());
      setSaved(true);
      setBusy(false);
      return true;
    } catch (err) {
      setError(err);
      setBusy(false);
      return false;
    }
  };
  return {
    busy,
    /** The raw failure, for callers that map it onto fields. */
    failure: error,
    error: error !== null ? failureText(error, t) : null,
    saved,
    save: (body: object) => run(() => apiPut<AdminSettingsJson>(`/admin/settings/${section}`, body)),
    // DELETE answers with the updated settings, but apiDelete drops the body, so read them back.
    remove: () => run(async () => (await apiDelete(`/admin/settings/${section}`), apiGet<AdminSettingsJson>('/admin/settings'))),
  };
}

export function Card({ title, intro, source, guide, children }: { title: string; intro: ReactNode; source?: SettingSource; guide?: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.statusRow}>
        <h2 className={styles.heading}>{title}</h2>
        {source && <Badge tone={SOURCE_TONE[source]}>{t(`admin.settings.source.${source}`)}</Badge>}
      </div>
      <p className={styles.muted}>
        {intro}
        {guide && (
          <>
            {' '}
            <a className={styles.link} href={`/admin/docs/${guide}`} target="_blank" rel="noopener">
              {t('admin.docs.guide')}
            </a>
          </>
        )}
      </p>
      {children}
    </section>
  );
}
