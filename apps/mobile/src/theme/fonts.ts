import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from '@expo-google-fonts/ibm-plex-sans';
import { IBMPlexSansCondensed_600SemiBold, IBMPlexSansCondensed_700Bold } from '@expo-google-fonts/ibm-plex-sans-condensed';
import {
  NotoSansBengali_400Regular,
  NotoSansBengali_500Medium,
  NotoSansBengali_600SemiBold,
  NotoSansBengali_700Bold,
} from '@expo-google-fonts/noto-sans-bengali';

export const fontAssets = {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
  IBMPlexSansCondensed_600SemiBold,
  IBMPlexSansCondensed_700Bold,
  NotoSansBengali_400Regular,
  NotoSansBengali_500Medium,
  NotoSansBengali_600SemiBold,
  NotoSansBengali_700Bold,
};

export type Weight = 'regular' | 'medium' | 'semibold' | 'bold';
export type FontKind = 'sans' | 'display';

const sans: Record<Weight, string> = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
};
const display: Record<Weight, string> = {
  regular: 'IBMPlexSansCondensed_600SemiBold',
  medium: 'IBMPlexSansCondensed_600SemiBold',
  semibold: 'IBMPlexSansCondensed_600SemiBold',
  bold: 'IBMPlexSansCondensed_700Bold',
};
const bengali: Record<Weight, string> = {
  regular: 'NotoSansBengali_400Regular',
  medium: 'NotoSansBengali_500Medium',
  semibold: 'NotoSansBengali_600SemiBold',
  bold: 'NotoSansBengali_700Bold',
};

/** Plex has no Bengali glyphs, so Bangla text uses Noto Sans Bengali for every kind. */
export function fontFamily(kind: FontKind, weight: Weight, language: string): string {
  if (language === 'bn') return bengali[weight];
  return (kind === 'display' ? display : sans)[weight];
}
