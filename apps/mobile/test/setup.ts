jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../web/src/i18n/locales/en.json';

void i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } } });
