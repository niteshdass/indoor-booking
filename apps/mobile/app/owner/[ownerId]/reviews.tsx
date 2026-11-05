import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { REVIEW_FLAG_REASON_MAX, REVIEW_REPLY_MAX, REVIEW_STARS, type OwnerReviewJson, type RatingSummary } from '@booking/shared';
import { apiDelete, apiGet, apiPost, apiPut } from '../../../src/lib/api';
import { errorMessage } from '../../../src/lib/errors';
import { useResource } from '../../../src/lib/useResource';
import { useOwner } from '../../../src/owner/OwnerProvider';
import { ownerHref, ownerPath } from '../../../src/owner/labels';
import { Stars } from '../../../src/owner/team/Stars';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { BackButton, Badge, Button, Card, Chip, Empty, ErrorState, Field, Loading, Screen, Sheet, Text } from '../../../src/ui';

type Summary = { venueId: string; name: string; rating: RatingSummary | null };
type Page = { reviews: OwnerReviewJson[]; nextBefore: string | null; summary: Summary[] };
type More = { key: string; items: OwnerReviewJson[]; cursor: string | null };

const formatRating = (n: number, lang: string) => new Intl.NumberFormat(lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n);

/** Owner reviews (`review.manage`): rating per venue, venue and star filters, inline reply, report (flag). */
export default function ReviewsScreen() {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const lang = i18n.language;
  const { ownerId, venues, can } = useOwner();
  const allowed = can('review.manage');
  const [venueId, setVenueId] = useState('');
  const [stars, setStars] = useState<number | null>(null);

  const query = (before?: string) => {
    const q = new URLSearchParams();
    if (venueId) q.set('venueId', venueId);
    if (stars) q.set('stars', String(stars));
    if (before) q.set('before', before);
    const s = q.toString();
    return ownerPath(ownerId, `/reviews${s ? `?${s}` : ''}`);
  };
  const key = query();
  const first = useResource<Page>(allowed ? key : null);

  const [more, setMore] = useState<More | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [edits, setEdits] = useState<Record<string, Partial<OwnerReviewJson>>>({});
  const [replying, setReplying] = useState<string | null>(null);
  const [flagging, setFlagging] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  if (more && more.key !== key) setMore(null);

  const patch = (id: string, over: Partial<OwnerReviewJson>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...over } }));
  const base = ownerPath(ownerId, '/reviews');

  const head = (
    <>
      <BackButton />
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {tr('owner.reviews.title')}
      </Text>
    </>
  );
  if (!allowed) {
    return (
      <Screen>
        {head}
        <Text tone="muted">{tr('owner.noAccess')}</Text>
      </Screen>
    );
  }

  const filters = (
    <View style={{ gap: t.space2 }}>
      {venues.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space2 }}>
          {[{ id: '', name: tr('owner.reviews.allVenues') }, ...venues].map((v) => (
            <Chip key={v.id || 'all'} selected={venueId === v.id} onPress={() => setVenueId(v.id)} accessibilityRole="button" accessibilityState={{ selected: venueId === v.id }}>
              <Text variant="label">{v.name}</Text>
            </Chip>
          ))}
        </ScrollView>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space2 }}>
        {[null, ...[...REVIEW_STARS].reverse()].map((s) => (
          <Chip key={s ?? 'all'} selected={stars === s} onPress={() => setStars(s)} accessibilityRole="button" accessibilityState={{ selected: stars === s }}>
            <Text variant="label">{s === null ? tr('owner.reviews.allStars') : tr('reviews.starOption', { count: s })}</Text>
          </Chip>
        ))}
      </ScrollView>
    </View>
  );

  if (first.state.status === 'error') {
    return (
      <Screen>
        {head}
        <ErrorState error={first.state.error} onRetry={first.reload} />
      </Screen>
    );
  }
  if (first.state.status !== 'ready') {
    return (
      <Screen>
        {head}
        {filters}
        <Loading />
      </Screen>
    );
  }

  const data = first.state.data;
  const extra = more && more.key === key ? more : null;
  const rows = [...data.reviews, ...(extra?.items ?? [])].map((r) => ({ ...r, ...edits[r.id] }));
  const nextBefore = extra ? extra.cursor : data.nextBefore;
  const venueName = (id: string) => data.summary.find((s) => s.venueId === id)?.name ?? venues.find((v) => v.id === id)?.name ?? '';
  const timeZone = (id: string) => venues.find((v) => v.id === id)?.timezone ?? 'UTC';
  const date = (iso: string, venue: string) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: timeZone(venue) }).format(new Date(iso));

  const loadMore = async () => {
    if (nextBefore === null || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await apiGet<Page>(query(nextBefore));
      setMore((m) => ({ key, items: [...(m && m.key === key ? m.items : []), ...page.reviews], cursor: page.nextBefore }));
    } catch (err) {
      setMoreError(err);
    } finally {
      setLoadingMore(false);
    }
  };
  const saveReply = async (id: string, text: string) => {
    const res = await apiPut<{ review: OwnerReviewJson }>(`${base}/${encodeURIComponent(id)}/reply`, { text });
    patch(id, { reply: res.review.reply });
    setReplying(null);
  };
  const removeReply = async (id: string) => {
    await apiDelete(`${base}/${encodeURIComponent(id)}/reply`);
    patch(id, { reply: null });
    setDeleting(null);
  };
  const flag = async (id: string, reason: string) => {
    const res = await apiPost<{ review: OwnerReviewJson }>(`${base}/${encodeURIComponent(id)}/flag`, reason ? { reason } : {});
    patch(id, { flag: res.review.flag });
    setFlagging(null);
  };

  return (
    <Screen scroll>
      {head}
      {data.summary.map((s) => (
        <Text key={s.venueId} tone="muted">
          {s.rating
            ? `${s.name} · ${formatRating(s.rating.average, lang)} ★ · ${tr('reviews.summaryCount', { count: s.rating.count })}`
            : `${s.name} · ${tr('reviews.none')}`}
        </Text>
      ))}
      {filters}

      {rows.length === 0 ? (
        <Empty>{tr('owner.reviews.empty')}</Empty>
      ) : (
        rows.map((r) => (
          <Card key={r.id}>
            <View style={{ gap: t.space2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2, flexWrap: 'wrap' }}>
                <Text weight="semibold" tone="strong" style={{ flexShrink: 1 }}>
                  {r.reviewer ?? tr('reviews.player')}
                </Text>
                <Stars value={r.stars} />
              </View>
              {r.comment ? <Text>{r.comment}</Text> : null}
              <Text
                variant="caption"
                tone={can('booking.view') ? 'primary' : 'muted'}
                accessibilityRole={can('booking.view') ? 'link' : undefined}
                onPress={can('booking.view') ? () => router.push(ownerHref(ownerId, `/booking/${encodeURIComponent(r.bookingId)}`)) : undefined}
              >
                {[venueName(r.venueId), date(r.createdAt, r.venueId), r.reference, r.edited ? tr('reviews.edited') : null].filter(Boolean).join(' · ')}
              </Text>
              {(r.flag || r.hidden) && (
                <View style={{ flexDirection: 'row', gap: t.space2, flexWrap: 'wrap' }}>
                  {r.flag && <Badge tone="warning" label={tr('owner.reviews.flagged')} />}
                  {r.hidden && <Badge tone="neutral" label={tr('owner.reviews.hidden')} />}
                </View>
              )}
              {r.reply && replying !== r.id && (
                <View style={{ backgroundColor: t.bgSubtle, borderRadius: t.radiusMd, padding: t.space3, gap: t.space1 }}>
                  <Text variant="caption" weight="semibold" tone="muted">
                    {tr('reviews.reply')}
                  </Text>
                  <Text>{r.reply.text}</Text>
                </View>
              )}
              {replying === r.id ? (
                <ReplyBox initial={r.reply?.text ?? ''} onSave={(text) => saveReply(r.id, text)} onCancel={() => setReplying(null)} />
              ) : (
                !r.hidden && (
                  <View style={{ flexDirection: 'row', gap: t.space2, flexWrap: 'wrap' }}>
                    <Button
                      label={r.reply ? tr('owner.reviews.replyEdit') : tr('owner.reviews.reply')}
                      variant="secondary"
                      onPress={() => setReplying(r.id)}
                    />
                    {r.reply && <Button label={tr('owner.reviews.replyDelete')} variant="ghost" tone="danger" onPress={() => setDeleting(r.id)} />}
                    {!r.flag && !r.flagCleared && (
                      <Button label={tr('mobile.owner.team.reviews.report')} variant="ghost" onPress={() => setFlagging(r.id)} />
                    )}
                  </View>
                )
              )}
            </View>
          </Card>
        ))
      )}

      {moreError !== null && <Text tone="danger">{errorMessage(moreError, tr)}</Text>}
      {nextBefore !== null && <Button label={tr('reviews.showMore')} variant="secondary" loading={loadingMore} onPress={() => void loadMore()} />}

      {flagging !== null && <FlagSheet onClose={() => setFlagging(null)} onSubmit={(reason) => flag(flagging, reason)} />}
      {deleting !== null && <DeleteReplySheet onClose={() => setDeleting(null)} onConfirm={() => removeReply(deleting)} />}
    </Screen>
  );
}

