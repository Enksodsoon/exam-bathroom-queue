import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  ExamQApiClient,
  createConfiguredSession,
} from './helpers/apiClient';
import { attachErrorGuards, type ErrorGuard } from './helpers/layoutAudit';
import { ControllerPage, StaffPage } from './helpers/sessionPages';

test.use({ channel: 'chromium' });

interface RecordedNotification {
  title: string;
  tag: string | undefined;
  silent: boolean | null | undefined;
  renotify: boolean | undefined;
  dataUrl: string | undefined;
}

async function installNotificationSpy(
  ctx: BrowserContext,
  options?: { hidden?: boolean },
): Promise<void> {
  await ctx.grantPermissions(['notifications']);
  await ctx.addInitScript(
    ({ hidden }: { hidden: boolean }) => {
      const recorded: RecordedNotification[] = [];
      (window as unknown as Record<string, unknown>).__examqRecordedNotifications =
        recorded;

      if (hidden) {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
      }

      if (
        typeof ServiceWorkerRegistration !== 'undefined' &&
        ServiceWorkerRegistration.prototype
      ) {
        const origShow = ServiceWorkerRegistration.prototype.showNotification;
        ServiceWorkerRegistration.prototype.showNotification = function (
          title: string,
          opts?: NotificationOptions & { renotify?: boolean },
        ) {
          recorded.push({
            title,
            tag: opts?.tag,
            silent: opts?.silent,
            renotify: opts?.renotify,
            dataUrl:
              opts?.data && typeof opts.data === 'object'
                ? (opts.data as { url?: string }).url
                : undefined,
          });
          return origShow.call(this, title, opts);
        };
      }
    },
    { hidden: Boolean(options?.hidden) },
  );
}

async function readAlertStats(page: Page): Promise<{
  seqAttr: number;
  visualAlertCount: number;
  lastAlertSeq: number;
}> {
  return page.evaluate(() => {
    const telemetry = document.querySelector('[data-testid="alert-telemetry"]');
    const seqAttr = Number(
      telemetry?.getAttribute('data-last-alert-seq') ?? '0',
    );
    const stats = (
      window as unknown as {
        __examqAlertStats?: { visualAlertCount?: number; lastAlertSeq?: number };
      }
    ).__examqAlertStats;
    return {
      seqAttr: Number.isFinite(seqAttr) ? seqAttr : 0,
      visualAlertCount: stats?.visualAlertCount ?? 0,
      lastAlertSeq: stats?.lastAlertSeq ?? 0,
    };
  });
}

async function readRecordedNotifications(
  page: Page,
): Promise<RecordedNotification[]> {
  return page.evaluate(() => {
    const list = (
      window as unknown as {
        __examqRecordedNotifications?: RecordedNotification[];
      }
    ).__examqRecordedNotifications;
    return list ? [...list] : [];
  });
}

