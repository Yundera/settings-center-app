import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import frenchMessages from "ra-language-french";
import type {PanelInterface} from "../PanelInterface";
import type {TranslationMessages} from "react-admin";

type I18nStore = Record<string, TranslationMessages>;

/**
 * Builds the react-admin i18n provider from the base `ra-language-*` messages
 * plus one `resources.<panel>.name` entry per panel (that is where the sidebar
 * labels come from — see definePanel).
 */
export const i18nProvider = (panels: PanelInterface[]) => {
  let i18n: I18nStore = {};

  return polyglotI18nProvider(locale=> {
    if (Object.keys(i18n).length === 0) {
      // Initialize with default translations
      i18n = {
        fr: { ...frenchMessages, resources: {} },
        en: { ...englishMessages, resources: {} }
      };

      // Add panel translations
      for (const panel of panels) {
        if (panel.i18n && panel.name) {
          for (const panelLocale of Object.keys(panel.i18n)) {
            if (!i18n[panelLocale]) {
              i18n[panelLocale] = { resources: {} } as unknown as TranslationMessages;
            }
            (i18n[panelLocale] as any).resources[panel.name] = panel.i18n[panelLocale];
          }
        }
      }
    }

    return i18n[locale] || i18n['en']; // Fallback to English if locale not found
  }, 'en', [
    { locale: 'en', name: 'English' },
    { locale: 'fr', name: 'Français' }
  ]);
};
