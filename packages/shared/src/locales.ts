export const LOCALES = ['en', 'ru', 'bn'] as const;
export type Locale = (typeof LOCALES)[number];
