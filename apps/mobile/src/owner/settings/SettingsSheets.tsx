import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_OWNER_SETTINGS,
  DEFAULT_RESCHEDULE,
  PROVIDER_NAMES,
  RESCHEDULE_MAX_MOVES,
  currencyExponent,
  formatBdMobile,
  parseMoney,
  type ManualWallet,
  type OwnerSettings,
  type PaymentPolicy,
  type RefundRule,
  type WalletProvider,
} from '@booking/shared';
import { errorMessage } from '../../lib/errors';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, Chip, Field, Row, Sheet, Text } from '../../ui';
import { settingsErrors, settingsPatch, type Draft, type SettingsError, type SettingsLevel, type StoredSettings } from './settingsPatch';

export type SheetKind = 'rules' | 'refunds' | 'deposit' | WalletProvider;

const clone = <T,>(v: T): T => structuredClone(v);
const numText = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? String(n) : '');
const toNum = (s: string) => (s.trim() === '' ? NaN : Number(s));
export const amountText = (minor: number, currency: string) => {
  const exp = currencyExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
};

/** Which validation errors each sheet shows (and is blocked by). */
const SHEET_ERRORS: Record<'rules' | 'refunds' | 'deposit' | 'wallet', SettingsError[]> = {
  rules: ['window', 'autoReject', 'reschedule'],
  refunds: ['refund', 'duplicate'],
  deposit: ['percent', 'amount'],
  wallet: ['wallet'],
};
const ERROR_TEXT: Record<SettingsError, string> = {
  hours: 'owner.settings.errors.hours',
  percent: 'owner.settings.errors.percent',
  amount: 'owner.settings.errors.amount',
  refund: 'owner.settings.errors.refund',
  duplicate: 'owner.settings.duplicate',
  wallet: 'owner.settings.errors.wallet',
  window: 'owner.settings.errors.window',
  autoReject: 'owner.settings.errors.autoReject',
  reschedule: 'owner.settings.errors.reschedule',
};

/** The settings keys a sheet edits; at venue level these share one "use team default" switch. */
function sheetKeys(kind: SheetKind, level: SettingsLevel): (keyof OwnerSettings)[] {
  if (kind === 'rules') return level === 'owner' ? ['bookingWindowDays', 'pendingAutoRejectHours', 'guestBooking', 'reschedule'] : ['bookingWindowDays', 'guestBooking', 'reschedule'];
  if (kind === 'refunds') return ['refundRules'];
  if (kind === 'deposit') return ['paymentPolicy'];
  return ['paymentMethods'];
}

type Props = {
  kind: SheetKind;
  level: SettingsLevel;
  /** What is stored at this level (owner: the full settings; venue: only overridden keys). */
  stored: StoredSettings;
  /** The owner's settings a venue inherits; null at owner level. */
  inherited: OwnerSettings | null;
  currency: string;
  onSave(patch: Record<string, unknown>): Promise<void>;
  onClose(): void;
};

