import { expect, type Page } from '@playwright/test';
import type { ViewportName } from './contracts';

export interface ErrorGuard {
  consoleErrors: string[];
  pageErrors: string[];
  assertZeroErrors: () => void;
}

export function attachErrorGuards(page: Page): ErrorGuard {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err.message || String(err));
  });

  return {
    consoleErrors,
    pageErrors,
    assertZeroErrors: () => {
      expect(
        consoleErrors,
        `Unexpected console.error messages: ${consoleErrors.join(' | ')}`,
      ).toEqual([]);
      expect(
        pageErrors,
        `Unexpected pageerror exceptions: ${pageErrors.join(' | ')}`,
      ).toEqual([]);
    },
  };
}

export interface ControlAuditIssue {
  tag: string;
  text: string;
  reason: string;
  rect: { left: number; right: number; width: number; height: number };
}

export async function assertResponsiveUsability(
  page: Page,
  viewportName: ViewportName | string,
  errorGuard?: ErrorGuard,
): Promise<void> {
  if (errorGuard) {
    errorGuard.assertZeroErrors();
  }

  const audit = await page.evaluate(() => {
    const innerWidth = window.innerWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const issues: ControlAuditIssue[] = [];

    const controls = Array.from(
      document.querySelectorAll('button, a, input, select, textarea'),
    );

    for (const el of controls) {
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      ) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        continue;
      }

      const tag = el.tagName.toLowerCase();
      const label =
        (el.getAttribute('aria-label') || el.textContent || '')
          .trim()
          .slice(0, 40) || tag;

      // Skip hidden sr-only elements
      if (rect.width <= 2 && rect.height <= 2) {
        continue;
      }

      if (rect.width < 24 || rect.height < 24) {
        issues.push({
          tag,
          text: label,
          reason: `too small (${Math.round(rect.width)}x${Math.round(rect.height)})`,
          rect: {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height,
          },
        });
      }
      if (rect.left < -1 || rect.right > innerWidth + 1) {
        issues.push({
          tag,
          text: label,
          reason: `outside viewport [${Math.round(rect.left)}..${Math.round(rect.right)}] vs ${innerWidth}`,
          rect: {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height,
          },
        });
      }
    }

    return { innerWidth, scrollWidth, issues };
  });

  expect(
    audit.scrollWidth,
    `[${viewportName}] Horizontal overflow detected: scrollWidth=${audit.scrollWidth} > innerWidth=${audit.innerWidth}`,
  ).toBeLessThanOrEqual(audit.innerWidth + 1);

  expect(
    audit.issues,
    `[${viewportName}] Unusable controls: ${JSON.stringify(audit.issues)}`,
  ).toEqual([]);
}
