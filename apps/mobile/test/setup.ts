jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../web/src/i18n/locales/en.json';

void i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } } });

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
// The SVG QR adds nothing to assertions; render a plain stand-in.
jest.mock('react-native-qrcode-svg', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return { __esModule: true, default: (p: { value: string }) => createElement(View, { testID: 'qr', accessibilityHint: p.value }) };
});
