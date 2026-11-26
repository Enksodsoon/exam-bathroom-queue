import { expect, type Page } from '@playwright/test';
import type { Sex } from './contracts';
import { Selectors } from './selectors';

function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class HomePage {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(Selectors.createSessionButton(this.page)).toBeVisible();
  }

  async createSession(): Promise<{
    sessionId: string;
    controllerKey: string;
    controllerUrl: string;
  }> {
    await Selectors.createSessionButton(this.page).click();
    await this.page.waitForURL(/\/s\/[A-Za-z0-9_-]+/);
    const url = new URL(this.page.url());
    const match = url.pathname.match(/\/s\/([^/]+)/);
    const sessionId = match?.[1] ?? '';
    const controllerKey =
      url.searchParams.get('key') ||
      (await this.page.evaluate((sid) => {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.includes(sid) && k.toLowerCase().includes('key')) {
            return sessionStorage.getItem(k) || '';
          }
        }
        return '';
      }, sessionId));
    expect(sessionId.length).toBeGreaterThan(0);
    return {
      sessionId,
      controllerKey,
      controllerUrl: this.page.url(),
    };
  }

  async joinByCode(codeOrUrl: string): Promise<void> {
    await Selectors.joinCodeInput(this.page).fill(codeOrUrl);
    await Selectors.joinSessionByCodeButton(this.page).click();
    await this.page.waitForURL(/\/s\/[A-Za-z0-9_-]+/);
  }
}

export class ControllerPage {
  constructor(readonly page: Page) {}

  async goto(sessionId: string, controllerKey?: string): Promise<void> {
    const path = controllerKey
      ? `/s/${encodeURIComponent(sessionId)}?key=${encodeURIComponent(controllerKey)}`
      : `/s/${encodeURIComponent(sessionId)}`;
    await this.page.goto(path);
    await expect(Selectors.clearSessionButton(this.page)).toBeVisible();
  }

  async getShareUrl(): Promise<string> {
    const el = Selectors.shareLinkTextOrInput(this.page);
    if ((await el.count()) === 0 || !(await el.isVisible())) {
      const qrToggle = this.page.getByRole('button', { name: /share qr code/i });
      if ((await qrToggle.count()) > 0) {
        await qrToggle.click();
      }
    }
    await expect(el).toBeVisible();
    const tag = await el.evaluate((node) => node.tagName.toLowerCase());
    if (tag === 'input') {
      return (await el.inputValue()).trim();
    }
    if (tag === 'a') {
      const href = await el.getAttribute('href');
      if (href) {
        return new URL(href, this.page.url()).toString();
      }
    }
    const attr = await el.getAttribute('data-share-url');
    if (attr) return attr.trim();
    return (await el.innerText()).trim();
  }

  async configureExam(params: {
    startTimeMs: number;
    durationMinutes: number;
    clockOffsetMinutes?: number;
  }): Promise<void> {
    const startInput = Selectors.examStartInput(this.page);
    if ((await startInput.count()) === 0 || !(await startInput.isVisible())) {
      const timerToggle = this.page.getByRole('button', { name: /exam timer settings/i });
      if ((await timerToggle.count()) > 0) {
        await timerToggle.click();
      }
    }
    await startInput.fill(toDatetimeLocalValue(params.startTimeMs));
    await Selectors.examDurationInput(this.page).fill(
      String(params.durationMinutes),
    );
    if (params.clockOffsetMinutes !== undefined) {
      const offsetInput = Selectors.clockOffsetInput(this.page);
      if ((await offsetInput.count()) > 0) {
        await offsetInput.fill(String(params.clockOffsetMinutes));
      }
    }
    await Selectors.saveConfigButton(this.page).click();
  }

  async selectSex(sex: Sex): Promise<void> {
    const opt = Selectors.sexOption(this.page, sex);
    if ((await opt.count()) > 0) {
      await opt.click();
      return;
    }
    const sel = Selectors.sexSelectFallback(this.page);
    await sel.selectOption(sex);
  }

