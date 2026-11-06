import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text, type TextTone } from './Text';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TEXT_TONE: Record<BadgeTone, TextTone> = { success: 'success', warning: 'warning', danger: 'danger', info: 'info', neutral: 'muted' };

/** Small tinted pill with a text label: state is never shown by colour alone. */
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const { t } = useTheme();
  const bg = { success: t.successSoft, warning: t.warningSoft, danger: t.dangerSoft, info: t.infoSoft, neutral: t.bgSubtle }[tone];
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: t.space2, paddingVertical: t.space1 / 2, borderRadius: t.radiusFull, backgroundColor: bg }}>
      <Text variant="caption" weight="medium" tone={TEXT_TONE[tone]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
