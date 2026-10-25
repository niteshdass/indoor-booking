import type { TFunction } from 'i18next';
import type { ActivityItem } from '../types';

/** Label for an activity entry's action; an action this build does not know falls back to its raw name. */
export function activityLabel(item: ActivityItem, t: TFunction): string {
  const key = `owner.activity.action.${item.action.replace(/\./g, '_')}`;
  return t(key, { defaultValue: t('owner.activity.action.unknown', { action: item.action }) });
}

const asRecord = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Top-level keys whose JSON differs between `before` and `after`, sorted. A missing side counts as empty. */
export function changedKeys(before: unknown, after: unknown): string[] {
  const b = asRecord(before);
  const a = asRecord(after);
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .sort();
}