/** Inline reply editor; the screen closes it once `onSave` resolves. */
function ReplyBox({ initial, onSave, onCancel }: { initial: string; onSave(text: string): Promise<void>; onCancel(): void }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const empty = text.trim() === '';
  const submit = async () => {
    if (busy || empty) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(text.trim());
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: t.space2 }}>
      <Field
        label={tr('owner.reviews.replyField')}
        value={text}
        onChangeText={setText}
        maxLength={REVIEW_REPLY_MAX}
        multiline
        hint={tr('owner.reviews.replyCount', { n: text.length })}
      />
      {error !== null && <Text tone="danger">{errorMessage(error, tr)}</Text>}
      <View style={{ flexDirection: 'row', gap: t.space2, flexWrap: 'wrap' }}>
        <Button label={tr('owner.reviews.replySave')} loading={busy} disabled={empty} onPress={() => void submit()} />
        <Button label={tr('owner.reviews.cancel')} variant="ghost" disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}

/** Optional reason, then the flag. The review stays up; the platform team checks it. */
function FlagSheet({ onClose, onSubmit }: { onClose(): void; onSubmit(reason: string): Promise<void> }) {
  const { t: tr } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const close = () => !busy && onClose();
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Sheet visible onClose={close} title={tr('owner.reviews.flagTitle')}>
      <Text tone="muted">{tr('mobile.owner.team.reviews.reportHint')}</Text>
      <Field
        label={tr('owner.reviews.flagReason')}
        value={reason}
        onChangeText={setReason}
        maxLength={REVIEW_FLAG_REASON_MAX}
        multiline
        hint={tr('owner.reviews.flagCount', { n: reason.length })}
      />
      {error !== null && <Text tone="danger">{errorMessage(error, tr)}</Text>}
      <Button label={tr('owner.reviews.flagSubmit')} loading={busy} onPress={() => void submit()} />
      <Button label={tr('owner.reviews.cancel')} variant="ghost" disabled={busy} onPress={close} />
    </Sheet>
  );
}

function DeleteReplySheet({ onClose, onConfirm }: { onClose(): void; onConfirm(): Promise<void> }) {
  const { t: tr } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const close = () => !busy && onClose();
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Sheet visible onClose={close} title={tr('owner.reviews.deleteTitle')}>
      <Text tone="muted">{tr('owner.reviews.deleteBody')}</Text>
      {error !== null && <Text tone="danger">{errorMessage(error, tr)}</Text>}
      <Button label={tr('owner.reviews.deleteConfirm')} tone="danger" loading={busy} onPress={() => void confirm()} />
      <Button label={tr('owner.reviews.cancel')} variant="ghost" disabled={busy} onPress={close} />
    </Sheet>
  );
}
