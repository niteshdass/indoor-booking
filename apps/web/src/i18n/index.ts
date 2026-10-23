import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import bn from './locales/bn.json';

export const SUPPORTED_LANGUAGES = ['en', 'bn'] as const;
const STORAGE_KEY = 'lang';

function storedLanguage(): string | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && (SUPPORTED_LANGUAGES as readonly string[]).includes(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, bn: { translation: bn } },
  lng: storedLanguage() ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // Storage unavailable (private mode etc.) — language just won't persist.
  }
});

export default i18n;
