export type Language = 'en' | 'zh';

type Translations = Record<string, string>;

type Listener = (language: Language) => void;

class I18nService {
  private currentLanguage: Language = 'en';
  private translations: Record<Language, Translations> = {
    en: {},
    zh: {},
  };
  private loaded: Record<Language, boolean> = {
    en: false,
    zh: false,
  };
  private listeners = new Set<Listener>();

  private notify() {
    for (const listener of this.listeners) {
      listener(this.currentLanguage);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async fetchTranslations(lang: Language): Promise<void> {
    if (this.loaded[lang]) {
      return;
    }

    try {
      const response = await fetch(`/locales/${lang}.json`);
      if (!response.ok) {
        throw new Error(`Failed to load ${lang} translations (${response.status})`);
      }
      this.translations[lang] = await response.json();
      this.loaded[lang] = true;
    } catch (error) {
      console.error(`Failed to load ${lang} translations:`, error);
    }
  }

  async setLanguage(lang: Language): Promise<void> {
    await this.fetchTranslations(lang);
    this.currentLanguage = lang;
    this.notify();
  }

  getCurrentLanguage(): Language {
    return this.currentLanguage;
  }

  t(key: string, vars?: Record<string, string | number>): string {
    const lang = this.currentLanguage;
    const value =
      this.translations[lang]?.[key] ??
      this.translations.en?.[key] ??
      key;

    if (!vars) {
      return value;
    }

    return Object.entries(vars).reduce(
      (acc, [varKey, varValue]) =>
        acc.replace(new RegExp(`{{\\s*${varKey}\\s*}}`, 'g'), String(varValue)),
      value,
    );
  }
}

export const i18n = new I18nService();
