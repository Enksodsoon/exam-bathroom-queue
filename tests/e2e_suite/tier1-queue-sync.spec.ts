import { expect, test } from '@playwright/test';
import {
  ExamQApiClient,
  createConfiguredSession,
} from './helpers/apiClient';
import { Selectors } from './helpers/selectors';
import { ControllerPage, StaffPage } from './helpers/sessionPages';

test.describe('Tier 1 — Queue Rules & Real-Time Sync (F-Q1..F-Q8)', () => {
  // F-Q1: Separate Sex FIFO Queues (5 tests)
  test('T1-FQ1-01: Enqueuing 3 Males preserves strict FIFO order and sets nextBySex.M to M1', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { sessionId } = await createConfiguredSession(api);

    const r1 = await api.submitEntry(sessionId, { sex: 'M', studentNumber: 'M-101' });
    const r2 = await api.submitEntry(sessionId, { sex: 'M', studentNumber: 'M-102' });
    const r3 = await api.submitEntry(sessionId, { sex: 'M', studentNumber: 'M-103' });

    expect(r3.status).toBe(201);
    const queuedM = r3.body.snapshot.entries
      .filter((e) => e.sex === 'M' && e.status === 'queued')
      .map((e) => e.studentNumber);
    expect(queuedM).toEqual(['M-101', 'M-102', 'M-103']);
    expect(r3.body.snapshot.nextBySex.M).toBe(r1.body.entry.id);
    expect(r2.body.snapshot.nextBySex.F).toBeNull();
  });

  test('T1-FQ1-02: Enqueuing 3 Females preserves strict FIFO order and sets nextBySex.F to F1', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { sessionId } = await createConfiguredSession(api);

    const r1 = await api.submitEntry(sessionId, { sex: 'F', studentNumber: 'F-201' });
    await api.submitEntry(sessionId, { sex: 'F', studentNumber: 'F-202' });
    const r3 = await api.submitEntry(sessionId, { sex: 'F', studentNumber: 'F-203' });

    const queuedF = r3.body.snapshot.entries
      .filter((e) => e.sex === 'F' && e.status === 'queued')
      .map((e) => e.studentNumber);
    expect(queuedF).toEqual(['F-201', 'F-202', 'F-203']);
    expect(r3.body.snapshot.nextBySex.F).toBe(r1.body.entry.id);
    expect(r3.body.snapshot.nextBySex.M).toBeNull();
  });

  test('T1-FQ1-03: Interleaved Male and Female submissions maintain independent FIFO order per sex', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const { sessionId } = await createConfiguredSession(api);

    const m1 = await api.submitEntry(sessionId, { sex: 'M', studentNumber: 'M1' });
    const f1 = await api.submitEntry(sessionId, { sex: 'F', studentNumber: 'F1' });
    await api.submitEntry(sessionId, { sex: 'M', studentNumber: 'M2' });
    const f2 = await api.submitEntry(sessionId, { sex: 'F', studentNumber: 'F2' });

    const snap = f2.body.snapshot;
    expect(snap.entries.filter((e) => e.sex === 'M').map((e) => e.studentNumber)).toEqual(['M1', 'M2']);
    expect(snap.entries.filter((e) => e.sex === 'F').map((e) => e.studentNumber)).toEqual(['F1', 'F2']);
    expect(snap.nextBySex).toEqual({ M: m1.body.entry.id, F: f1.body.entry.id });
  });

  test('T1-FQ1-04: Controller Dashboard renders separate Male and Female queue regions', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '1101' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '1102' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: '2201' });

    const ctrl = new ControllerPage(page);
    await ctrl.goto(s.sessionId, s.controllerKey);
    await ctrl.expectQueuedOrder('M', ['1101', '1102']);
    await ctrl.expectQueuedOrder('F', ['2201']);
  });

  test('T1-FQ1-05: Roaming Staff view reflects Male and Female queues separately', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '3301' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: '4401' });

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('Proctor Q1');
    await staff.expectQueuedVisible('M', '3301');
    await staff.expectQueuedVisible('F', '4401');
  });

  // F-Q2: Roaming Staff Submit (5 tests)
  test('T1-FQ2-01: Staff submits Male student -> 201 queued with submittedBy recorded', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const j = await api.joinStaff(s.sessionId, { label: 'Row 4 Proctor' });

    const res = await api.submitEntry(s.sessionId, {
      sex: 'M',
      studentNumber: 'S-501',
      staffId: j.body.staffId,
      submittedBy: j.body.label,
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.status).toBe('queued');
    expect(res.body.entry.sex).toBe('M');
    expect(res.body.entry.submittedBy).toBe('Row 4 Proctor');
  });

  test('T1-FQ2-02: Staff submits Female student -> 201 and increments snapshot version', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const v0 = s.snapshot.version;

    const res = await api.submitEntry(s.sessionId, {
      sex: 'F',
      studentNumber: 'S-502',
      submittedBy: 'Balcony Staff',
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.sex).toBe('F');
    expect(res.body.snapshot.version).toBeGreaterThan(v0);
  });

  test('T1-FQ2-03: Trimming whitespace around valid studentNumber succeeds and stores clean identifier', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const res = await api.submitEntry(s.sessionId, {
      sex: 'M',
      studentNumber: '  2026-042  ',
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.studentNumber).toBe('2026-042');
  });

  test('T1-FQ2-04: Staff UI selects Male, submits studentNumber, entry appears and input resets', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('Fast Proctor');
    await staff.submitStudent('M', '8801');

    await staff.expectQueuedVisible('M', '8801');
    await expect(Selectors.studentNumberInput(page)).toHaveValue('');
  });

  test('T1-FQ2-05: Staff UI selects Female, submits studentNumber, and appears in Female queue', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('West Wing');
    await staff.submitStudent('F', '8802');

    await staff.expectQueuedVisible('F', '8802');
  });

  // F-Q3: Concurrent Opposite-Sex Occupancy (5 tests)
  test('T1-FQ3-01: Marking queued Male enter transitions to in_bathroom, sets enteredAt, promotes M2 to next', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });

    const act = await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    expect(act.status).toBe(200);
    const updatedM1 = act.body.snapshot.entries.find((e) => e.id === m1.body.entry.id)!;
    expect(updatedM1.status).toBe('in_bathroom');
    expect(updatedM1.enteredAt).not.toBeNull();
    expect(act.body.snapshot.nextBySex.M).toBe(m2.body.entry.id);
  });

  test('T1-FQ3-02: With Male in_bathroom, marking queued Female enter succeeds simultaneously', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F1' });

    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });
    const fEnter = await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, {
      action: 'enter',
    });

    expect(fEnter.status).toBe(200);
    const active = fEnter.body.snapshot.entries.filter((e) => e.status === 'in_bathroom');
    expect(active.map((e) => e.sex).sort()).toEqual(['F', 'M']);
  });

  test('T1-FQ3-03: Female enters first then Male enters -> simultaneous opposite-sex occupancy succeeds', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F1' });

    await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'enter' });
    const mEnter = await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, {
      action: 'enter',
    });

    expect(mEnter.status).toBe(200);
    const active = mEnter.body.snapshot.entries.filter((e) => e.status === 'in_bathroom');
    expect(active).toHaveLength(2);
  });

  test('T1-FQ3-04: Controller UI admits 1 Male and 1 Female simultaneously into bathroom panels', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-OCC-1' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F-OCC-1' });

    const ctrl = new ControllerPage(page);
    await ctrl.goto(s.sessionId, s.controllerKey);
    await ctrl.enterStudent('M', 'M-OCC-1');
    await ctrl.enterStudent('F', 'F-OCC-1');

    await ctrl.expectInBathroom('M', 'M-OCC-1');
    await ctrl.expectInBathroom('F', 'F-OCC-1');
  });

  test('T1-FQ3-05: Connected Staff UI displays both Male and Female bathroom occupancy simultaneously', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-BOTH' });
    const f = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F-BOTH' });
    await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, f.body.entry.id, s.controllerKey, { action: 'enter' });

    const staff = new StaffPage(page);
    await staff.goto(`/s/${s.sessionId}`);
    await staff.join('Observer');
    await staff.expectInBathroom('M', 'M-BOTH');
    await staff.expectInBathroom('F', 'F-BOTH');
  });

  // F-Q4: Same-Sex Occupancy Rejection (5 tests)
  test('T1-FQ4-01: With Male M1 in_bathroom, enter on Male M2 returns 409 BATHROOM_OCCUPIED', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });

    const rej = await api.entryAction(s.sessionId, m2.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    expect(rej.status).toBe(409);
    expect(rej.body.code).toBe('BATHROOM_OCCUPIED');
  });

  test('T1-FQ4-02: With Female F1 in_bathroom, enter on Female F2 returns 409 BATHROOM_OCCUPIED', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F1' });
    const f2 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F2' });
    await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'enter' });

    const rej = await api.entryAction(s.sessionId, f2.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    expect(rej.status).toBe(409);
    expect(rej.body.code).toBe('BATHROOM_OCCUPIED');
  });

  test('T1-FQ4-03: Failed 2nd same-sex enter leaves M1 in_bathroom and M2 queued unchanged', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, m2.body.entry.id, s.controllerKey, { action: 'enter' });

    const getRes = await api.getSnapshot(s.sessionId);
    expect(getRes.status).toBe(200);
    if (getRes.body.unchanged) throw new Error('Expected full snapshot');
    const entries = getRes.body.snapshot.entries;
    expect(entries.find((e) => e.id === m1.body.entry.id)?.status).toBe('in_bathroom');
    expect(entries.find((e) => e.id === m2.body.entry.id)?.status).toBe('queued');
  });

  test('T1-FQ4-04: Controller UI prevents 2nd Male from entering while Male bathroom is occupied', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-ONE' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-TWO' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });

    const ctrl = new ControllerPage(page);
    await ctrl.goto(s.sessionId, s.controllerKey);
    const mSection = Selectors.sexSection(page, 'M');
    const m2Row = Selectors.studentRowInSection(mSection, 'M-TWO');
    const enterBtn = m2Row.getByRole('button', { name: /enter/i });

    if ((await enterBtn.count()) > 0 && (await enterBtn.isEnabled())) {
      await enterBtn.click();
      await ctrl.expectInBathroom('M', 'M-ONE');
      await ctrl.expectQueuedVisible('M', 'M-TWO');
    } else {
      if ((await enterBtn.count()) > 0) {
        await expect(enterBtn).toBeDisabled();
      }
      await ctrl.expectInBathroom('M', 'M-ONE');
    }
  });

  test('T1-FQ4-05: After rejected 2nd Male attempt, Female enter still succeeds', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F1' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });
    const rej = await api.entryAction(s.sessionId, m2.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    expect(rej.status).toBe(409);

    const ctrl = new ControllerPage(page);
    await ctrl.goto(s.sessionId, s.controllerKey);
    await ctrl.enterStudent('F', 'F1');
    await ctrl.expectInBathroom('M', 'M1');
    await ctrl.expectInBathroom('F', 'F1');
  });

  // F-Q5: Mark Returned (5 tests)
  test('T1-FQ5-01: return action on in_bathroom Male transitions to returned and sets returnedAt', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });

    const ret = await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, {
      action: 'return',
    });
    expect(ret.status).toBe(200);
    const entry = ret.body.snapshot.entries.find((e) => e.id === m1.body.entry.id)!;
    expect(entry.status).toBe('returned');
    expect(entry.returnedAt).not.toBeNull();
  });

  test('T1-FQ5-02: After returning M1, queued M2 can immediately enter', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'return' });

    const enter2 = await api.entryAction(s.sessionId, m2.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    expect(enter2.status).toBe(200);
    expect(enter2.body.snapshot.entries.find((e) => e.id === m2.body.entry.id)?.status).toBe(
      'in_bathroom',
    );
  });

  test('T1-FQ5-03: Returning Male leaves Female occupancy and Female queue intact', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F1' });
    const f2 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F2' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'enter' });

    const retM = await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, {
      action: 'return',
    });
    expect(retM.status).toBe(200);
    expect(retM.body.snapshot.entries.find((e) => e.id === f1.body.entry.id)?.status).toBe(
      'in_bathroom',
    );
    expect(retM.body.snapshot.nextBySex.F).toBe(f2.body.entry.id);
  });

  test('T1-FQ5-04: Controller clicks Mark Returned -> Male occupancy panel becomes vacant', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-RET-1' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });

    const ctrl = new ControllerPage(page);
    await ctrl.goto(s.sessionId, s.controllerKey);
    await ctrl.expectInBathroom('M', 'M-RET-1');
    await ctrl.returnStudent('M', 'M-RET-1');
    await ctrl.expectVacant('M');
  });

  test('T1-FQ5-05: Staff client updates occupancy from occupied to vacant without reload after return', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F-RET-1' });
    await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'enter' });

    const staffCtx = await browser.newContext();
    try {
      const staffPage = await staffCtx.newPage();
      const staff = new StaffPage(staffPage);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Door Staff');
      await staff.expectInBathroom('F', 'F-RET-1');

      await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'return' });
      await staff.expectVacant('F');
    } finally {
      await staffCtx.close();
    }
  });

  // F-Q6: Reorder Queued Entries (5 tests)
  test('T1-FQ6-01: Reordering queued Male #2 to targetIndex 0 updates nextBySex.M to #2', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });

    const reord = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: m2.body.entry.id,
      targetIndex: 0,
    });
    expect(reord.status).toBe(200);
    expect(reord.body.snapshot.nextBySex.M).toBe(m2.body.entry.id);
    const order = reord.body.snapshot.entries
      .filter((e) => e.sex === 'M' && e.status === 'queued')
      .map((e) => e.studentNumber);
    expect(order).toEqual(['M2', 'M1']);
  });

  test('T1-FQ6-02: Reordering queued Female #1 to end of queue updates nextBySex.F to #2', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F1' });
    const f2 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F2' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F3' });

    const reord = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: f1.body.entry.id,
      targetIndex: 2,
    });
    expect(reord.status).toBe(200);
    expect(reord.body.snapshot.nextBySex.F).toBe(f2.body.entry.id);
    const order = reord.body.snapshot.entries
      .filter((e) => e.sex === 'F' && e.status === 'queued')
      .map((e) => e.studentNumber);
    expect(order).toEqual(['F2', 'F3', 'F1']);
  });

  test('T1-FQ6-03: Reordering via direction up/down shifts adjacent entries accurately', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M3' });

    const upRes = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: m2.body.entry.id,
      direction: 'up',
    });
    expect(upRes.status).toBe(200);
    expect(upRes.body.snapshot.nextBySex.M).toBe(m2.body.entry.id);

    const downRes = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: m2.body.entry.id,
      direction: 'down',
    });
    expect(downRes.status).toBe(200);
    expect(downRes.body.snapshot.nextBySex.M).toBe(m1.body.entry.id);
  });

  test('T1-FQ6-04: Controller UI Move Up updates queue order immediately', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-ORD-1' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-ORD-2' });

    const ctrl = new ControllerPage(page);
    await ctrl.goto(s.sessionId, s.controllerKey);
    await ctrl.expectQueuedOrder('M', ['M-ORD-1', 'M-ORD-2']);

    await ctrl.moveUp('M', 'M-ORD-2');
    await ctrl.expectQueuedOrder('M', ['M-ORD-2', 'M-ORD-1']);
  });

  test('T1-FQ6-05: Reordered queue order propagates to connected Staff view without reload', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F-ORD-1' });
    const f2 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F-ORD-2' });

    const staffCtx = await browser.newContext();
    try {
      const staffPage = await staffCtx.newPage();
      const staff = new StaffPage(staffPage);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Proctor Sync');
      await staff.expectQueuedOrder('F', ['F-ORD-1', 'F-ORD-2']);

      await api.reorder(s.sessionId, s.controllerKey, {
        entryId: f2.body.entry.id,
        targetIndex: 0,
      });
      await staff.expectQueuedOrder('F', ['F-ORD-2', 'F-ORD-1']);
    } finally {
      await staffCtx.close();
    }
  });

  // F-Q7: Remove Entries (5 tests)
  test('T1-FQ7-01: Removing queued head entry marks removed and promotes 2nd entry to nextBySex', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });

    const rem = await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, {
      action: 'remove',
    });
    expect(rem.status).toBe(200);
    expect(rem.body.snapshot.entries.find((e) => e.id === m1.body.entry.id)?.status).toBe(
      'removed',
    );
    expect(rem.body.snapshot.nextBySex.M).toBe(m2.body.entry.id);
  });

  test('T1-FQ7-02: Removing middle queued entry preserves relative FIFO order of remaining entries', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F1' });
    const f2 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F2' });
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F3' });

    const rem = await api.entryAction(s.sessionId, f2.body.entry.id, s.controllerKey, {
      action: 'remove',
    });
    expect(rem.status).toBe(200);
    const remaining = rem.body.snapshot.entries
      .filter((e) => e.sex === 'F' && e.status === 'queued')
      .map((e) => e.studentNumber);
    expect(remaining).toEqual(['F1', 'F3']);
  });

  test('T1-FQ7-03: Removing an in_bathroom entry vacates occupancy slot immediately', async ({
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

  test('T1-FQ7-04: Controller clicks Remove on queued student -> student disappears from active queue', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-REM-1' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-REM-2' });

    const ctrl = new ControllerPage(page);
    await ctrl.goto(s.sessionId, s.controllerKey);
    await ctrl.removeStudent('M', 'M-REM-1');

    const mSection = Selectors.sexSection(page, 'M');
    await expect(Selectors.studentRowInSection(mSection, 'M-REM-1')).toHaveCount(0);
    await ctrl.expectQueuedVisible('M', 'M-REM-2');
  });

  test('T1-FQ7-05: Connected Staff view reflects removed entry disappearance without reload', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F-GONE' });

    const staffCtx = await browser.newContext();
    try {
      const staffPage = await staffCtx.newPage();
      const staff = new StaffPage(staffPage);
      await staff.goto(`/s/${s.sessionId}`);
      await staff.join('Proctor Watch');
      await staff.expectQueuedVisible('F', 'F-GONE');

      await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'remove' });
      await staff.expectQueuedAbsent('F', 'F-GONE');
    } finally {
      await staffCtx.close();
    }
  });

  // F-Q8: Multi-Client Real-Time Sync (5 tests)
  test('T1-FQ8-01: GET ?sinceVersion=N returns unchanged=true when current and unchanged=false after mutation', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const v = s.snapshot.version;

    const same = await api.getSnapshot(s.sessionId, v);
    expect(same.status).toBe(200);
    expect(same.body.unchanged).toBe(true);

    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-POLL' });
    const changed = await api.getSnapshot(s.sessionId, v);
    expect(changed.status).toBe(200);
    expect(changed.body.unchanged).toBe(false);
    if (!changed.body.unchanged) {
      expect(changed.body.snapshot.version).toBeGreaterThan(v);
    }
  });

  test('T1-FQ8-02: Staff A submits -> Controller and Staff B see entry automatically without reload', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const ctrlCtx = await browser.newContext();
    const staffACtx = await browser.newContext();
    const staffBCtx = await browser.newContext();
    try {
      const ctrl = new ControllerPage(await ctrlCtx.newPage());
      const staffA = new StaffPage(await staffACtx.newPage());
      const staffB = new StaffPage(await staffBCtx.newPage());

      await ctrl.goto(s.sessionId, s.controllerKey);
      await staffA.goto(`/s/${s.sessionId}`);
      await staffA.join('Staff A');
      await staffB.goto(`/s/${s.sessionId}`);
      await staffB.join('Staff B');

      await staffA.submitStudent('M', 'SYNC-101');
      await ctrl.expectQueuedVisible('M', 'SYNC-101');
      await staffB.expectQueuedVisible('M', 'SYNC-101');
    } finally {
      await ctrlCtx.close();
      await staffACtx.close();
      await staffBCtx.close();
    }
  });

  test('T1-FQ8-03: Controller marks Enter -> Staff A and Staff B see occupancy update without reload', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'SYNC-202' });

    const ctrlCtx = await browser.newContext();
    const staffACtx = await browser.newContext();
    const staffBCtx = await browser.newContext();
    try {
      const ctrl = new ControllerPage(await ctrlCtx.newPage());
      const staffA = new StaffPage(await staffACtx.newPage());
      const staffB = new StaffPage(await staffBCtx.newPage());

      await ctrl.goto(s.sessionId, s.controllerKey);
      await staffA.goto(`/s/${s.sessionId}`);
      await staffA.join('Staff A');
      await staffB.goto(`/s/${s.sessionId}`);
      await staffB.join('Staff B');

      await ctrl.enterStudent('F', 'SYNC-202');
      await staffA.expectInBathroom('F', 'SYNC-202');
      await staffB.expectInBathroom('F', 'SYNC-202');
    } finally {
      await ctrlCtx.close();
      await staffACtx.close();
      await staffBCtx.close();
    }
  });

  test('T1-FQ8-04: Controller marks Returned -> all connected Staff views update to vacant without reload', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'SYNC-303' });
    await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, { action: 'enter' });

    const ctrlCtx = await browser.newContext();
    const staffACtx = await browser.newContext();
    const staffBCtx = await browser.newContext();
    try {
      const ctrl = new ControllerPage(await ctrlCtx.newPage());
      const staffA = new StaffPage(await staffACtx.newPage());
      const staffB = new StaffPage(await staffBCtx.newPage());

      await ctrl.goto(s.sessionId, s.controllerKey);
      await staffA.goto(`/s/${s.sessionId}`);
      await staffA.join('Staff A');
      await staffB.goto(`/s/${s.sessionId}`);
      await staffB.join('Staff B');

      await ctrl.returnStudent('M', 'SYNC-303');
      await staffA.expectVacant('M');
      await staffB.expectVacant('M');
    } finally {
      await ctrlCtx.close();
      await staffACtx.close();
      await staffBCtx.close();
    }
  });

  test('T1-FQ8-05: Controller reorders and removes -> all connected Staff converge to exact same order', async ({
    browser,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'S-A' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'S-B' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'S-C' });

    const ctrlCtx = await browser.newContext();
    const staffACtx = await browser.newContext();
    const staffBCtx = await browser.newContext();
    try {
      const ctrl = new ControllerPage(await ctrlCtx.newPage());
      const staffA = new StaffPage(await staffACtx.newPage());
      const staffB = new StaffPage(await staffBCtx.newPage());

      await ctrl.goto(s.sessionId, s.controllerKey);
      await staffA.goto(`/s/${s.sessionId}`);
      await staffA.join('Staff A');
      await staffB.goto(`/s/${s.sessionId}`);
      await staffB.join('Staff B');

      await ctrl.moveUp('M', 'S-C');
      await ctrl.removeStudent('M', 'S-A');

      await staffA.expectQueuedOrder('M', ['S-C', 'S-B']);
      await staffB.expectQueuedOrder('M', ['S-C', 'S-B']);
      await staffA.expectQueuedAbsent('M', 'S-A');
    } finally {
      await ctrlCtx.close();
      await staffACtx.close();
      await staffBCtx.close();
    }
  });
});