/** One section of the settings form in a sheet: edits a draft, sends only what changed (web `settingsPatch`). */
export function SettingsSheet({ kind, level, stored, inherited, currency, onSave, onClose }: Props) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const venue = level === 'venue';
  const [draft, setDraft] = useState<Draft>(() => clone(stored));
  const [amount, setAmount] = useState(() => (stored.paymentPolicy?.type === 'partial_fixed' ? amountText(stored.paymentPolicy.amount, currency) : ''));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const from = (inherited ?? stored) as OwnerSettings;
  const keys = sheetKeys(kind, level);
  const inheriting = venue && keys.every((k) => draft[k] === undefined);
  const locked = busy || inheriting;
  const value = <K extends keyof OwnerSettings>(k: K): OwnerSettings[K] => (draft[k] ?? from[k] ?? DEFAULT_OWNER_SETTINGS[k]) as OwnerSettings[K];
  const edit = (next: Draft) => setDraft(next);
  const setInherit = (on: boolean) => {
    const next = { ...draft } as Record<string, unknown>;
    for (const k of keys) {
      if (on) delete next[k];
      else next[k] = clone(from[k] ?? (k === 'reschedule' ? DEFAULT_RESCHEDULE : DEFAULT_OWNER_SETTINGS[k]));
    }
    const p = (next as Draft).paymentPolicy;
    setAmount(p?.type === 'partial_fixed' ? amountText(p.amount, currency) : '');
    edit(next as Draft);
  };

  const group = kind === 'rules' || kind === 'refunds' || kind === 'deposit' ? kind : 'wallet';
  const errors = [...settingsErrors(draft)].filter((e) => SHEET_ERRORS[group].includes(e));

  const save = async () => {
    setSubmitted(true);
    setError(null);
    if (busy || errors.length > 0) return;
    const patch = settingsPatch(level, stored, draft);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await onSave(patch);
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const title =
    kind === 'rules'
      ? tr('mobile.owner.settings.rules')
      : kind === 'refunds'
        ? tr('owner.settings.refundTitle')
        : kind === 'deposit'
          ? tr('mobile.owner.settings.deposit')
          : PROVIDER_NAMES[kind];

  let body: ReactNode;
  if (kind === 'rules') {
    const guest = value('guestBooking');
    const moves = value('reschedule') ?? DEFAULT_RESCHEDULE;
    body = (
      <>
        <Field
          label={tr('owner.settings.bookingWindow')}
          hint={tr('owner.settings.windowHint')}
          keyboardType="number-pad"
          editable={!locked}
          value={numText(value('bookingWindowDays'))}
          onChangeText={(s) => edit({ ...draft, bookingWindowDays: toNum(s) })}
        />
        {!venue && (
          <Field
            label={tr('owner.settings.autoReject')}
            hint={tr('owner.settings.autoRejectHint')}
            keyboardType="number-pad"
            editable={!busy}
            value={numText(value('pendingAutoRejectHours'))}
            onChangeText={(s) => edit({ ...draft, pendingAutoRejectHours: toNum(s) })}
          />
        )}
        <Row
          title={tr('owner.settings.guestAllowed')}
          toggle={{ value: guest.allowed, disabled: locked, onChange: (allowed) => edit({ ...draft, guestBooking: { ...guest, allowed } }) }}
        />
        <Row
          title={tr('owner.settings.guestOtp')}
          toggle={{ value: guest.requireOtp, disabled: locked, onChange: (requireOtp) => edit({ ...draft, guestBooking: { ...guest, requireOtp } }) }}
        />
        <Row
          title={tr('owner.settings.rescheduleAllowed')}
          toggle={{ value: moves.allowed, disabled: locked, onChange: (allowed) => edit({ ...draft, reschedule: { ...moves, allowed } }) }}
        />
        {moves.allowed && (
          <>
            <Field
              label={tr('owner.settings.rescheduleHours')}
              hint={tr('owner.settings.rescheduleHoursHint')}
              keyboardType="number-pad"
              editable={!locked}
              value={numText(moves.minHoursBefore)}
              onChangeText={(s) => edit({ ...draft, reschedule: { ...moves, minHoursBefore: toNum(s) } })}
            />
            <Field
              label={tr('owner.settings.rescheduleMoves')}
              hint={`1–${RESCHEDULE_MAX_MOVES}`}
              keyboardType="number-pad"
              editable={!locked}
              value={numText(moves.maxMoves)}
              onChangeText={(s) => edit({ ...draft, reschedule: { ...moves, maxMoves: toNum(s) } })}
            />
            <Text variant="caption" tone="muted">
              {tr('owner.settings.rescheduleNote')}
            </Text>
          </>
        )}
      </>
    );
  } else if (kind === 'refunds') {
    const rules = value('refundRules');
    const setRules = (next: RefundRule[]) => edit({ ...draft, refundRules: next });
    const setRule = (i: number, p: Partial<RefundRule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...p } : r)));
    const addRule = () => {
      const used = new Set(rules.map((r) => r.minHoursBefore));
      let hours = 0;
      while (used.has(hours)) hours += 1;
      setRules([...rules, { minHoursBefore: hours, percent: 100 }]);
    };
    body = (
      <>
        <Text tone="muted">{rules.length === 0 ? tr('owner.settings.refundNone') : tr('owner.settings.refundHint')}</Text>
        {rules.map((r, i) => (
          <View key={i} style={{ gap: t.space2, paddingBottom: t.space2, borderBottomWidth: t.hairline, borderBottomColor: t.borderSubtle }}>
            <View style={{ flexDirection: 'row', gap: t.space2 }}>
              <View style={{ flex: 1 }}>
                <Field
                  label={tr('owner.settings.refundHours')}
                  keyboardType="number-pad"
                  editable={!locked}
                  value={numText(r.minHoursBefore)}
                  onChangeText={(s) => setRule(i, { minHoursBefore: toNum(s) })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label={tr('owner.settings.refundPercent')}
                  keyboardType="decimal-pad"
                  editable={!locked}
                  value={numText(r.percent)}
                  onChangeText={(s) => setRule(i, { percent: toNum(s) })}
                />
              </View>
            </View>
            {!locked && (
              <Button label={tr('owner.settings.removeRule', { n: i + 1 })} variant="ghost" tone="danger" onPress={() => setRules(rules.filter((_, j) => j !== i))} />
            )}
          </View>
        ))}
        {!locked && rules.length < 10 && <Button label={tr('owner.settings.addRule')} variant="secondary" onPress={addRule} />}
      </>
    );
  } else if (kind === 'deposit') {
    const policy = value('paymentPolicy');
    const types: PaymentPolicy['type'][] = ['none', 'full', 'partial_percent', ...(venue ? (['partial_fixed'] as const) : [])];
    const setType = (type: PaymentPolicy['type']) => {
      const next: PaymentPolicy =
        type === 'partial_percent' ? { type, percent: 50 } : type === 'partial_fixed' ? { type, amount: 0 } : { type };
      setAmount('');
      edit({ ...draft, paymentPolicy: next });
    };
    const setAmountText = (s: string) => {
      setAmount(s);
      let minor = 0;
      try {
        minor = parseMoney(s.trim(), currency);
      } catch {
        /* stays 0, which is flagged */
      }
      edit({ ...draft, paymentPolicy: { type: 'partial_fixed', amount: minor } });
    };
    body = (
      <>
        <Text variant="label" tone="strong">
          {tr('owner.settings.paymentType')}
        </Text>
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
          {types.map((ty) => (
            <Chip
              key={ty}
              selected={policy.type === ty}
              disabled={locked}
              onPress={() => setType(ty)}
              accessibilityRole="radio"
              accessibilityState={{ checked: policy.type === ty, disabled: locked }}
            >
              <Text variant="label">{tr(`owner.settings.payment.${ty}`)}</Text>
            </Chip>
          ))}
        </View>
        {policy.type === 'partial_percent' && (
          <Field
            label={tr('owner.settings.percent')}
            keyboardType="decimal-pad"
            editable={!locked}
            value={numText(policy.percent)}
            onChangeText={(s) => edit({ ...draft, paymentPolicy: { type: 'partial_percent', percent: toNum(s) } })}
          />
        )}
        {policy.type === 'partial_fixed' && (
          <Field
            label={tr('owner.settings.amount', { currency })}
            keyboardType="decimal-pad"
            editable={!locked}
            value={inheriting ? amountText(policy.amount, currency) : amount}
            onChangeText={setAmountText}
          />
        )}
        <Text variant="caption" tone="muted">
          {tr('owner.settings.paymentNote')}
        </Text>
      </>
    );
  } else {
    const provider = kind;
    const methods = value('paymentMethods') ?? DEFAULT_OWNER_SETTINGS.paymentMethods;
    const wallets = methods.manualWallets ?? [];
    const wallet = wallets.find((w) => w.provider === provider);
    const setWallets = (next: ManualWallet[]) => edit({ ...draft, paymentMethods: { ...methods, manualWallets: next } });
    const patchWallet = (p: Partial<ManualWallet>) => setWallets(wallets.map((w) => (w.provider === provider ? { ...w, ...p } : w)));
    body = (
      <>
        <Text tone="muted">{tr('owner.settings.methods.hint')}</Text>
        <Row
          title={tr('mobile.owner.settings.walletUse', { provider: PROVIDER_NAMES[provider] })}
          toggle={{
            value: wallet !== undefined,
            disabled: locked,
            onChange: (on) =>
              setWallets(on ? [...wallets, { provider, number: '', accountType: 'personal' }] : wallets.filter((w) => w.provider !== provider)),
          }}
        />
        {wallet && (
          <>
            <Field
              label={tr('owner.settings.methods.number')}
              keyboardType="phone-pad"
              autoComplete="off"
              editable={!locked}
              value={locked ? formatBdMobile(wallet.number) : wallet.number}
              onChangeText={(number) => patchWallet({ number })}
            />
            <Text variant="label" tone="strong">
              {tr('owner.settings.methods.accountType')}
            </Text>
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
              {(['personal', 'merchant', 'agent'] as const).map((a) => (
                <Chip
                  key={a}
                  selected={wallet.accountType === a}
                  disabled={locked}
                  onPress={() => patchWallet({ accountType: a })}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: wallet.accountType === a, disabled: locked }}
                >
                  <Text variant="label">{tr(`owner.settings.methods.account.${a}`)}</Text>
                </Chip>
              ))}
            </View>
            <Field
              label={tr('owner.settings.methods.note')}
              maxLength={140}
              editable={!locked}
              value={wallet.note ?? ''}
              onChangeText={(s) => {
                const next: ManualWallet = { ...wallet, note: s };
                if (s === '') delete next.note;
                setWallets(wallets.map((w) => (w.provider === provider ? next : w)));
              }}
            />
          </>
        )}
      </>
    );
  }

  return (
    <Sheet visible onClose={() => !busy && onClose()} title={title}>
      {venue && <Row title={tr('mobile.owner.settings.useTeamDefault')} toggle={{ value: inheriting, disabled: busy, onChange: setInherit }} />}
      {body}
      {submitted &&
        errors.map((e) => (
          <Text key={e} variant="caption" tone="danger" accessibilityRole="alert">
            {tr(ERROR_TEXT[e])}
          </Text>
        ))}
      {error !== null && (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(error, tr)}
        </Text>
      )}
      <Button label={tr('owner.settings.save')} loading={busy} onPress={() => void save()} />
    </Sheet>
  );
}
