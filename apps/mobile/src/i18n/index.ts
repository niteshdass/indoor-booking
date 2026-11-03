import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import bn from '../../../web/src/i18n/locales/bn.json';
import en from '../../../web/src/i18n/locales/en.json';
import ru from '../../../web/src/i18n/locales/ru.json';

export const SUPPORTED_LANGUAGES = ['en', 'ru', 'bn'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
const STORAGE_KEY = 'lang';

const isSupported = (value: string | null | undefined): value is Language =>
  !!value && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);

async function pickLanguage(): Promise<Language> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (isSupported(stored)) return stored;
  } catch {
    // Keystore unavailable: fall through to the device language.
  }
  const device = getLocales()[0]?.languageCode;
  return isSupported(device) ? device : 'en';
}

/** Stored choice, else the device language, else English. */
export async function initI18n(): Promise<void> {
  const lng = await pickLanguage();
  await i18n.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    resources: { en: { translation: en }, ru: { translation: ru }, bn: { translation: bn } },
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export async function setLanguage(lng: Language): Promise<void> {
  await i18n.changeLanguage(lng);
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, lng);
  } catch {
    // The choice still applies for this session.
  }
}

export default i18n;
