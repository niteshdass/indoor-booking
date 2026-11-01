import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminSettingsJson, SportSetting } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { SportCourt } from '../../landing/SportCourt';
import { resetSports } from '../../lib/sports';
import { Card, useSection, type Store } from './shared';
import styles from '../../owner/settings/settings.module.css';

/** The sports catalog: which sports players and owners can pick, in the order the home page and pickers show them. */
export function SportsTab({ data, store }: { data: AdminSettingsJson; store: Store }) {
  const { t } = useTranslation();
  const s = useSection('sports', store);
  const [rows, setRows] = useState<SportSetting[]>(data.sports);
  const on = rows.filter((r) => r.enabled).length;

  const toggle = (i: number, enabled: boolean) => setRows(rows.map((r, j) => (j === i ? { ...r, enabled } : r)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...rows];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    setRows(next);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void s.save({ sports: rows }).then((ok) => ok && resetSports());
  };

  return (
    <Card title={t('admin.settings.sports.title')} intro={t('admin.settings.sports.intro')}>
      <form className={styles.stack} onSubmit={submit} noValidate>
        <p className={styles.muted} role="status">
          {t('admin.settings.sports.count', { count: on, total: rows.length })}
        </p>
        <ol className={styles.sportList}>
          {rows.map((r, i) => {
            const name = t(`sports.${r.sport}`);
            return (
              <li key={r.sport} className={styles.sportRow}>
                <SportCourt sport={r.sport} className={[styles.sportArt, r.enabled && styles.sportArtOn].filter(Boolean).join(' ')} />
                <Checkbox className={styles.grow} label={name} checked={r.enabled} onChange={(v) => toggle(i, v)} />
                <span className={styles.sportMove}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="chevronUp"
                    aria-label={t('admin.settings.sports.up', { sport: name })}
                    title={t('admin.settings.sports.up', { sport: name })}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="chevronDown"
                    aria-label={t('admin.settings.sports.down', { sport: name })}
                    title={t('admin.settings.sports.down', { sport: name })}
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                  />
                </span>
              </li>
            );
          })}
        </ol>
        {on === 0 && <Alert tone="warning">{t('admin.settings.sports.none')}</Alert>}
        {s.error && <Alert tone="danger">{s.error}</Alert>}
        {s.saved && (
          <p className={styles.muted} role="status">
            {t('admin.settings.saved')}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" icon="check" loading={s.busy} disabled={on === 0}>
            {t('admin.settings.sports.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
