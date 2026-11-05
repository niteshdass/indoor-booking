import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from '../../ui';

/** Five stars as text, filled up to `value` (rounded); spoken as "4 out of 5". */
export function Stars({ value }: { value: number }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const filled = Math.round(value);
  return (
    <Text variant="label" accessibilityLabel={tr('reviews.starsLabel', { value })} style={{ letterSpacing: t.space1 / 4 }}>
      <Text variant="label" style={{ color: t.starFilled }}>
        {'★'.repeat(filled)}
      </Text>
      <Text variant="label" style={{ color: t.starEmpty }}>
        {'★'.repeat(Math.max(0, 5 - filled))}
      </Text>
    </Text>
  );
}
