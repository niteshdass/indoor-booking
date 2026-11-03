import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { Text } from './Text';

/** Top-left arrow and "Back" for screens without a header. Opened cold (deep link, no history), it goes to Find instead. */
export function BackButton() {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const router = useRouter();
  const goBack = () => (router.canGoBack?.() ? router.back() : router.replace('/'));
  const label = tr('mobile.venue.back');
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={goBack}
        hitSlop={(t.controlLg - t.controlMd) / 2}
        style={({ pressed }) => ({
          minHeight: t.controlMd,
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space1,
          paddingLeft: t.space1,
          paddingRight: t.space3,
          marginLeft: -t.space1,
          borderRadius: t.radiusFull,
          backgroundColor: pressed ? t.bgHover : 'transparent',
        })}
      >
        <Icon name="arrowLeft" color={t.textStrong} />
        <Text variant="label" weight="semibold" tone="strong">
          {label}
        </Text>
      </Pressable>
    </View>
  );
}
