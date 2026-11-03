import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PublicReviewJson, RatingSummary } from '@booking/shared';
import { apiGet } from '../lib/api';
import { useTheme } from '../theme/ThemeProvider';
import { Card, Text } from '../ui';

const SHOWN = 3;

type State = { status: 'loading' } | { status: 'ready'; reviews: PublicReviewJson[] } | { status: 'error' };

/** The rating summary and the first few reviews. The full list stays on the web. */
export function ReviewsPreview({ slug, rating }: { slug: string; rating: RatingSummary | null }) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    apiGet<{ reviews: PublicReviewJson[] }>(`/venues/${encodeURIComponent(slug)}/reviews`).then(
      (r) => live && setState({ status: 'ready', reviews: r.reviews.slice(0, SHOWN) }),
      () => live && setState({ status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [slug]);

  const average = rating ? new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rating.average) : null;

  return (
    <View style={{ gap: t.space3 }}>
      <Text variant="title" tone="strong" accessibilityRole="header">
        {tr('reviews.title')}
      </Text>
      {rating && average ? (
        <Text tone="muted" accessibilityLabel={tr('reviews.cardLabel', { value: average, count: rating.count })}>
          {`★ ${average} · ${tr('reviews.summaryCount', { count: rating.count })}`}
        </Text>
      ) : null}
      {state.status === 'error' ? <Text tone="muted">{tr('mobile.venue.reviewsFailed')}</Text> : null}
      {state.status === 'ready' && state.reviews.length === 0 ? <Text tone="muted">{tr('reviews.none')}</Text> : null}
      {state.status === 'ready'
        ? state.reviews.map((r) => (
            <Card key={r.id} style={{ gap: t.space1 }}>
              <Text variant="label" tone="strong">
                {r.reviewer ?? tr('reviews.player')}
              </Text>
              <Text variant="caption" tone="muted" accessibilityLabel={tr('reviews.starsLabel', { value: r.stars })}>
                {`★ ${r.stars}/5`}
              </Text>
              {r.comment ? <Text>{r.comment}</Text> : null}
            </Card>
          ))
        : null}
    </View>
  );
}
