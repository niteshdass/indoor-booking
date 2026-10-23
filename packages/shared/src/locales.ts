export const LOCALES = ['en', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];
