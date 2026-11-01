import { describe, it, expect, afterEach } from 'vitest';
import i18n from '../src/i18n';

describe('<html lang>', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('follows the current language', async () => {
    await i18n.changeLanguage('ru');
    expect(document.documentElement.lang).toBe('ru');
    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
  });
});
