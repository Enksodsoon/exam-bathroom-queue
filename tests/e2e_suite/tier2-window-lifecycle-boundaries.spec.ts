import { expect, test } from '@playwright/test';
import {
  ExamQApiClient,
  createConfiguredSession,
} from './helpers/apiClient';

const MIN = 60_000;

test.describe('Tier 2 — Time-Window, Clock Offset, Override & Clear Boundaries (F-T1..F-T4)', () => {
  // F-T1 (5 tests)
  test('T2-FT1-01: PATCH /config with durationMinutes <= 0 returns 400', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const now = created.body.snapshot.serverNowMs;

    for (const badDur of [0, -10]) {
      const res = await api.patchConfig(
        created.body.sessionId,
        created.body.controllerKey,
        { startTimeMs: now, durationMinutes: badDur },
      );
      expect(res.status).toBe(400);
    }
  });

  test('T2-FT1-02: PATCH /config with non-numeric startTimeMs or durationMinutes returns 400', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();

    const r1 = await api.patchConfig(
      created.body.sessionId,
      created.body.controllerKey,
      { startTimeMs: 'invalid', durationMinutes: 90 },
    );
    const r2 = await api.patchConfig(
      created.body.sessionId,
      created.body.controllerKey,
      { startTimeMs: Date.now(), durationMinutes: 'ninety' },
    );
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
  });

  test('T2-FT1-03: 50-minute exam has empty allowed window and blocks at +29m, +30m, +31m', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;

    for (const offsetMin of [29, 30, 31]) {
      const cfg = await api.patchConfig(
        created.body.sessionId,
        created.body.controllerKey,
        { startTimeMs: start, durationMinutes: 50, clockOffsetMs: offsetMin * MIN },
      );
      expect(cfg.status).toBe(200);
      expect(cfg.body.snapshot.windowStatus).not.toBe('ALLOWED');

      const sub = await api.submitEntry(created.body.sessionId, {
        sex: 'M',
        studentNumber: `D50-${offsetMin}`,
      });
      expect(sub.status).toBe(403);
      expect(sub.body.code).toBe('OUTSIDE_TIME_WINDOW');
    }
  });

  test('T2-FT1-04: 40-minute exam (overlapping first 30m and last 20m) blocks across entire exam', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;

    for (const offsetMin of [5, 20, 35]) {
      const cfg = await api.patchConfig(
        created.body.sessionId,
        created.body.controllerKey,
        { startTimeMs: start, durationMinutes: 40, clockOffsetMs: offsetMin * MIN },
      );
      expect(cfg.status).toBe(200);
      expect(cfg.body.snapshot.windowStatus).not.toBe('ALLOWED');

      const sub = await api.submitEntry(created.body.sessionId, {
        sex: 'F',
        studentNumber: `D40-${offsetMin}`,
      });
      expect(sub.status).toBe(403);
    }
  });

  test('T2-FT1-05: Negative clockOffsetMs shifts effectiveNowMs backward into BEFORE_START', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;

    const cfg = await api.patchConfig(
      created.body.sessionId,
      created.body.controllerKey,
      { startTimeMs: start, durationMinutes: 120, clockOffsetMs: -15 * MIN },
    );
    expect(cfg.status).toBe(200);
    expect(cfg.body.snapshot.effectiveNowMs).toBeLessThan(start);
    expect(cfg.body.snapshot.windowStatus).toBe('BEFORE_START');
  });

  // F-T2 Exact Window Boundary Suite (8 tests)
  test('T2-FT2-01: UNCONFIGURED session blocks staff submission with 403 OUTSIDE_TIME_WINDOW', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();

    const sub = await api.submitEntry(created.body.sessionId, {
      sex: 'M',
      studentNumber: 'UNCFG-1',
    });
    expect(sub.status).toBe(403);
    expect(sub.body.code).toBe('OUTSIDE_TIME_WINDOW');
    expect(sub.body.windowStatus).toBe('UNCONFIGURED');
  });

  test('T2-FT2-02: BEFORE_START (start - 10s) blocks staff submission with 403', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;

    await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
      startTimeMs: start,
      durationMinutes: 120,
      clockOffsetMs: -10_000,
    });
    const sub = await api.submitEntry(created.body.sessionId, {
      sex: 'M',
      studentNumber: 'BEF-1',
    });
    expect(sub.status).toBe(403);
    expect(sub.body.windowStatus).toBe('BEFORE_START');
  });

  test('T2-FT2-03: FIRST_30_MIN (start + 1s) blocks staff submission with 403', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;

    await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
      startTimeMs: start,
      durationMinutes: 120,
      clockOffsetMs: 1_000,
    });
    const sub = await api.submitEntry(created.body.sessionId, {
      sex: 'F',
      studentNumber: 'F30-1',
    });
    expect(sub.status).toBe(403);
    expect(sub.body.windowStatus).toBe('FIRST_30_MIN');
  });

  test('T2-FT2-04: Just before 30-minute mark (start + 30m - 3s) blocks with FIRST_30_MIN', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;

    const cfg = await api.patchConfig(
      created.body.sessionId,
      created.body.controllerKey,
      { startTimeMs: start, durationMinutes: 120, clockOffsetMs: 30 * MIN - 3_000 },
    );
    expect(cfg.body.snapshot.effectiveNowMs).toBeLessThan(start + 30 * MIN);

    const sub = await api.submitEntry(created.body.sessionId, {
      sex: 'M',
      studentNumber: 'F30-EDGE',
    });
    expect(sub.status).toBe(403);
    expect(sub.body.windowStatus).toBe('FIRST_30_MIN');
  });

  test('T2-FT2-05: Window opening at start + 30m permits staff submission (201)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;

    const cfg = await api.patchConfig(
      created.body.sessionId,
      created.body.controllerKey,
      { startTimeMs: start, durationMinutes: 120, clockOffsetMs: 30 * MIN + 100 },
    );
    expect(cfg.body.snapshot.windowStatus).toBe('ALLOWED');

    const sub = await api.submitEntry(created.body.sessionId, {
      sex: 'M',
      studentNumber: 'OPEN-EDGE',
    });
    expect(sub.status).toBe(201);
  });

  test('T2-FT2-06: Just before last 20 minutes (end - 20m - 3s) still permits staff submission (201)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;
    const durationMinutes = 120;

    const cfg = await api.patchConfig(
      created.body.sessionId,
      created.body.controllerKey,
      {
        startTimeMs: start,
        durationMinutes,
        clockOffsetMs: (durationMinutes - 20) * MIN - 3_000,
      },
    );
    expect(cfg.body.snapshot.windowStatus).toBe('ALLOWED');

    const sub = await api.submitEntry(created.body.sessionId, {
      sex: 'F',
      studentNumber: 'PRE-CLOSE',
    });
    expect(sub.status).toBe(201);
  });

  test('T2-FT2-07: Exact close (end - 20m) blocks staff submission with LAST_20_MIN', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;
    const durationMinutes = 120;

    const cfg = await api.patchConfig(
      created.body.sessionId,
      created.body.controllerKey,
      {
        startTimeMs: start,
        durationMinutes,
        clockOffsetMs: (durationMinutes - 20) * MIN + 100,
      },
    );
    expect(cfg.body.snapshot.windowStatus).toBe('LAST_20_MIN');

    const sub = await api.submitEntry(created.body.sessionId, {
      sex: 'M',
      studentNumber: 'L20-EDGE',
    });
    expect(sub.status).toBe(403);
    expect(sub.body.windowStatus).toBe('LAST_20_MIN');
  });

  test('T2-FT2-08: AFTER_END (end + 10s) blocks staff submission with AFTER_END', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const start = created.body.snapshot.serverNowMs;
    const durationMinutes = 120;

    const cfg = await api.patchConfig(
      created.body.sessionId,
      created.body.controllerKey,
      {
        startTimeMs: start,
        durationMinutes,
        clockOffsetMs: durationMinutes * MIN + 10_000,
      },
    );
    expect(cfg.body.snapshot.windowStatus).toBe('AFTER_END');

    const sub = await api.submitEntry(created.body.sessionId, {
      sex: 'F',
      studentNumber: 'END-EDGE',
    });
    expect(sub.status).toBe(403);
    expect(sub.body.windowStatus).toBe('AFTER_END');
  });

  // F-T3 (6 tests)
  test('T2-FT3-01: Staff passing override=true without controllerKey receives 401 or 403', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const res = await api.submitEntry(s.sessionId, {
      sex: 'M',
      studentNumber: 'SPOOF-OVR',
      override: true,
    });
    expect([401, 403]).toContain(res.status);
  });

  test('T2-FT3-02: Controller override=true succeeds in UNCONFIGURED and BEFORE_START', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();

    const r1 = await api.submitEntry(
      created.body.sessionId,
      { sex: 'M', studentNumber: 'OVR-UNCFG', override: true },
      created.body.controllerKey,
    );
    expect(r1.status).toBe(201);

    await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
      startTimeMs: created.body.snapshot.serverNowMs + 30 * MIN,
      durationMinutes: 120,
      clockOffsetMs: 0,
    });
    const r2 = await api.submitEntry(
      created.body.sessionId,
      { sex: 'F', studentNumber: 'OVR-BEF', override: true },
      created.body.controllerKey,
    );
    expect(r2.status).toBe(201);
  });

  test('T2-FT3-03: Controller override=true succeeds in AFTER_END', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    await api.patchConfig(created.body.sessionId, created.body.controllerKey, {
      startTimeMs: created.body.snapshot.serverNowMs,
      durationMinutes: 120,
      clockOffsetMs: 130 * MIN,
    });

    const r = await api.submitEntry(
      created.body.sessionId,
      { sex: 'M', studentNumber: 'OVR-AFTER', override: true },
      created.body.controllerKey,
    );
    expect(r.status).toBe(201);
    expect(r.body.entry.override).toBe(true);
  });

  test('T2-FT3-04: Controller enter without override during LAST_20_MIN returns 403, while override=true returns 200', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const added = await api.submitEntry(s.sessionId, {
      sex: 'M',
      studentNumber: 'WAIT-L20',
    });

    await api.patchConfig(s.sessionId, s.controllerKey, {
      startTimeMs: s.snapshot.serverNowMs,
      durationMinutes: 120,
      clockOffsetMs: 110 * MIN,
    });

    const blocked = await api.entryAction(s.sessionId, added.body.entry.id, s.controllerKey, {
      action: 'enter',
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('OUTSIDE_TIME_WINDOW');

    const allowed = await api.entryAction(s.sessionId, added.body.entry.id, s.controllerKey, {
      action: 'enter',
      override: true,
    });
    expect(allowed.status).toBe(200);
  });

  test('T2-FT3-05: Controller override=true still enforces DUPLICATE_STUDENT (409)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();

    await api.submitEntry(
      created.body.sessionId,
      { sex: 'M', studentNumber: 'DUP-OVR', override: true },
      created.body.controllerKey,
    );
    const dup = await api.submitEntry(
      created.body.sessionId,
      { sex: 'M', studentNumber: 'DUP-OVR', override: true },
      created.body.controllerKey,
    );
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_STUDENT');
  });

  test('T2-FT3-06: Controller override=true still enforces BATHROOM_OCCUPIED (409)', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();

    const m1 = await api.submitEntry(
      created.body.sessionId,
      { sex: 'M', studentNumber: 'M1', override: true },
      created.body.controllerKey,
    );
    const m2 = await api.submitEntry(
      created.body.sessionId,
      { sex: 'M', studentNumber: 'M2', override: true },
      created.body.controllerKey,
    );
    await api.entryAction(created.body.sessionId, m1.body.entry.id, created.body.controllerKey, {
      action: 'enter',
      override: true,
    });

    const rej = await api.entryAction(
      created.body.sessionId,
      m2.body.entry.id,
      created.body.controllerKey,
      { action: 'enter', override: true },
    );
    expect(rej.status).toBe(409);
    expect(rej.body.code).toBe('BATHROOM_OCCUPIED');
  });

  // F-T4 (5 tests)
  test('T2-FT4-01: Clear on brand-new empty session succeeds idempotently and increments clearedSeq', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const created = await api.createSession();
    const seq0 = created.body.snapshot.clearedSeq;

    const clr = await api.clear(created.body.sessionId, created.body.controllerKey);
    expect(clr.status).toBe(200);
    expect(clr.body.snapshot.entries).toEqual([]);
    expect(clr.body.snapshot.clearedSeq).toBeGreaterThan(seq0);
  });

  test('T2-FT4-02: Clear wipes queued, in_bathroom, returned, and removed entries together', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const e1 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'E1' });
    const e2 = await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'E2' });
    await api.submitEntry(s.sessionId, { sex: 'M', studentNumber: 'E3' });
    const e4 = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'E4' });

    await api.entryAction(s.sessionId, e1.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, e1.body.entry.id, s.controllerKey, { action: 'return' });
    await api.entryAction(s.sessionId, e2.body.entry.id, s.controllerKey, { action: 'enter' });
    await api.entryAction(s.sessionId, e4.body.entry.id, s.controllerKey, { action: 'remove' });

    const clr = await api.clear(s.sessionId, s.controllerKey);
    expect(clr.status).toBe(200);
    expect(clr.body.snapshot.entries).toEqual([]);
    expect(clr.body.snapshot.nextBySex).toEqual({ M: null, F: null });
  });

  test('T2-FT4-03: Re-submitting previously in_bathroom studentNumber after clear succeeds with 201', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);
    const e = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'REUSE-F' });
    await api.entryAction(s.sessionId, e.body.entry.id, s.controllerKey, { action: 'enter' });

    await api.clear(s.sessionId, s.controllerKey);
    const reSub = await api.submitEntry(s.sessionId, { sex: 'F', studentNumber: 'REUSE-F' });
    expect(reSub.status).toBe(201);
  });

  test('T2-FT4-04: Clear without x-controller-key returns 401 or 403', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const s = await createConfiguredSession(api);

    const res = await api.clear(s.sessionId, null);
    expect([401, 403]).toContain(res.status);
  });

  test('T2-FT4-05: Clear on nonexistent session returns 404', async ({
    request,
  }) => {
    const api = new ExamQApiClient(request);
    const res = await api.clear('nonexistent-clear-id', 'any-key');
    expect(res.status).toBe(404);
  });
});
