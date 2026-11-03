import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { useTranslation } from 'react-i18next';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  hint?: string;
  error?: string;
}

/** Labelled text input: filled, no resting border; the border appears on focus (design-system "Hard court"). */
export function Field({ label, hint, error, onFocus, onBlur, ...rest }: FieldProps) {
  const { t } = useTheme();
  const { i18n } = useTranslation();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: t.space1 }}>
      <Text variant="label" tone="strong">
        {label}
      </Text>
      <TextInput
        {...rest}
        accessibilityLabel={label}
        placeholderTextColor={t.textSubtle}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={{
          minHeight: t.controlLg,
          paddingHorizontal: t.space3,
          paddingVertical: t.space2,
          borderRadius: t.radiusMd,
          borderWidth: t.focusWidth,
          borderColor: error ? t.danger : focused ? t.primary : 'transparent',
          backgroundColor: t.controlFill,
          color: t.textStrong,
          fontFamily: fontFamily('sans', 'regular', i18n.language),
          fontSize: t.textMd,
        }}
      />
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
