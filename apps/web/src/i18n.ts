import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './i18n/en.json';
import es from './i18n/es.json';
import { enEnhancements, esEnhancements } from './i18n/enhancements';

const STORAGE_KEY = 'bf_language';

export const supportedLanguages = ['en', 'es'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export function getStoredLanguage(): SupportedLanguage {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'es' || stored === 'en') return stored;
  const nav = navigator.language?.toLowerCase() ?? '';
  return nav.startsWith('es') ? 'es' : 'en';
}

export function setStoredLanguage(lng: SupportedLanguage): void {
  localStorage.setItem(STORAGE_KEY, lng);
}

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      translation: {
        ...en,
        agent: { ...en.agent, ...enEnhancements.agent },
        workspace: { ...en.workspace, ...enEnhancements.workspace },
      },
    },
    es: {
      translation: {
        ...es,
        agent: { ...es.agent, ...esEnhancements.agent },
        workspace: { ...es.workspace, ...esEnhancements.workspace },
      },
    },
  },
  lng: getStoredLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  setStoredLanguage(lng as SupportedLanguage);
});

document.documentElement.lang = i18n.language;

export default i18n;
