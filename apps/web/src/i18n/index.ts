import i18n, { type BackendModule, type ResourceKey } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';

export const SUPPORTED_LANGUAGES = ['en', 'ru', 'bn'] as const;
const STORAGE_KEY = 'lang';

function storedLanguage(): string | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && (SUPPORTED_LANGUAGES as readonly string[]).includes(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** English ships in the main bundle; other languages are fetched the first time they're picked. */
const lazyLocales: BackendModule = {
  type: 'backend',
  init() {},
  read(language, _namespace, callback) {
    const load: Record<string, () => Promise<{ default: ResourceKey }>> = {
      ru: () => import('./locales/ru.json'),
      bn: () => import('./locales/bn.json'),
    };
    const loader = load[language];
    if (!loader) return callback(null, {});
    loader().then(
      (m) => callback(null, m.default),
      (err: Error) => callback(err, false),
    );
  },
};

/** Resolves once the starting language is loaded; render after it so a Russian or Bangla visitor never sees English first. */
export const i18nReady = i18n
  .use(lazyLocales)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    lng: storedLanguage() ?? 'en',
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    interpolation: { escapeValue: false },
  });

function setDocumentLang(lng: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
}

setDocumentLang(i18n.language);

i18n.on('languageChanged', (lng) => {
  setDocumentLang(lng);
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // Storage unavailable (private mode etc.) — language just won't persist.
  }
});

export default i18n;
