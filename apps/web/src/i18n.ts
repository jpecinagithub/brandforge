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
        common: { ...en.common, ...enEnhancements.common },
        nav: { ...en.nav, ...enEnhancements.nav },
        agent: { ...en.agent, ...enEnhancements.agent },
        dashboard: { ...en.dashboard, ...enEnhancements.dashboard },
        landing: { ...en.landing, ...enEnhancements.landing },
        profile: { ...en.profile, ...enEnhancements.profile },
        newCampaignModal: { ...en.newCampaignModal, ...enEnhancements.newCampaignModal },
        workspace: { ...en.workspace, ...enEnhancements.workspace },
      },
    },
    es: {
      translation: {
        ...es,
        common: { ...es.common, ...esEnhancements.common },
        nav: { ...es.nav, ...esEnhancements.nav },
        agent: { ...es.agent, ...esEnhancements.agent },
        dashboard: { ...es.dashboard, ...esEnhancements.dashboard },
        landing: { ...es.landing, ...esEnhancements.landing },
        profile: { ...es.profile, ...esEnhancements.profile },
        newCampaignModal: { ...es.newCampaignModal, ...esEnhancements.newCampaignModal },
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