  async setOverride(enabled: boolean): Promise<void> {
    const toggle = Selectors.overrideToggle(this.page);
    await expect(toggle).toBeVisible();
    const checked = await toggle.isChecked().catch(async () => {
      const aria = await toggle.getAttribute('aria-checked');
      return aria === 'true';
    });
    if (checked !== enabled) {
      await toggle.click();
    }
  }

  async submitStudent(
    sex: Sex,
    studentNumber: string,
    options?: { override?: boolean },
  ): Promise<void> {
    if (options?.override !== undefined) {
      await this.setOverride(options.override);
    }
    await this.selectSex(sex);
    await Selectors.studentNumberInput(this.page).fill(studentNumber);
    await Selectors.submitStudentButton(this.page).click();
  }

  async enterStudent(
    sex: Sex,
    studentNumber: string,
    options?: { override?: boolean },
  ): Promise<void> {
    if (options?.override !== undefined) {
      await this.setOverride(options.override);
    }
    const section = Selectors.sexSection(this.page, sex);
    const row = Selectors.studentRowInSection(section, studentNumber);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /enter/i }).click();
  }

  async returnStudent(sex: Sex, studentNumber: string): Promise<void> {
    const section = Selectors.sexSection(this.page, sex);
    const btn = section
      .getByRole('button', { name: /return/i })
      .first();
    await expect(section).toContainText(studentNumber);
    await btn.click();
  }

  async moveUp(sex: Sex, studentNumber: string): Promise<void> {
    const section = Selectors.sexSection(this.page, sex);
    const row = Selectors.studentRowInSection(section, studentNumber);
    await row.getByRole('button', { name: /up/i }).click();
  }

  async moveDown(sex: Sex, studentNumber: string): Promise<void> {
    const section = Selectors.sexSection(this.page, sex);
    const row = Selectors.studentRowInSection(section, studentNumber);
    await row.getByRole('button', { name: /down/i }).click();
  }

  async removeStudent(sex: Sex, studentNumber: string): Promise<void> {
    const section = Selectors.sexSection(this.page, sex);
    const row = Selectors.studentRowInSection(section, studentNumber);
    await row.getByRole('button', { name: /remove|cancel/i }).click();
  }

  async clearSession(): Promise<void> {
    const dialogHandler = (dialog: { accept: () => Promise<void> }) => {
      void dialog.accept();
    };
    this.page.once('dialog', dialogHandler);
    await Selectors.clearSessionButton(this.page).click();

    // Also handle custom in-page confirmation modal/button if rendered
    const confirmBtn = Selectors.confirmClearButton(this.page);
    try {
      await confirmBtn.waitFor({ state: 'visible', timeout: 1000 });
      await confirmBtn.click();
    } catch {
      // Native dialog or single-click confirm already completed
    } finally {
      this.page.off('dialog', dialogHandler);
    }
  }

  async expectInBathroom(sex: Sex, studentNumber: string): Promise<void> {
    const section = Selectors.sexSection(this.page, sex);
    await expect(Selectors.occupancyPanel(section)).toContainText(studentNumber);
  }

  async expectVacant(sex: Sex): Promise<void> {
    const section = Selectors.sexSection(this.page, sex);
    await expect(Selectors.occupancyPanel(section)).toContainText(
      /vacant|empty|none|available/i,
    );
  }

  async expectQueuedVisible(sex: Sex, studentNumber: string): Promise<void> {
    const section = Selectors.sexSection(this.page, sex);
    await expect(
      Selectors.studentRowInSection(section, studentNumber),
    ).toBeVisible();
  }

  async expectQueuedOrder(sex: Sex, studentNumbers: string[]): Promise<void> {
    const section = Selectors.sexSection(this.page, sex);
    await expect(async () => {
      const text = await section.innerText();
      let prevIdx = -1;
      for (const num of studentNumbers) {
        const idx = text.indexOf(num, prevIdx + 1);
        expect(idx, `Expected ${num} in order in ${sex} section`).toBeGreaterThan(
          prevIdx,
        );
        prevIdx = idx;
      }
    }).toPass();
  }

  async expectStaffListed(label: string): Promise<void> {
    const region = Selectors.staffListRegion(this.page);
    if ((await region.count()) === 0 || !(await region.isVisible())) {
      const staffToggle = this.page.getByRole('button', { name: /connected staff/i });
      if ((await staffToggle.count()) > 0) {
        await staffToggle.click();
      }
    }
    await expect(region).toContainText(label);
  }

  async expectWindowStatus(pattern: RegExp): Promise<void> {
    await expect(Selectors.windowStatusBadge(this.page)).toContainText(pattern);
  }
}

