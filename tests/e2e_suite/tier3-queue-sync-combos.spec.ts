import { expect, test } from '@playwright/test';
import {
  ExamQApiClient,
  createConfiguredSession,
} from './helpers/apiClient';
import { verifyAndDecodeSessionQr } from './helpers/qrHelper';
import { Selectors } from './helpers/selectors';
import { ControllerPage, StaffPage } from './helpers/sessionPages';

test.describe('Tier 3 — Queue, Sync, Reorder, Remove & Race Combinations (T3-01..T3-10)', () => {
  test('T3-01 (F-Q1 x F-Q2 x F-Q8): Concurrent Male and Female staff submissions converge accurately across all 3 clients', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const cCtx = await browser.newContext();
    const s1Ctx = await browser.newContext();
    const s2Ctx = await browser.newContext();
    try {
      const ctrl = new ControllerPage(await cCtx.newPage());
      const st1 = new StaffPage(await s1Ctx.newPage());
      const st2 = new StaffPage(await s2Ctx.newPage());

      await ctrl.goto(s.sessionId, s.controllerKey);
      await st1.goto(`/s/${s.sessionId}`);
      await st1.join('Proctor M');
      await st2.goto(`/s/${s.sessionId}`);
      await st2.join('Proctor F');

      await Promise.all([
        st1.submitStudent('M', 'CONC-M1'),
        st2.submitStudent('F', 'CONC-F1'),
      ]);

      await ctrl.expectQueuedVisible('M', 'CONC-M1');
      await ctrl.expectQueuedVisible('F', 'CONC-F1');
      await st1.expectQueuedVisible('F', 'CONC-F1');
      await st2.expectQueuedVisible('M', 'CONC-M1');
    } finally {
      await cCtx.close();
      await s1Ctx.close();
      await s2Ctx.close();
    }
  });

  test('T3-02 (F-Q2 x F-Q3 x F-Q4 x F-Q8): Admit 1M+1F simultaneously while 2nd Male is rejected and Staff reflects exact state', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F1' });

    const cCtx = await browser.newContext();
    const sCtx = await browser.newContext();
    try {
      const ctrl = new ControllerPage(await cCtx.newPage());
      const staff = new StaffPage(await sCtx.newPage());
      await ctrl.goto(s.sessionId, s.controllerKey);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Triage Viewer');

      await ctrl.enterStudent('M', 'M1');
      await ctrl.enterStudent('F', 'F1');

      const rej = await api.entryAction(s.sessionId, m2.body.entry.id, s.controllerKey, {
        action: 'enter',
      });
      expect(rej.status).toBe(409);

      await staff.expectInBathroom('M', 'M1');
      await staff.expectInBathroom('F', 'F1');
      await staff.expectQueuedVisible('M', 'M2');
    } finally {
      await cCtx.close();
      await sCtx.close();
    }
  });

  test('T3-03 (F-Q5 x F-Q2 x F-Q8): Student enters, returns, then re-submits later in exam and syncs live', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const cCtx = await browser.newContext();
    const sCtx = await browser.newContext();
    try {
      const ctrl = new ControllerPage(await cCtx.newPage());
      const staff = new StaffPage(await sCtx.newPage());
      await ctrl.goto(s.sessionId, s.controllerKey);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Repeat Proctor');

      await staff.submitStudent('M', 'REPEAT-42');
      await ctrl.expectQueuedVisible('M', 'REPEAT-42');
      await ctrl.enterStudent('M', 'REPEAT-42');
      await staff.expectInBathroom('M', 'REPEAT-42');
      await ctrl.returnStudent('M', 'REPEAT-42');
      await staff.expectVacant('M');

      await staff.submitStudent('M', 'REPEAT-42');
      await ctrl.expectQueuedVisible('M', 'REPEAT-42');
    } finally {
      await cCtx.close();
      await sCtx.close();
    }
  });

  test('T3-04 (F-Q6 x F-A1 x F-A2): Reordering M2 above M1 changes nextBySex.M, increments seq, and updates Staff alert', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'HEAD-1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'HEAD-2' });
    const seqBefore = m2.body.snapshot.lastNextAlert?.seq ?? 0;

    const sCtx = await browser.newContext();
    try {
      const staff = new StaffPage(await sCtx.newPage());
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Alert Listener');

      const reord = await api.reorder(s.sessionId, s.controllerKey, {
        entryId: m2.body.entry.id,
        targetIndex: 0,
      });
      expect(reord.body.snapshot.lastNextAlert?.seq).toBeGreaterThan(seqBefore);
      await staff.expectAlertContains('HEAD-2');
    } finally {
      await sCtx.close();
    }
  });

  test('T3-05 (F-Q6 x F-A1 negative): Reordering M3 above M2 while M1 stays head updates order WITHOUT firing alert', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });
    const m3 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M3' });
    const seqBefore = m3.body.snapshot.lastNextAlert?.seq;

    const reord = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: m3.body.entry.id,
      targetIndex: 1,
    });
    expect(reord.status).toBe(200);
    expect(reord.body.snapshot.nextBySex.M).toBe(m1.body.entry.id);
    expect(reord.body.snapshot.lastNextAlert?.seq).toBe(seqBefore);
    expect(
      reord.body.snapshot.entries
        .filter((e) => e.sex === 'M' && e.status === 'queued')
        .map((e) => e.studentNumber),
    ).toEqual(['M1', 'M3', 'M2']);
  });

  test('T3-06 (F-Q7 x F-Q3 x F-Q4): Removing in_bathroom M1 vacates slot so M2 enters without BATHROOM_OCCUPIED', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });

    const rem = await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, {
      action: 'remove',
    });
    expect(rem.status).toBe(200);

    const enter2 = await api.entryAction(s.sessionId, m2.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    expect(enter2.status).toBe(200);
  });

  test('T3-07 (F-Q7 x F-A1 x F-Q8): Removing queued head F1 promotes F2 and broadcasts alert to connected Staff', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F-FIRST' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F-SECOND' });

    const sCtx = await browser.newContext();
    try {
      const staff = new StaffPage(await sCtx.newPage());
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Head Removal Watcher');

      await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'remove' });
      await staff.expectAlertContains('F-SECOND');
    } finally {
      await sCtx.close();
    }
  });

  test('T3-08 (F-Q2 x F-Q8 race): Two staff race submitting identical studentNumber -> 1 succeeds (201), 1 conflicts (409)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const [r1, r2] = await Promise.all([
      api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'RACE-99', submittedBy: 'S1' }),
      api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'RACE-99', submittedBy: 'S2' }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const snap = await api.getSnapshot(s.sessionId);
    if (snap.body.unchanged) throw new Error('Expected snapshot');
    expect(snap.body.snapshot.entries.filter((e) => e.studentNumber === 'RACE-99')).toHaveLength(1);
  });

  test('T3-09 (F-Q4 x F-Q8 race): Two concurrent enter requests for M1 and M2 -> strictly 1 succeeds (200), 1 gets 409', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-R1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-R2' });

    const [e1, e2] = await Promise.all([
      api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' }),
      api.entryAction(s.sessionId, m2.body.entry.id, s.controllerKey, { action: 'enter' }),
    ]);

    expect([e1.status, e2.status].sort()).toEqual([200, 409]);
  });

  test('T3-10 (F-S2 x F-S3 x F-Q2): Staff joins via QR-decoded URL and Controller sees staff label & entry attribution', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const cCtx = await browser.newContext();
    const sCtx = await browser.newContext();
    try {
      const ctrlPage = await cCtx.newPage();
      const ctrl = new ControllerPage(ctrlPage);
      await ctrl.goto(s.sessionId, s.controllerKey);

      const qrUrl = await verifyAndDecodeSessionQr(
        ctrlPage,
        Selectors.qrElement(ctrlPage),
        s.sessionId,
        s.controllerKey,
      );

      const staff = new StaffPage(await sCtx.newPage());
      await staff.goto(qrUrl);
      await staff.join('QR Proctor Elena');
      await staff.submitStudent('F', 'QR-310');

      await ctrl.expectStaffListed('QR Proctor Elena');
      await ctrl.expectQueuedVisible('F', 'QR-310');
    } finally {
      await cCtx.close();
      await sCtx.close();
    }
  });
});
