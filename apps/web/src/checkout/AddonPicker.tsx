import { useTranslation } from 'react-i18next';
import type { AddonLine, AddonSelection } from '@booking/shared';
import { money } from '../lib/format';
import type { OfferedAddonJson } from '../lib/types';
import styles from './AddonPicker.module.css';

type Props = {
  offered: OfferedAddonJson[];
  quoteLines: AddonLine[];
  value: AddonSelection[];
  onChange(v: AddonSelection[]): void;
  currency: string;
};

function Text({ id, name, unit }: { id: string; name: string; unit: string }) {
  return (
    <span className={styles.text}>
      <span id={`addon-${id}-name`} className={styles.name}>
        {name}
      </span>
      <span id={`addon-${id}-unit`} className={styles.unit}>
        {unit}
      </span>
    </span>
  );
}

/** Selectable add-ons only; auto-applied ones are listed in the summary. */
export function AddonPicker({ offered, quoteLines, value, onChange, currency }: Props) {
  const { t, i18n } = useTranslation();
  const selectable = offered.filter((a) => a.autoApply === null);
  if (selectable.length === 0) return null;

  const qty = (id: string) => value.find((v) => v.addonId === id)?.quantity ?? 0;
  const set = (id: string, q: number) => {
    const rest = value.filter((v) => v.addonId !== id);
    onChange(q > 0 ? [...rest, { addonId: id, quantity: q }] : rest);
  };

  return (
    <section className={styles.picker} aria-labelledby="addons-title">
      <h2 id="addons-title" className={styles.title}>
        {t('checkout.addons')}
      </h2>
      <ul className={styles.list}>
        {selectable.map((a) => {
          const q = qty(a.id);
          const line = quoteLines.find((l) => l.addonId === a.id && !l.auto);
          const unit = `${money(a.unitPrice, currency, i18n.language)} · ${t(`addons.${a.pricingType}`)}`;
          return (
            <li key={a.id} className={styles.item}>
              {a.pricingType !== 'per_unit' ? (
                // The whole row toggles; the checkbox is named by the add-on name only.
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={q > 0}
                    aria-labelledby={`addon-${a.id}-name`}
                    aria-describedby={`addon-${a.id}-unit`}
                    onChange={(e) => set(a.id, e.target.checked ? 1 : 0)}
                  />
                  <Text id={a.id} name={a.name} unit={unit} />
                  {line && <span className={styles.line}>{money(line.total, currency, i18n.language)}</span>}
                </label>
              ) : (
                <>
                  <Text id={a.id} name={a.name} unit={unit} />
                  {line && <span className={styles.line}>{money(line.total, currency, i18n.language)}</span>}
                  <div className={styles.stepper} role="group" aria-label={a.name}>
                    <button
                      type="button"
                      className={styles.step}
                      aria-label={t('checkout.decrease', { name: a.name })}
                      disabled={q <= 0}
                      onClick={() => set(a.id, q - 1)}
                    >
                      −
                    </button>
                    <output className={styles.qty} aria-label={t('checkout.quantity', { name: a.name })}>
                      {q}
                    </output>
                    <button
                      type="button"
                      className={styles.step}
                      aria-label={t('checkout.increase', { name: a.name })}
                      disabled={q >= a.maxQuantity}
                      onClick={() => set(a.id, q + 1)}
                    >
                      +
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