export class StaffPage {
  constructor(readonly page: Page) {}

  async goto(joinUrl: string): Promise<void> {
    await this.page.goto(joinUrl);
  }

  async join(label: string): Promise<void> {
    await expect(Selectors.staffLabelInput(this.page)).toBeVisible();
    await Selectors.staffLabelInput(this.page).fill(label);
    await Selectors.staffJoinButton(this.page).click();
    await expect(Selectors.studentNumberInput(this.page)).toBeVisible();
  }

  async selectSex(sex: Sex): Promise<void> {
    const opt = Selectors.sexOption(this.page, sex);
    if ((await opt.count()) > 0) {
      await opt.click();
      return;
    }
    await Selectors.sexSelectFallback(this.page).selectOption(sex);
  }

  async submitStudent(sex: Sex, studentNumber: string): Promise<void> {
    await this.selectSex(sex);
    await Selectors.studentNumberInput(this.page).fill(studentNumber);
    await Selectors.submitStudentButton(this.page).click();
  }

  async toggleMute(): Promise<void> {
    const btn = Selectors.muteToggleButton(this.page);
    await expect(btn).toBeVisible();
    await btn.click();
  }

  async expectAlertContains(pattern: string | RegExp): Promise<void> {
    await expect(Selectors.alertBanner(this.page).first()).toContainText(
      pattern,
    );
  }

  async expectInBathroom(sex: Sex, studentNumber: string): Promise<void> {
    const section = Selectors.sexSection(this.page, sex);
    await expect(Selectors.occupancyPanel(section)).toContainText(studentNumber);
  }

  async expectVacant(sex: Sex): Promise<void> {
    const section = Selectors.sexSection(this.page, sex);
    await expect(Selectors.occupancyPanel(section)).toContainText(
      /vacant|empty|none|available/i,
    );
  }

  async expectQueuedVisible(sex: Sex, studentNumber: string): Promise<void> {
    const section = Selectors.sexSection(this.page, sex);
    await expect(
      Selectors.studentRowInSection(section, studentNumber),
    ).toBeVisible();
  }

  async expectQueuedAbsent(sex: Sex, studentNumber: string): Promise<void> {
    const section = Selectors.sexSection(this.page, sex);
    await expect(
      Selectors.studentRowInSection(section, studentNumber),
    ).toHaveCount(0);
  }

  async expectQueuedOrder(sex: Sex, studentNumbers: string[]): Promise<void> {
    const section = Selectors.sexSection(this.page, sex);
    await expect(async () => {
      const text = await section.innerText();
      let prevIdx = -1;
      for (const num of studentNumbers) {
        const idx = text.indexOf(num, prevIdx + 1);
        expect(idx, `Expected ${num} in order in ${sex} section`).toBeGreaterThan(
          prevIdx,
        );
        prevIdx = idx;
      }
    }).toPass();
  }

  async expectWindowStatus(pattern: RegExp): Promise<void> {
    await expect(Selectors.windowStatusBadge(this.page)).toContainText(pattern);
  }
}
