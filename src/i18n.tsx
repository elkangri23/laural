import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en } from "./locales/en";
import { es } from "./locales/es";
import type { LocalizedCatalog } from "./locales/types";

export type Language = "es" | "en";
export type TranslationCatalog = LocalizedCatalog<typeof es>;
const LANGUAGE_KEY = "laural.language.v1";
const catalogs: Record<Language, TranslationCatalog> = { es, en };

export function isLanguage(value: string | null): value is Language {
  return value === "es" || value === "en";
}

export function detectLanguage(systemLanguage: string | undefined): Language {
  const normalized = systemLanguage?.toLowerCase() ?? "";
  if (normalized.startsWith("en")) return "en";
  return "es";
}

export function initialLanguage(): Language {
  const saved = localStorage.getItem(LANGUAGE_KEY);
  if (isLanguage(saved)) return saved;
  const detected = detectLanguage(navigator.language);
  localStorage.setItem(LANGUAGE_KEY, detected);
  return detected;
}

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  messages: TranslationCatalog;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  const setLanguage = useCallback((nextLanguage: Language) => {
    localStorage.setItem(LANGUAGE_KEY, nextLanguage);
    setLanguageState(nextLanguage);
  }, []);
  const value = useMemo(() => ({ language, setLanguage, messages: catalogs[language] }), [language, setLanguage]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage debe usarse dentro de LanguageProvider");
  return context;
}
