import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MAX_SEARCH_TEXT } from '@booking/shared';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from '../ui';

/** Typing settles this long before the search runs; Search on the keyboard and clear run it at once. */
export const SEARCH_DEBOUNCE_MS = 400;

export interface SearchBoxProps {
  value: string;
  onChange(text: string): void;
  /** On a coloured panel: the raised surface instead of the control fill. */
  raised?: boolean;
}

/** Venue name, area or address search: filled input like Field (border on focus), a search icon in front and a clear button once typed. */
export function SearchBox({ value, onChange, raised = false }: SearchBoxProps) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);

  const type = (text: string) => {
    setDraft(text);
    cancel();
    timer.current = setTimeout(() => onChange(text), SEARCH_DEBOUNCE_MS);
  };
  const now = (text: string) => {
    cancel();
    setDraft(text);
    onChange(text);
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: t.controlLg,
        borderRadius: t.radiusMd,
        borderWidth: t.focusWidth,
        borderColor: focused ? t.primary : 'transparent',
        paddingLeft: t.space3,
        backgroundColor: raised ? t.bgSurfaceRaised : t.controlFill,
      }}
    >
      <Icon name="search" color={t.textMuted} />
      <TextInput
        value={draft}
        onChangeText={type}
        onSubmitEditing={() => now(draft)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={tr('search.text')}
        placeholder={tr('search.textPlaceholder')}
        placeholderTextColor={t.textSubtle}
        returnKeyType="search"
        autoCorrect={false}
        maxLength={MAX_SEARCH_TEXT}
        style={{
          flex: 1,
          paddingHorizontal: t.space2,
          paddingVertical: t.space2,
          color: t.textStrong,
          fontFamily: fontFamily('sans', 'regular', i18n.language),
          fontSize: t.textMd,
        }}
      />
      {draft ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('search.clearText')}
          onPress={() => now('')}
          style={{ width: t.controlLg, height: t.controlLg, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="close" color={t.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}
