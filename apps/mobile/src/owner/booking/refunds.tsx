import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatBdMobile, formatMoney, normalizeTrxId, PROVIDER_NAMES } from '@booking/shared';
import { apiPost } from '../../lib/api';
import { useTheme } from '../../theme/ThemeProvider';
import { Badge, Button, Card, Field, Sheet, Text, type BadgeTone } from '../../ui';
import { ownerPath } from '../labels';
import { useOwner } from '../OwnerProvider';
import type { RefundJson } from '../types';
import { ErrorLine } from './forms';
import { usePost } from './usePost';

const REFUND_TONE: Record<RefundJson['status'], BadgeTone> = { pending: 'warning', succeeded: 'success', failed: 'danger' };

/** Ask for the TrxID of the money staff sent by hand, then mark the wallet refund sent (web MarkSentDialog). */
export function MarkSentSheet({ refund, onClose, onSent }: { refund: RefundJson | null; onClose(): void; onSent(): void }) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { ownerId } = useOwner();
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const { post, busy, error, inflight } = usePost(onSent);
  const close = () => {
    if (inflight.current) return;
    setText('');
    setInvalid(false);
    onClose();
  };
  const submit = async () => {
    if (!refund) return;
    const trxId = normalizeTrxId(text);
    if (trxId === null) return setInvalid(true);
    setInvalid(false);
    const res = await post<unknown>(ownerPath(ownerId, `/refunds/${encodeURIComponent(refund.id)}/mark-sent`), { trxId });
    if (res !== null) {
      setText('');
      onSent();
    }
  };
  return (
    <Sheet visible={refund !== null} onClose={close} title={tr('owner.refunds.markSentTitle')}>
      <View style={{ gap: t.space3 }}>
        <Field
          label={tr('owner.refunds.trxId')}
          hint={tr('owner.refunds.trxHint')}
          value={text}
          onChangeText={setText}
          autoCapitalize="characters"
          autoCorrect={false}
          error={invalid ? tr('owner.refunds.trxInvalid') : undefined}
        />
        <ErrorLine error={error} />
        <Button label={tr('owner.refunds.markSent')} loading={busy} disabled={busy} onPress={() => void submit()} />
        <Button label={tr('owner.refunds.back')} variant="ghost" disabled={busy} onPress={close} />
      </View>
    </Sheet>
  );
}

/**
 * Refunds on one booking. Members with payment.verify see wallet refunds to send with Mark sent (TrxID); members with
 * refund.issue can retry a failed card refund or record a refund as cash (web OwnerRefunds).
 */
export function RefundsSection({ refunds, onChanged }: { refunds: RefundJson[]; onChanged(): void }) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const { ownerId, can } = useOwner();
  const [sending, setSending] = useState<RefundJson | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (refunds.length === 0) return null;
  const fmt = (r: RefundJson) => formatMoney(r.amount, r.currency, i18n.language);
  const toSend = (r: RefundJson) => can('payment.verify') && r.method === 'wallet' && r.status === 'pending';
  const fixable = (r: RefundJson) => can('refund.issue') && ((r.method === 'card' && r.status === 'failed') || (r.method === 'cash' && r.status === 'pending'));

  const run = async (r: RefundJson, kind: 'retry' | 'record-cash') => {
    if (busyId) return;
    setBusyId(r.id);
    setError(null);
    try {
      await apiPost(ownerPath(ownerId, `/refunds/${encodeURIComponent(r.id)}/${kind}`), {});
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
      onChanged(); // on failure too: the row moved on, show its real state
    }
  };

  return (
    <View style={{ gap: t.space2 }}>
      <Text variant="label" tone="muted" accessibilityRole="header">
        {tr('cancel.refundsTitle')}
      </Text>
      <Card>
        <View style={{ gap: t.space3 }}>
          {refunds.map((r) => (
            <View key={r.id} style={{ gap: t.space2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
                <View style={{ flex: 1, gap: t.space1 / 2 }}>
                  <Text tone="strong">{`${fmt(r)} · ${tr(`cancel.method.${r.method}`)}`}</Text>
                  <Text variant="caption" tone="muted">
                    {tr(`cancel.refundReason.${r.reason}`)}
                  </Text>
                </View>
                <Badge label={tr(`cancel.refundStatus.${r.status}`)} tone={REFUND_TONE[r.status]} />
              </View>
              {toSend(r) ? (
                <>
                  <Text>
                    {tr('owner.refunds.sendBack', {
                      amount: fmt(r),
                      number: formatBdMobile(r.sendTo ?? ''),
                      provider: r.provider ? PROVIDER_NAMES[r.provider] : '',
                    })}
                  </Text>
                  <Button label={tr('owner.refunds.markSent')} variant="secondary" disabled={busyId !== null} onPress={() => setSending(r)} />
                </>
              ) : null}
              {fixable(r) && r.method === 'card' ? (
                <>
                  <Button label={tr('owner.refunds.retry')} variant="secondary" loading={busyId === r.id} disabled={busyId !== null} onPress={() => void run(r, 'retry')} />
                  <Button label={tr('owner.refunds.recordCash')} variant="secondary" disabled={busyId !== null} onPress={() => void run(r, 'record-cash')} />
                </>
              ) : null}
              {fixable(r) && r.method === 'cash' ? (
                <Button label={tr('owner.refunds.recordPaidOut')} variant="secondary" loading={busyId === r.id} disabled={busyId !== null} onPress={() => void run(r, 'record-cash')} />
              ) : null}
            </View>
          ))}
          <ErrorLine error={error} />
        </View>
      </Card>
      <MarkSentSheet
        refund={sending}
        onClose={() => setSending(null)}
        onSent={() => {
          setSending(null);
          onChanged();
        }}
      />
    </View>
  );
}
