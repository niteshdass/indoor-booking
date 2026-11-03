import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { useTranslation } from 'react-i18next';
import { fontFamily, type FontKind, type Weight } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import type { light } from '../theme/tokens';

type Tokens = typeof light;
export type TextVariant = 'body' | 'caption' | 'label' | 'title' | 'heading' | 'display';
export type TextTone = 'strong' | 'default' | 'muted' | 'subtle' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const sizes: Record<TextVariant, keyof Tokens> = {
  body: 'textBase',
  caption: 'textXs',
  label: 'textSm',
  title: 'textLg',
  heading: 'textXl',
  display: 'text3xl',
};
const weights: Record<TextVariant, Weight> = {
  body: 'regular',
  caption: 'regular',
  label: 'medium',
  title: 'semibold',
  heading: 'bold',
  display: 'bold',
};
const kinds: Record<TextVariant, FontKind> = {
  body: 'sans',
  caption: 'sans',
  label: 'sans',
  title: 'display',
  heading: 'display',
  display: 'display',
};
const tones: Record<TextTone, keyof Tokens> = {
  strong: 'textStrong',
  default: 'textDefault',
  muted: 'textMuted',
  subtle: 'textSubtle',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
};

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  weight?: Weight;
}

/** Token-backed text: size, weight, line height and color come from the variant and tone only. */
export function Text({ variant = 'body', tone = 'default', weight, style, ...rest }: TextProps) {
  const { t } = useTheme();
  const { i18n } = useTranslation();
  const bn = i18n.language === 'bn';
  const fontSize = t[sizes[variant]] as number;
  const heading = variant === 'heading' || variant === 'title' || variant === 'display';
  const leading = heading
    ? variant === 'display'
      ? bn ? t.leadingDisplayBn : t.leadingDisplay
      : bn ? t.leadingHeadingBn : t.leadingHeading
    : bn ? t.leadingBodyBn : t.leadingBody;
  return (
    <RNText
      {...rest}
      style={[
        {
          color: t[tones[tone]] as string,
          fontFamily: fontFamily(kinds[variant], weight ?? weights[variant], i18n.language),
          fontSize,
          lineHeight: Math.round(fontSize * leading),
        },
        style,
      ]}
    />
  );
}
