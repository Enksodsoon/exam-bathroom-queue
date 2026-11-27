"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppPreferences } from "./AppPreferencesProvider";
import { MoonIcon, SunIcon } from "./Icons";

export function ThemeLangToggle() {
  const pathname = usePathname();
  const { theme, toggleTheme, locale, toggleLocale, t } = useAppPreferences();
  const isGuide = pathname === "/guide";

  return (
    <div className="inline-flex items-center gap-1.5">
      {!isGuide && (
        <Link
          href="/guide"
          data-testid="guide-link"
          aria-label={t.guideAria}
          title={t.guideAria}
          className="inline-flex h-11 min-w-[44px] items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {t.guideLabel}
        </Link>
      )}
      <button
        type="button"
        data-testid="locale-toggle"
        onClick={toggleLocale}
        aria-label={t.switchLanguageLabel}
        title={t.switchLanguageLabel}
        className="inline-flex h-11 min-w-[44px] items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        {locale === "en" ? "ไทย" : "EN"}
      </button>

      <button
        type="button"
        data-testid="theme-toggle"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? t.switchToLight : t.switchToDark}
        title={theme === "dark" ? t.switchToLight : t.switchToDark}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-amber-300 dark:hover:bg-slate-700"
      >
        {theme === "dark" ? (
          <SunIcon className="h-4 w-4" />
        ) : (
          <MoonIcon className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
