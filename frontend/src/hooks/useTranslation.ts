import { useEffect, useState } from 'react';
import { i18n, type Language } from '@/services/i18n';

export function useTranslation() {
  const [language, setLanguage] = useState<Language>(i18n.getCurrentLanguage());

  useEffect(() => {
    const unsubscribe = i18n.subscribe((lang) => {
      setLanguage(lang);
    });
    return unsubscribe;
  }, []);

  return {
    language,
    t: (key: string, vars?: Record<string, string | number>) => i18n.t(key, vars),
  };
}

