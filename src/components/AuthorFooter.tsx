"use client";

import { useAppPreferences } from "./AppPreferencesProvider";

export function AuthorFooter() {
  const { t } = useAppPreferences();

  return (
    <footer
      data-testid="author-footer"
      className="mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-slate-500 dark:text-slate-400"
    >
      <span>
        {t.copyrightNotice} · {t.authorRole}
      </span>
      <span aria-hidden="true">·</span>
      <a
        href="https://github.com/Enksodsoon"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-[44px] items-center font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-900 dark:text-slate-300 dark:decoration-slate-600 dark:hover:text-white"
      >
        GitHub
      </a>
    </footer>
  );
}
