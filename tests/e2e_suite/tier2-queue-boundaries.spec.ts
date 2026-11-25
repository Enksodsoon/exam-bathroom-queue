import { expect, test } from '@playwright/test';
import {
  ExamQApiClient,
  createConfiguredSession,
} from './helpers/apiClient';
import { ControllerPage } from './helpers/sessionPages';

test.describe('Tier 2 — Queue, Deduplication, Occupancy & Reorder/Remove Boundaries (F-Q1..F-Q7)', () => {
  // F-Q1 (5 tests)
  test('T2-FQ1-01: Empty queue has nextBySex { M: null, F: null }', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    expect(s.snapshot.nextBySex).toEqual({ M: null, F: null });
  });

  test('T2-FQ1-02: 10-deep Male queue maintains exact [0..9] FIFO order', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const expected: string[] = [];
    for (let i = 0; i < 10; i++) {
      const num = `DEEP-${i}`;
      expected.push(num);
      const r = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: num });
      expect(r.status).toBe(201);
    }
    const snap = await api.getSnapshot(s.sessionId);
    if (snap.body.unchanged) throw new Error('Expected snapshot');
    const actual = snap.body.snapshot.entries
      .filter((e) => e.sex === 'M' && e.status === 'queued')
      .map((e) => e.studentNumber);
    expect(actual).toEqual(expected);
  });

  test('T2-FQ1-03: Negative or non-numeric sinceVersion degrades gracefully without 500', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const neg = await api.getSnapshot(s.sessionId, -5);
    expect(neg.status).toBe(200);
    const nan = await api.getSnapshot(s.sessionId, 'not-a-number');
    expect([200, 400]).toContain(nan.status);
  });

  test('T2-FQ1-04: Male-only queue leaves nextBySex.F null and Female-only leaves nextBySex.M null', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s1 = await createConfiguredSession(api);
    const m = await api.submitEntry(s1.sessionId, { sex: 'M', studentNumber: 'M-ONLY' });
    expect(m.body.snapshot.nextBySex.M).toBe(m.body.entry.id);
    expect(m.body.snapshot.nextBySex.F).toBeNull();

    const s2 = await createConfiguredSession(api);
    const f = await api.submitEntry(s2.sessionId, { sex: 'F', studentNumber: 'F-ONLY' });
    expect(f.body.snapshot.nextBySex.F).toBe(f.body.entry.id);
    expect(f.body.snapshot.nextBySex.M).toBeNull();
  });

  test('T2-FQ1-05: Malformed JSON body on POST /entries returns 400', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const res = await api.submitRawEntry(s.sessionId, '{bad-json');
    expect(res.status).toBe(400);
  });

  // F-Q2 (7 tests)
  test('T2-FQ2-01: Invalid sex ("X", "", null) on POST /entries returns 400', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    for (const badSex of ['X', '', null]) {
      const res = await api.submitEntry(s.sessionId, {
        sex: badSex,
        studentNumber: '1001',
      });
      expect(res.status).toBe(400);
    }
  });

  test('T2-FQ2-02: Empty or whitespace-only studentNumber returns 400', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    for (const badNum of ['', '   ', '\t\n']) {
      const res = await api.submitEntry(s.sessionId, {
        sex: 'M',
        studentNumber: badNum,
      });
      expect(res.status).toBe(400);
    }
  });

  test('T2-FQ2-03: Excessively long studentNumber (100 chars) returns 400', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const res = await api.submitEntry(s.sessionId, {
      sex: 'F',
      studentNumber: '9'.repeat(100),
    });
    expect(res.status).toBe(400);
  });

  test('T2-FQ2-04: Duplicate queued studentNumber returns 409 DUPLICATE_STUDENT', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const first = await api.submitEntry(s.sessionId, {
      sex: 'M',
      studentNumber: 'DUP-100',
    });
    expect(first.status).toBe(201);

    const dup = await api.submitEntry(s.sessionId, {
      sex: 'M',
      studentNumber: 'DUP-100',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_STUDENT');
  });

  test('T2-FQ2-05: Duplicate studentNumber while in_bathroom returns 409 DUPLICATE_STUDENT', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const e = await api.submitEntry(s.sessionId, {
      sex: 'F',
      studentNumber: 'DUP-ACT',
    });
    await api.entryAction(s.sessionId, e.body.entry.id, s.controllerKey, {
      action: 'enter',
    });

    const dup = await api.submitEntry(s.sessionId, {
      sex: 'F',
      studentNumber: 'DUP-ACT',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_STUDENT');
  });

  test('T2-FQ2-06: Re-submitting returned or removed studentNumber succeeds with 201', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const m = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'RE-1' });
    await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, { action: 'return' });
    const reM = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'RE-1' });
    expect(reM.status).toBe(201);

    const f = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'RE-2' });
    await api.entryAction(s.sessionId, f.body.entry.id, s.controllerKey, { action: 'remove' });
    const reF = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'RE-2' });
    expect(reF.status).toBe(201);
  });

  test('T2-FQ2-07: Whitespace-padded duplicate " 1042 " vs "1042" returns 409 DUPLICATE_STUDENT', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: '1042' });
    const dup = await api.submitEntry(s.sessionId, {
      sex: 'M',
      studentNumber: '  1042  ',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_STUDENT');
  });

  // F-Q3 / F-Q4 (6 tests)
  test('T2-FQ34-01: 2nd Male enter while Male occupied returns 409 BATHROOM_OCCUPIED', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const m2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });

    const r = await api.entryAction(s.sessionId, m2.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('BATHROOM_OCCUPIED');
  });

  test('T2-FQ34-02: 2nd Female enter while Female occupied returns 409 BATHROOM_OCCUPIED', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F1' });
    const f2 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F2' });
    await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'enter' });

    const r = await api.entryAction(s.sessionId, f2.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('BATHROOM_OCCUPIED');
  });

  test('T2-FQ34-03: Action on unknown entryId returns 404', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const r = await api.entryAction(s.sessionId, 'unknown-entry-id', s.controllerKey, {
      action: 'enter',
    });
    expect(r.status).toBe(404);
  });

  test('T2-FQ34-04: Invalid action ("jump") returns 400', async ({ request }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const e = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });

    const r = await api.entryAction(s.sessionId, e.body.entry.id, s.controllerKey, {
      action: 'jump',
    });
    expect(r.status).toBe(400);
  });

  test('T2-FQ34-05: return action on a still-queued entry is rejected (400 or 409)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const e = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-Q' });

    const r = await api.entryAction(s.sessionId, e.body.entry.id, s.controllerKey, {
      action: 'return',
    });
    expect([400, 409]).toContain(r.status);
  });

  test('T2-FQ34-06: enter action on already returned or removed entry is rejected (400 or 409)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-DONE' });
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F-REM' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'return' });
    await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'remove' });

    const r1 = await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    const r2 = await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    expect([400, 409]).toContain(r1.status);
    expect([400, 409]).toContain(r2.status);
  });

  // F-Q5 (5 tests)
  test('T2-FQ5-01: Returning sole in_bathroom student with empty queue leaves nextBySex[sex] null', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'SOLE' });
    await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, { action: 'enter' });

    const ret = await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, {
      action: 'return',
    });
    expect(ret.status).toBe(200);
    expect(ret.body.snapshot.nextBySex.M).toBeNull();
  });

  test('T2-FQ5-02: Returned entry has returnedAt >= enteredAt', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const f = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'TIME-CHK' });
    await api.entryAction(s.sessionId, f.body.entry.id, s.controllerKey, { action: 'enter' });
    const ret = await api.entryAction(s.sessionId, f.body.entry.id, s.controllerKey, {
      action: 'return',
    });

    const entry = ret.body.snapshot.entries.find((e) => e.id === f.body.entry.id)!;
    expect(entry.enteredAt).not.toBeNull();
    expect(entry.returnedAt).not.toBeNull();
    expect(entry.returnedAt!).toBeGreaterThanOrEqual(entry.enteredAt!);
  });

  test('T2-FQ5-03: Repeated return on already returned entry is rejected (400 or 409)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'DBL-RET' });
    await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, { action: 'return' });

    const second = await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, {
      action: 'return',
    });
    expect([400, 409]).toContain(second.status);
  });

  test('T2-FQ5-04: Returning Male while Female is in_bathroom keeps Female active', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-A' });
    const f = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F-A' });
    await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, f.body.entry.id, s.controllerKey, { action: 'enter' });

    const ret = await api.entryAction(s.sessionId, m.body.entry.id, s.controllerKey, {
      action: 'return',
    });
    expect(ret.body.snapshot.entries.find((e) => e.id === f.body.entry.id)?.status).toBe(
      'in_bathroom',
    );
  });

  test('T2-FQ5-05: Controller UI reflects vacant slot immediately after return', async ({
    page,
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const f = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'UI-VAC' });
    await api.entryAction(s.sessionId, f.body.entry.id, s.controllerKey, { action: 'enter' });

    const ctrl = new ControllerPage(page);
    await ctrl.goto(s.sessionId, s.controllerKey);
    await ctrl.returnStudent('F', 'UI-VAC');
    await ctrl.expectVacant('F');
  });

  // F-Q6 (5 tests)
  test('T2-FQ6-01: Reordering an in_bathroom entry is rejected (400 or 409)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });

    const r = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: m1.body.entry.id,
      targetIndex: 0,
    });
    expect([400, 409]).toContain(r.status);
  });

  test('T2-FQ6-02: Reordering returned or removed entry is rejected (400 or 409)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F1' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'return' });
    await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'remove' });

    const r1 = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: m1.body.entry.id,
      targetIndex: 0,
    });
    const r2 = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: f1.body.entry.id,
      targetIndex: 0,
    });
    expect([400, 409]).toContain(r1.status);
    expect([400, 409]).toContain(r2.status);
  });

  test('T2-FQ6-03: Reordering unknown entryId returns 404', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const r = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: 'no-such-entry',
      targetIndex: 0,
    });
    expect(r.status).toBe(404);
  });

  test('T2-FQ6-04: Boundary valid moves (0->last, last->0, up on 1-item queue) preserve exact entry set', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F1' });
    const upSingle = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: f1.body.entry.id,
      direction: 'up',
    });
    expect(upSingle.status).toBe(200);

    await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F2' });
    const f3 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F3' });

    const moveEnd = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: f1.body.entry.id,
      targetIndex: 2,
    });
    expect(moveEnd.status).toBe(200);
    expect(
      moveEnd.body.snapshot.entries
        .filter((e) => e.sex === 'F' && e.status === 'queued')
        .map((e) => e.studentNumber),
    ).toEqual(['F2', 'F3', 'F1']);

    const moveFront = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: f3.body.entry.id,
      targetIndex: 0,
    });
    expect(moveFront.status).toBe(200);
    expect(
      moveFront.body.snapshot.entries
        .filter((e) => e.sex === 'F' && e.status === 'queued')
        .map((e) => e.studentNumber),
    ).toEqual(['F3', 'F2', 'F1']);
  });

  test('T2-FQ6-05: Extreme targetIndex (-1 or 999) clamps or returns 400 without corrupting queue', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M2' });

    const neg = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: m1.body.entry.id,
      targetIndex: -1,
    });
    expect([200, 400]).toContain(neg.status);

    const high = await api.reorder(s.sessionId, s.controllerKey, {
      entryId: m1.body.entry.id,
      targetIndex: 999,
    });
    expect([200, 400]).toContain(high.status);

    const snap = await api.getSnapshot(s.sessionId);
    if (snap.body.unchanged) throw new Error('Expected snapshot');
    const nums = snap.body.snapshot.entries
      .filter((e) => e.sex === 'M' && e.status === 'queued')
      .map((e) => e.studentNumber)
      .sort();
    expect(nums).toEqual(['M1', 'M2']);
  });

  // F-Q7 (5 tests)
  test('T2-FQ7-01: Removing sole queued entry sets nextBySex[sex] to null', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M-SOLE' });

    const rem = await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, {
      action: 'remove',
    });
    expect(rem.status).toBe(200);
    expect(rem.body.snapshot.nextBySex.M).toBeNull();
  });

  test('T2-FQ7-02: Removing middle entry of 4 preserves [0, 2, 3] order', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'Q0' });
    const q1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'Q1' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'Q2' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'Q3' });

    const rem = await api.entryAction(s.sessionId, q1.body.entry.id, s.controllerKey, {
      action: 'remove',
    });
    expect(rem.status).toBe(200);
    expect(
      rem.body.snapshot.entries
        .filter((e) => e.sex === 'M' && e.status === 'queued')
        .map((e) => e.studentNumber),
    ).toEqual(['Q0', 'Q2', 'Q3']);
  });

  test('T2-FQ7-03: Removing in_bathroom entry frees slot so queued #1 can enter', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F1' });
    const f2 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F2' });
    await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'remove' });

    const enter2 = await api.entryAction(s.sessionId, f2.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    expect(enter2.status).toBe(200);
  });

  test('T2-FQ7-04: Removing unknown entryId returns 404', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const r = await api.entryAction(s.sessionId, 'missing-id', s.controllerKey, {
      action: 'remove',
    });
    expect(r.status).toBe(404);
  });

  test('T2-FQ7-05: Removing already removed or returned entry is rejected (400 or 409)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const m1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'M1' });
    const f1 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'F1' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, { action: 'return' });
    await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, { action: 'remove' });

    const r1 = await api.entryAction(s.sessionId, m1.body.entry.id, s.controllerKey, {
      action: 'remove',
    });
    const r2 = await api.entryAction(s.sessionId, f1.body.entry.id, s.controllerKey, {
      action: 'remove',
    });
    expect([400, 409]).toContain(r1.status);
    expect([400, 409]).toContain(r2.status);
  });
});
