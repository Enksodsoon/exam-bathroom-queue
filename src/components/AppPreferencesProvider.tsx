"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  TRANSLATIONS,
  type Locale,
  type Translations,
} from "@/lib/i18n/translations";

export type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "examq_theme";
const LOCALE_STORAGE_KEY = "examq_locale";
const PREFS_EVENT = "examq-prefs-change";

interface AppPreferencesContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: Translations;
}

const AppPreferencesContext = createContext<AppPreferencesContextValue | null>(
  null,
);

function subscribePrefs(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === null ||
      e.key === THEME_STORAGE_KEY ||
      e.key === LOCALE_STORAGE_KEY
    ) {
      callback();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(PREFS_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(PREFS_EVENT, callback);
  };
}

function getThemeSnapshot(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
    if (window.matchMedia?.("(prefers-color-scheme: dark)")?.matches) {
      return "dark";
    }
  } catch {
    // Ignore storage errors
  }
  return "light";
}

function getLocaleSnapshot(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === "th" || saved === "en") return saved;
  } catch {
    // Ignore storage errors
  }
  return "en";
}

function applyThemeToDocument(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore<Theme>(
    subscribePrefs,
    getThemeSnapshot,
    () => "light",
  );
  const locale = useSyncExternalStore<Locale>(
    subscribePrefs,
    getLocaleSnapshot,
    () => "en",
  );

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setTheme = useCallback((next: Theme) => {
    applyThemeToDocument(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
      window.dispatchEvent(new Event(PREFS_EVENT));
    } catch {
      // Ignore
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = getThemeSnapshot() === "dark" ? "light" : "dark";
    setTheme(next);
  }, [setTheme]);

  const setLocale = useCallback((next: Locale) => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
    }
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
      window.dispatchEvent(new Event(PREFS_EVENT));
    } catch {
      // Ignore
    }
  }, []);

  const toggleLocale = useCallback(() => {
    const next: Locale = getLocaleSnapshot() === "en" ? "th" : "en";
    setLocale(next);
  }, [setLocale]);

  return (
    <AppPreferencesContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme,
        locale,
        setLocale,
        toggleLocale,
        t: TRANSLATIONS[locale],
      }}
    >
      {children}
    </AppPreferencesContext.Provider>
  );
}

export function useAppPreferences(): AppPreferencesContextValue {
  const ctx = useContext(AppPreferencesContext);
  if (!ctx) {
    return {
      theme: "light",
      setTheme: () => {},
      toggleTheme: () => {},
      locale: "en",
      setLocale: () => {},
      toggleLocale: () => {},
      t: TRANSLATIONS.en,
    };
  }
  return ctx;
}
