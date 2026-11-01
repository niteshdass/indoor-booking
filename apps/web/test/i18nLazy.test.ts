import { describe, it, expect } from 'vitest';
import i18n from '../src/i18n';
import ru from '../src/i18n/locales/ru.json';
import bn from '../src/i18n/locales/bn.json';

describe('lazy locales', () => {
  it('ships only English up front and fetches Russian when picked', async () => {
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
    await i18n.changeLanguage('ru');
    expect(i18n.t('nav.skip')).toBe(ru.nav.skip);
    await i18n.changeLanguage('en');
  });
  it('fetches Bangla when picked', async () => {
    await i18n.changeLanguage('bn');
    expect(i18n.t('nav.skip')).toBe(bn.nav.skip);
    expect(i18n.t('language.bn')).toBe('বাংলা');
    await i18n.changeLanguage('en');
  });
});
