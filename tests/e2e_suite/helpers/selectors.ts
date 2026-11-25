import type { Locator, Page } from '@playwright/test';
import type { Sex } from './contracts';

/**
 * Resilient, semantic/role/label-driven locators derived strictly from
 * PROJECT.md § Interface Contracts. Zero Tailwind utility classes.
 */
export const Selectors = {
  // Home page (`/`)
  createSessionButton: (page: Page): Locator =>
    page.getByRole('button', { name: /create.*session/i }),

  joinCodeInput: (page: Page): Locator =>
    page
      .getByLabel(/session (code|id|link)/i)
      .or(page.getByPlaceholder(/session (code|id)/i))
      .first(),

  joinSessionByCodeButton: (page: Page): Locator =>
    page.getByRole('button', { name: /join/i }),

  // Staff Join screen (`/s/[id]`)
  staffLabelInput: (page: Page): Locator =>
    page
      .getByLabel(/name|label/i)
      .or(page.getByPlaceholder(/name|label|proctor|staff/i))
      .first(),

  staffJoinButton: (page: Page): Locator =>
    page.getByRole('button', { name: /join session|join/i }),

  // Shared / Queue submission form
  sexOption: (page: Page, sex: Sex): Locator => {
    const label = sex === 'M' ? /^male$/i : /^female$/i;
    return page
      .getByRole('radio', { name: label })
      .or(page.getByRole('button', { name: label }))
      .first();
  },

  sexSelectFallback: (page: Page): Locator =>
    page.getByRole('combobox', { name: /sex|gender/i }).first(),

  studentNumberInput: (page: Page): Locator =>
    page
      .getByLabel(/student (number|id)/i)
      .or(page.getByPlaceholder(/student/i))
      .first(),

  submitStudentButton: (page: Page): Locator =>
    page.getByRole('button', { name: /add|submit|join queue|enqueue/i }).first(),

  // Controller-specific controls
  overrideToggle: (page: Page): Locator =>
    page
      .getByLabel(/override/i)
      .or(page.getByRole('checkbox', { name: /override/i }))
      .or(page.getByRole('switch', { name: /override/i }))
      .first(),

  shareLinkTextOrInput: (page: Page): Locator =>
    page
      .locator('a[href*="/s/"], input[readonly][value*="/s/"], [data-share-url]')
      .or(page.getByText(/\/s\/[A-Za-z0-9_-]+/))
      .first(),

  qrElement: (page: Page): Locator =>
    page
      .locator(
        '[data-testid="qr-code"] img, [data-testid="qr-code"] svg, [data-testid="qr-code"] canvas, img[alt*="QR" i], svg[aria-label*="QR" i], canvas[aria-label*="QR" i]',
      )
      .or(page.getByRole('img', { name: /qr/i }))
      .first(),

  examStartInput: (page: Page): Locator =>
    page
      .getByLabel(/start time|exam start/i)
      .or(page.locator('input[type="datetime-local"]'))
      .first(),

  examDurationInput: (page: Page): Locator =>
    page
      .getByLabel(/duration/i)
      .or(page.getByPlaceholder(/minutes|duration/i))
      .first(),

  clockOffsetInput: (page: Page): Locator =>
    page.getByLabel(/clock offset|offset/i).first(),

  saveConfigButton: (page: Page): Locator =>
    page
      .getByRole('button', { name: /save.*config|update.*window|save.*time|apply.*config|set.*exam/i })
      .first(),

  clearSessionButton: (page: Page): Locator =>
    page.getByRole('button', { name: /clear session|reset session/i }).first(),

  confirmClearButton: (page: Page): Locator =>
    page
      .getByRole('button', { name: /confirm.*clear|yes.*clear|confirm|reset all/i })
      .first(),

  // Per-sex regions & rows
  sexSection: (page: Page, sex: Sex): Locator => {
    const nameRe = sex === 'M' ? /\bmale\b/i : /\bfemale\b/i;
    return page
      .locator(`[data-sex="${sex}"]`)
      .or(page.getByRole('region', { name: nameRe }))
      .or(
        page
          .locator('section, div[aria-label]')
          .filter({ has: page.getByRole('heading', { name: nameRe }) }),
      )
      .first();
  },

  studentRowInSection: (section: Locator, studentNumber: string): Locator =>
    section
      .locator('li, tr, [role="listitem"], [data-entry-id]')
      .filter({ hasText: studentNumber })
      .first(),

  // Occupancy panel inside sex section
  occupancyPanel: (section: Locator): Locator =>
    section
      .locator('[data-occupancy], [aria-label*="bathroom" i], [aria-label*="occupancy" i]')
      .or(section.getByText(/in bathroom|vacant|empty/i))
      .first(),

  // Alerts & status
  alertBanner: (page: Page): Locator => page.getByRole('alert'),

  muteToggleButton: (page: Page): Locator =>
    page
      .getByRole('button', { name: /mute|unmute|sound|audio/i })
      .or(page.getByRole('switch', { name: /mute|sound|audio/i }))
      .first(),

  windowStatusBadge: (page: Page): Locator =>
    page
      .locator('[data-window-status]')
      .or(
        page.getByText(
          /UNCONFIGURED|BEFORE START|FIRST 30|ALLOWED|OPEN|LAST 20|AFTER END|CLOSED|BLOCKED/i,
        ),
      )
      .first(),

  staffListRegion: (page: Page): Locator =>
    page
      .getByRole('region', { name: /staff|connected/i })
      .or(page.locator('[data-staff-list]'))
      .first(),
};
