import { useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatMoney, type BookingStatus, type SeriesClashReason, type SeriesGameJson, type SeriesJson } from '@booking/shared';
import { StatusBadge } from '../../bookings/StatusBadge';
import { ApiError, apiPost } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useResource } from '../../lib/useResource';
import { useTheme } from '../../theme/ThemeProvider';
import { BackButton, Badge, Button, Empty, ErrorState, Field, Group, Loading, Row, Screen, Sheet, Text } from '../../ui';
import { ownerHref, ownerPath } from '../labels';
import { useOwner } from '../OwnerProvider';
import type { OwnerTurf } from '../types';
import { dateRange, dateTimeLabel, dayLabel, patternSummary, SERIES_TONE, seriesCustomer, timeLabel } from './text';

/** The statuses a staff member can still cancel a game from (same as web). */
const CANCELLABLE: readonly BookingStatus[] = ['pending', 'awaiting_payment', 'confirmed'];
/** Rows shown before the games list folds behind "Show all". */
const COLLAPSED_ROWS = 5;
const REASON_MAX = 300;

type Line = { kind: 'game'; date: string; game: SeriesGameJson } | { kind: 'clash'; date: string; reason: SeriesClashReason };

/** One series: answer a request (accept / decline with a reason) or cancel all future games of an active one. */
export function SeriesDetail({ seriesId }: { seriesId: string }) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const { ownerId, venues, can } = useOwner();
  const lang = i18n.language;
  const { state, reload, set } = useResource<{ series: SeriesJson }>(ownerPath(ownerId, `/series/${encodeURIComponent(seriesId)}`));
  const series = state.status === 'ready' ? state.data.series : null;
  const turfs = useResource<{ turfs: OwnerTurf[] }>(series ? ownerPath(ownerId, `/venues/${encodeURIComponent(series.venueId)}/turfs`) : null);
  const [sheet, setSheet] = useState<'decline' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [sheetError, setSheetError] = useState<unknown>(null);
  const [kept, setKept] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const busy = useRef(false);

  if (state.status === 'error') {
    const missing = state.error instanceof ApiError && state.error.status === 404;
    return (
      <Screen scroll>
        <BackButton />
        {missing ? <Text tone="muted">{tr('series.owner.notFound')}</Text> : <ErrorState error={state.error} onRetry={reload} />}
      </Screen>
    );
  }
  if (!series) {
    return (
      <Screen>
        <BackButton />
        <Loading />
      </Screen>
    );
  }

  const venue = venues.find((v) => v.id === series.venueId);
  const tz = venue?.timezone ?? 'UTC';
  const turf = turfs.state.status === 'ready' ? turfs.state.data.turfs.find((x) => x.id === series.turfId) : undefined;
  const base = ownerPath(ownerId, `/series/${encodeURIComponent(series.id)}`);
  const games = [...series.games].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const now = Date.now();
  const future = games.filter((g) => CANCELLABLE.includes(g.status) && Date.parse(g.startAt) > now);
  const requested = series.status === 'requested';
  const canAnswer = requested && can('booking.confirm');
  const canCancelFuture = series.status === 'active' && can('booking.cancel') && future.length > 0;

  /** POSTs one series action, one at a time; a 409 means the series changed under us, so reload. */
  const post = async <T extends { series: SeriesJson }>(action: string, body: object = {}): Promise<T | null> => {
    if (busy.current) return null;
    busy.current = true;
    setPending(true);
    try {
      return await apiPost<T>(`${base}/${action}`, body);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) reload();
      throw e;
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const accept = () => {
    setKept(null);
    setError(null);
    post('accept').then(
      (res) => res && set({ series: res.series }),
      (e: unknown) => setError(e),
    );
  };

  const openSheet = (which: 'decline' | 'cancel') => {
    setReason('');
    setSheetError(null);
    setSheet(which);
  };

  const submitSheet = async () => {
    const trimmed = reason.trim();
    const body = trimmed ? { reason: trimmed } : {};
    setSheetError(null);
    try {
      if (sheet === 'decline') {
        const res = await post('decline', body);
        if (!res) return;
        set({ series: res.series });
      } else {
        const res = await post<{ series: SeriesJson; cancelled: string[]; kept: { id: string; code: string }[] }>('cancel-future', body);
        if (!res) return;
        setKept(
          res.kept
            .map((k) => series.games.find((g) => g.id === k.id))
            .filter((g): g is SeriesGameJson => g !== undefined)
            .map((g) => dayLabel(g.businessDate, lang)),
        );
        set({ series: res.series });
      }
      setSheet(null);
    } catch (e) {
      setSheetError(e);
    }
  };

  const lines: Line[] = [
    ...games.map((g): Line => ({ kind: 'game', date: g.businessDate, game: g })),
    ...series.skipped.map((s): Line => ({ kind: 'clash', date: s.date, reason: s.reason })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const collapsible = lines.length > COLLAPSED_ROWS + 1;
  const shown = collapsible && !expanded ? lines.slice(0, COLLAPSED_ROWS) : lines;
  const perGame = games[0]?.total;

  return (
    <Screen scroll>
      <BackButton />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space3, flexWrap: 'wrap' }}>
        <Text variant="heading" tone="strong" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {seriesCustomer(series, tr)}
        </Text>
        <Badge label={tr(`series.status.${series.status}`)} tone={SERIES_TONE[series.status]} />
      </View>

      {requested && series.respondBy ? (
        <Notice tone="warning">{tr('series.owner.answerBy', { when: dateTimeLabel(series.respondBy, tz, lang) })}</Notice>
      ) : null}
      {error !== null ? <Notice tone="danger">{errorMessage(error, tr)}</Notice> : null}
      {kept !== null && kept.length > 0 ? <Notice tone="warning">{tr('series.owner.kept', { dates: kept.join(', ') })}</Notice> : null}

      <Group>
        <Fact label={tr('series.owner.schedule')} value={patternSummary(series, turf, lang)} />
        <Fact label={tr('owner.bookings.turf')} value={[turf?.name ?? '—', venues.length > 1 ? venue?.name : null].filter(Boolean).join(' · ')} />
        <Fact label={tr('series.owner.dates')} value={`${dateRange(series, lang)} · ${tr('mobile.owner.series.games', { count: games.length })}`} />
        {perGame !== undefined ? <Fact label={tr('mobile.owner.series.perGame')} value={formatMoney(perGame, series.currency, lang)} /> : null}
        {series.guest?.phone ? <Fact label={tr('owner.bookings.phone')} value={series.guest.phone} /> : null}
        {series.declineReason ? <Fact label={tr('owner.bookings.reason.recorded')} value={series.declineReason} /> : null}
      </Group>

      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.space2, flexWrap: 'wrap' }}>
        <Text variant="title" tone="strong" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {tr('series.owner.games')}
        </Text>
        {requested ? (
          <Text variant="label" tone="muted">
            {[
              tr('mobile.owner.series.free', { count: games.length }),
              series.skipped.length > 0 ? tr('mobile.owner.series.clash', { count: series.skipped.length }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}
      </View>
      {lines.length === 0 ? (
        <Empty>{tr('series.owner.noGames')}</Empty>
      ) : (
        <Group>
          {shown.map((l) =>
            l.kind === 'clash' ? (
              <Row
                key={`clash-${l.date}`}
                title={dayLabel(l.date, lang)}
                right={<Badge label={tr('mobile.owner.series.clashBadge', { reason: tr(`series.reason.${l.reason}`) })} tone="warning" />}
              />
            ) : (
              <Row
                key={l.game.id}
                title={dayLabel(l.date, lang)}
                detail={`${timeLabel(l.game.startAt, tz)}–${timeLabel(l.game.endAt, tz)} · ${l.game.reference}`}
                right={requested ? <Badge label={tr('mobile.owner.series.freeBadge')} tone="success" /> : <StatusBadge status={l.game.status} />}
                // Per-game actions (cancel, payments) live on the booking screen; the API refuses them while the request is open.
                onPress={!requested && can('booking.view') ? () => router.push(ownerHref(ownerId, `/booking/${encodeURIComponent(l.game.id)}`)) : undefined}
              />
            ),
          )}
        </Group>
      )}
      {collapsible ? (
        <Button
          label={expanded ? tr('series.showFewer') : tr('series.showAll', { count: lines.length })}
          variant="ghost"
          onPress={() => setExpanded((x) => !x)}
        />
      ) : null}
      {requested && series.skipped.length > 0 ? (
        <Text variant="label" tone="muted">
          {tr('mobile.owner.series.clashNote')}
        </Text>
      ) : null}

      {canAnswer ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
          <View style={{ flexGrow: 1 }}>
            <Button label={tr('series.owner.decline')} variant="secondary" tone="danger" disabled={pending} onPress={() => openSheet('decline')} />
          </View>
          <View style={{ flexGrow: 2 }}>
            <Button label={tr('mobile.owner.series.accept', { count: games.length })} loading={pending && sheet === null} disabled={pending} onPress={accept} />
          </View>
        </View>
      ) : null}
      {canCancelFuture ? (
        <Button label={tr('series.owner.cancelFuture')} variant="secondary" tone="danger" disabled={pending} onPress={() => openSheet('cancel')} />
      ) : null}

      <Sheet
        visible={sheet !== null}
        onClose={() => !busy.current && setSheet(null)}
        title={sheet === 'decline' ? tr('series.owner.declineTitle') : tr('series.owner.cancelFutureTitle', { count: future.length })}
        subtitle={seriesCustomer(series, tr)}
      >
        <Field
          label={tr('owner.bookings.reason.label')}
          value={reason}
          onChangeText={setReason}
          maxLength={REASON_MAX}
          multiline
        />
        {sheetError !== null ? (
          <Text tone="danger" accessibilityRole="alert">
            {errorMessage(sheetError, tr)}
          </Text>
        ) : null}
        <Button
          label={sheet === 'decline' ? tr('series.owner.decline') : tr('series.owner.cancelFutureConfirm')}
          tone="danger"
          loading={pending}
          onPress={() => void submitSheet()}
        />
        <Button label={tr('owner.bookings.reason.back')} variant="ghost" disabled={pending} onPress={() => setSheet(null)} />
      </Sheet>
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2, paddingHorizontal: t.space4, paddingVertical: t.space2, minHeight: t.controlLg, alignItems: 'center' }}>
      <Text variant="label" tone="muted" style={{ minWidth: t.space24 }}>
        {label}
      </Text>
      <Text variant="label" tone="strong" style={{ flex: 1, minWidth: t.space24 }}>
        {value}
      </Text>
    </View>
  );
}

function Notice({ tone, children }: { tone: 'warning' | 'danger'; children: ReactNode }) {
  const { t } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={{ backgroundColor: tone === 'warning' ? t.warningSoft : t.dangerSoft, borderRadius: t.radiusMd, padding: t.space3 }}
    >
      <Text variant="label" tone={tone}>
        {children}
      </Text>
    </View>
  );
}