async function submitStudentConfirmed(
  staff: StaffPage,
  sex: 'M' | 'F',
  studentNumber: string,
): Promise<void> {
  await staff.submitStudent(sex, studentNumber);
  await expect(
    staff.page
      .locator('[role="status"]')
      .filter({ hasText: `#${studentNumber} added` }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    staff.page
      .getByRole('button', { name: /add|submit|join queue|enqueue/i })
      .first(),
  ).toBeEnabled({ timeout: 15_000 });
  await staff.expectQueuedVisible(sex, studentNumber);
}

test.describe('Tier 3 — Consecutive Return-to-Ready Alerts Across Controller, Staff & Service Worker', () => {
  test('T3-RET-01: Consecutive return-to-ready turns alert Controller + multiple Staff (including mid-turn joiner, ack/dismiss, and hidden-tab SW showNotification)', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const contexts: BrowserContext[] = [];
    const guards: ErrorGuard[] = [];
    const server5xx: string[] = [];

    const trackServerErrors = (page: Page) => {
      page.on('response', (res) => {
        if (res.status() >= 500) {
          server5xx.push(`${res.status()} ${res.url()}`);
        }
      });
    };

    try {
      const ctrlCtx = await browser.newContext();
      contexts.push(ctrlCtx);
      await installNotificationSpy(ctrlCtx);
      const ctrlPage = await ctrlCtx.newPage();
      guards.push(attachErrorGuards(ctrlPage));
      trackServerErrors(ctrlPage);
      const ctrl = new ControllerPage(ctrlPage);
      await ctrl.goto(s.sessionId, s.controllerKey);

      const staff1Ctx = await browser.newContext();
      contexts.push(staff1Ctx);
      await installNotificationSpy(staff1Ctx);
      const staff1Page = await staff1Ctx.newPage();
      guards.push(attachErrorGuards(staff1Page));
      trackServerErrors(staff1Page);
      const staff1 = new StaffPage(staff1Page);
      await staff1.goto(`/s/${s.sessionId}`);
      await staff1.join('Proctor 1');

      const staff2Ctx = await browser.newContext();
      contexts.push(staff2Ctx);
      await installNotificationSpy(staff2Ctx, { hidden: true });
      const staff2Page = await staff2Ctx.newPage();
      guards.push(attachErrorGuards(staff2Page));
      trackServerErrors(staff2Page);
      const staff2 = new StaffPage(staff2Page);
      await staff2.goto(`/s/${s.sessionId}`);
      await staff2.join('Hidden Proctor 2');

      // Verify Notification.permission === 'granted' and SW /sw.js is registered & active
      await expect(async () => {
        const readyState = await staff2Page.evaluate(async () => {
          const reg = await navigator.serviceWorker.ready;
          return {
            permission: Notification.permission,
            activeScript: reg.active?.scriptURL ?? '',
          };
        });
        expect(readyState.permission).toBe('granted');
        expect(readyState.activeScript).toContain('/sw.js');
      }).toPass({ timeout: 10_000 });

      // Seed Male (R-M1, R-M2, R-M3) and Female (R-F1, R-F2) queues sequentially,
      // waiting for each submission confirmation before typing the next student.
      await submitStudentConfirmed(staff1, 'M', 'R-M1');
      await submitStudentConfirmed(staff1, 'M', 'R-M2');
      await submitStudentConfirmed(staff1, 'M', 'R-M3');
      await submitStudentConfirmed(staff1, 'F', 'R-F1');
      await submitStudentConfirmed(staff1, 'F', 'R-F2');

      // Wait for all 3 initial clients to converge to seq 2 (R-F1 head)
      for (const page of [ctrlPage, staff1Page, staff2Page]) {
        await expect(async () => {
          const stats = await readAlertStats(page);
          expect(stats.seqAttr).toBe(2);
        }).toPass({ timeout: 15_000 });
      }

      // Enter R-M1 -> R-M2 becomes head (seq 3)
      await ctrl.enterStudent('M', 'R-M1');
      await expect(async () => {
        expect((await readAlertStats(ctrlPage)).seqAttr).toBe(3);
        expect((await readAlertStats(staff1Page)).seqAttr).toBe(3);
      }).toPass({ timeout: 15_000 });
      await staff1.expectAlertContains('R-M2');

      // Staff 1 acknowledges seq 3 and Controller dismisses the banner while R-M1 is still in_bathroom
      await staff1Page.getByTestId('alert-acknowledge-button').click();
      await expect(staff1Page.getByTestId('alert-covered-by')).toContainText(
        'Proctor 1',
      );
      await ctrlPage
        .getByTestId('next-student-alert')
        .getByRole('button', { name: 'Dismiss' })
        .click();
      await expect(ctrlPage.getByTestId('next-student-alert')).toHaveCount(0);

      // Mid-turn Staff 3 joins while R-M1 is in_bathroom (starts at seq 3 with 0 visual alerts)
      const staff3Ctx = await browser.newContext();
      contexts.push(staff3Ctx);
      await installNotificationSpy(staff3Ctx);
      const staff3Page = await staff3Ctx.newPage();
      guards.push(attachErrorGuards(staff3Page));
      trackServerErrors(staff3Page);
      const staff3 = new StaffPage(staff3Page);
      await staff3.goto(`/s/${s.sessionId}`);
      await staff3.join('MidTurn Proctor 3');
      await expect(async () => {
        const s3 = await readAlertStats(staff3Page);
        expect(s3.seqAttr).toBe(3);
        expect(s3.visualAlertCount).toBe(0);
      }).toPass({ timeout: 15_000 });

      const preReturnCtrlVisual = (await readAlertStats(ctrlPage)).visualAlertCount;
      const preReturnStaff1Visual = (await readAlertStats(staff1Page)).visualAlertCount;
      const preReturnStaff2Visual = (await readAlertStats(staff2Page)).visualAlertCount;

      // RETURN TURN 1: R-M1 returns -> R-M2 becomes ready -> seq 4 across all 4 clients!
      await ctrl.returnStudent('M', 'R-M1');

      for (const [page, prevVisual] of [
        [ctrlPage, preReturnCtrlVisual],
        [staff1Page, preReturnStaff1Visual],
        [staff2Page, preReturnStaff2Visual],
        [staff3Page, 0],
      ] as const) {
        await expect(async () => {
          const stats = await readAlertStats(page);
          expect(stats.seqAttr).toBe(4);
          expect(stats.visualAlertCount).toBeGreaterThan(prevVisual);
        }).toPass({ timeout: 15_000 });
        await expect(page.getByTestId('next-student-alert')).toContainText('R-M2');
        await expect(page.getByTestId('alert-covered-by')).toHaveCount(0);
      }

      // Verify hidden Staff 2 emitted SW notification for seq 4 with matching per-turn tag & data.url
      await expect(async () => {
        const notes = await readRecordedNotifications(staff2Page);
        const match = notes.find(
          (n) => n.tag === `examq-next-${s.sessionId}-M-4`,
        );
        expect(match).toBeDefined();
        expect(match?.silent).toBe(true);
        expect(match?.renotify).toBeUndefined();
        expect(match?.dataUrl).toBe(`/s/${encodeURIComponent(s.sessionId)}`);
      }).toPass({ timeout: 15_000 });

      // ENTER & RETURN TURN 2: R-M2 enters (seq 5), Controller acks seq 5, R-M2 returns -> R-M3 ready (seq 6)
      await ctrl.enterStudent('M', 'R-M2');
      await expect(async () => {
        const stats = await readAlertStats(ctrlPage);
        expect(stats.seqAttr).toBe(5);
      }).toPass({ timeout: 15_000 });
      await expect(ctrlPage.getByTestId('next-student-alert')).toContainText(
        'R-M3',
      );
      await expect(ctrlPage.getByTestId('alert-acknowledge-button')).toBeVisible();
      await ctrlPage.getByTestId('alert-acknowledge-button').click();
      await expect(ctrlPage.getByTestId('alert-covered-by')).toContainText(
        'Controller',
      );

      const preTurn2Visuals = await Promise.all(
        [ctrlPage, staff1Page, staff2Page, staff3Page].map(async (p) => ({
          page: p,
          visual: (await readAlertStats(p)).visualAlertCount,
        })),
      );

      await ctrl.returnStudent('M', 'R-M2');

      for (const item of preTurn2Visuals) {
        await expect(async () => {
          const stats = await readAlertStats(item.page);
          expect(stats.seqAttr).toBe(6);
          expect(stats.visualAlertCount).toBeGreaterThan(item.visual);
        }).toPass({ timeout: 15_000 });
        await expect(item.page.getByTestId('next-student-alert')).toContainText('R-M3');
        await expect(item.page.getByTestId('alert-covered-by')).toHaveCount(0);
      }

      await expect(async () => {
        const notes = await readRecordedNotifications(staff2Page);
        const match = notes.find(
          (n) => n.tag === `examq-next-${s.sessionId}-M-6`,
        );
        expect(match).toBeDefined();
        expect(match?.silent).toBe(true);
        expect(match?.dataUrl).toBe(`/s/${encodeURIComponent(s.sessionId)}`);
      }).toPass({ timeout: 15_000 });

      // ENTER & RETURN TURN 3 (Female): R-F1 enters (seq 7), R-F1 returns -> R-F2 ready (seq 8)
      await ctrl.enterStudent('F', 'R-F1');
      await expect(async () => {
        const stats = await readAlertStats(ctrlPage);
        expect(stats.seqAttr).toBe(7);
      }).toPass({ timeout: 15_000 });
      await ctrl.expectInBathroom('F', 'R-F1');
      const preTurn3Visuals = await Promise.all(
        [ctrlPage, staff1Page, staff2Page, staff3Page].map(async (p) => ({
          page: p,
          visual: (await readAlertStats(p)).visualAlertCount,
        })),
      );

      await ctrl.returnStudent('F', 'R-F1');

      for (const item of preTurn3Visuals) {
        await expect(async () => {
          const stats = await readAlertStats(item.page);
          expect(stats.seqAttr).toBe(8);
          expect(stats.visualAlertCount).toBeGreaterThan(item.visual);
        }).toPass({ timeout: 15_000 });
        await expect(item.page.getByTestId('next-student-alert')).toContainText('R-F2');
      }

      await expect(async () => {
        const notes = await readRecordedNotifications(staff2Page);
        const match = notes.find(
          (n) => n.tag === `examq-next-${s.sessionId}-F-8`,
        );
        expect(match).toBeDefined();
      }).toPass({ timeout: 15_000 });

      // Empty-queue return check: R-M3 enters and returns while Male queue is empty => seq stays 8
      await ctrl.enterStudent('M', 'R-M3');
      await ctrl.expectInBathroom('M', 'R-M3');
      await ctrl.returnStudent('M', 'R-M3');
      await ctrl.expectVacant('M');
      await staff1.expectVacant('M');
      await staff2.expectVacant('M');
      await staff3.expectVacant('M');
      for (const page of [ctrlPage, staff1Page, staff2Page, staff3Page]) {
        const stats = await readAlertStats(page);
        expect(stats.seqAttr).toBe(8);
      }

      expect(server5xx).toEqual([]);
      for (const g of guards) {
        g.assertZeroErrors();
      }
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test('T3-RET-02: Service Worker push event displays quiet notification with per-turn tag and session url', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctx = await browser.newContext();
    await ctx.grantPermissions(['notifications']);
    try {
      const page = await ctx.newPage();
      const guard = attachErrorGuards(page);

      const staff = new StaffPage(page);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('SW Push Staff');

      await expect(async () => {
        const activeUrl = await page.evaluate(async () => {
          const reg = await navigator.serviceWorker.ready;
          return reg.active?.scriptURL ?? '';
        });
        expect(activeUrl).toContain('/sw.js');
      }).toPass({ timeout: 10_000 });

      const sw = ctx
        .serviceWorkers()
        .find((worker) => worker.url().endsWith('/sw.js'));
      expect(sw).toBeDefined();

      const recorded = await sw!.evaluate(async (sessionId: string) => {
        const calls: Array<{
          title: string;
          tag?: string;
          silent?: boolean | null;
          renotify?: boolean;
          data?: { url?: string };
        }> = [];

        const swGlobal = self as unknown as {
          registration: ServiceWorkerRegistration;
          dispatchEvent: (evt: Event) => boolean;
          PushEvent: new (type: string, init?: { data?: string }) => Event;
        };
        const origShow = swGlobal.registration.showNotification.bind(
          swGlobal.registration,
        );
        swGlobal.registration.showNotification = async (
          title: string,
          options?: NotificationOptions & { renotify?: boolean },
        ) => {
          calls.push({
            title,
            tag: options?.tag,
            silent: options?.silent,
            renotify: options?.renotify,
            data: options?.data as { url?: string } | undefined,
          });
          return origShow(title, options);
        };

        const dispatchPush = async (seq: number) => {
          const payloadText = JSON.stringify({
            title: 'ExamQ · Queue updated',
            body: 'Open ExamQ to check the current queue.',
            tag: `examq-next-${sessionId}-M-${seq}`,
            url: `/s/${encodeURIComponent(sessionId)}`,
          });
          let pending: Promise<unknown> = Promise.resolve();
          const evt = new swGlobal.PushEvent('push', { data: payloadText });
          Object.defineProperty(evt, 'waitUntil', {
            value: (p: Promise<unknown>) => {
              pending = p;
            },
          });
          swGlobal.dispatchEvent(evt);
          await pending;
        };

        await dispatchPush(3);
        await dispatchPush(5);
        return calls;
      }, s.sessionId);

      expect(recorded).toHaveLength(2);
      expect(recorded[0]).toMatchObject({
        title: 'ExamQ · Queue updated',
        tag: `examq-next-${s.sessionId}-M-3`,
        silent: true,
        data: { url: `/s/${encodeURIComponent(s.sessionId)}` },
      });
      expect(recorded[0].renotify).toBeUndefined();
      expect(recorded[1]).toMatchObject({
        title: 'ExamQ · Queue updated',
        tag: `examq-next-${s.sessionId}-M-5`,
        silent: true,
        data: { url: `/s/${encodeURIComponent(s.sessionId)}` },
      });
      expect(recorded[1].renotify).toBeUndefined();

      await expect(async () => {
        const activeNotes = await page.evaluate(async () => {
          const reg = await navigator.serviceWorker.ready;
          return (await reg.getNotifications()).map((n) => ({
            tag: n.tag,
            silent: n.silent,
            data: n.data as { url?: string } | null,
          }));
        });
        expect(
          activeNotes.some((n) => n.tag === `examq-next-${s.sessionId}-M-3`),
        ).toBe(true);
        expect(
          activeNotes.some((n) => n.tag === `examq-next-${s.sessionId}-M-5`),
        ).toBe(true);
      }).toPass({ timeout: 10_000 });

      guard.assertZeroErrors();
    } finally {
      await ctx.close();
    }
  });
});
