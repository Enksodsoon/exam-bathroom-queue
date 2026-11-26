import { expect, test, type Page } from "@playwright/test";

interface ErrorRecorder {
  consoleErrors: string[];
  pageErrors: string[];
}

function attachErrorListeners(page: Page): ErrorRecorder {
  const recorder: ErrorRecorder = {
    consoleErrors: [],
    pageErrors: [],
  };
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      recorder.consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    recorder.pageErrors.push(err.message);
  });
  return recorder;
}

async function createConfiguredSessionViaApi(page: Page) {
  const createRes = await page.request.post("/api/sessions", { data: {} });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as {
    sessionId: string;
    controllerKey: string;
    joinUrl: string;
    controllerUrl: string;
    snapshot: { inviteCode: string };
  };

  const cfgRes = await page.request.patch(
    `/api/sessions/${created.sessionId}/config`,
    {
      headers: { "x-controller-key": created.controllerKey },
      data: {
        startTimeMs: Date.now() - 40 * 60_000,
        durationMinutes: 120,
      },
    },
  );
  expect(cfgRes.status()).toBe(200);
  return created;
}

test.describe("Tier 5 Adversarial UI & Resilience E2E", () => {
  test("displays visible sync error on initial 500 for Controller and Staff and recovers automatically on 200 (Bug 2 & Bug 6)", async ({
    browser,
    page,
  }) => {
    const controllerErrors = attachErrorListeners(page);
    const created = await createConfiguredSessionViaApi(page);

    // Controller: intercept first 2 GETs with 500 JSON, then allow 200
    let ctrlGetCount = 0;
    await page.route(`**/api/sessions/${created.sessionId}**`, async (route) => {
      if (route.request().method() === "GET") {
        ctrlGetCount += 1;
        if (ctrlGetCount <= 2) {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Storage temporarily unavailable",
              code: "STORAGE_MISCONFIGURED",
            }),
          });
          return;
        }
      }
      await route.continue();
    });

    await page.goto(created.controllerUrl);
    const ctrlInitialAlert = page.getByTestId("initial-sync-error");
    await expect(ctrlInitialAlert).toBeVisible();
    await expect(ctrlInitialAlert).toHaveAttribute("role", "alert");
    await expect(ctrlInitialAlert).toHaveText("Reconnecting…");

    // Recovers automatically when server returns 200
    await expect(
      page.getByTestId("window-status-badge"),
    ).toBeVisible({ timeout: 10_000 });
    expect(controllerErrors.pageErrors).toEqual([]);
    expect(
      controllerErrors.consoleErrors.filter((m) => !m.includes("500")),
    ).toEqual([]);

    // Staff with pre-existing identity: intercept initial GET with 500 HTML (tests Bug 2 + non-JSON error resilience)
    const joinRes = await page.request.post(
      `/api/sessions/${created.sessionId}/join`,
      { data: { label: "Hall Recovery", inviteCode: created.snapshot.inviteCode } },
    );
    expect(joinRes.status()).toBe(200);
    const joined = (await joinRes.json()) as {
      staffId: string;
      label: string;
      staffToken: string;
    };

    const staffCtx = await browser.newContext({
      viewport: page.viewportSize() ?? undefined,
    });
    await staffCtx.addInitScript(
      ({ sid, identity }) => {
        window.sessionStorage.setItem(
          `examq_staff_${sid}`,
          JSON.stringify(identity),
        );
      },
      {
        sid: created.sessionId,
        identity: {
          staffId: joined.staffId,
          label: joined.label,
          staffToken: joined.staffToken,
        },
      },
    );

    const staffPage = await staffCtx.newPage();
    const staffErrors = attachErrorListeners(staffPage);
    let staffGetCount = 0;
    await staffPage.route(
      `**/api/sessions/${created.sessionId}**`,
      async (route) => {
        if (route.request().method() === "GET") {
          staffGetCount += 1;
          if (staffGetCount <= 2) {
            await route.fulfill({
              status: 500,
              contentType: "text/html",
              body: "<html><body>500 Gateway Error</body></html>",
            });
            return;
          }
        }
        await route.continue();
      },
    );

    try {
      await staffPage.goto(created.joinUrl);
      const staffInitialAlert = staffPage.getByTestId("initial-sync-error");
      await expect(staffInitialAlert).toBeVisible();
      await expect(staffInitialAlert).toHaveAttribute("role", "alert");
      await expect(staffInitialAlert).toHaveText("Reconnecting…");

      await expect(
        staffPage.getByRole("button", { name: "Hall Recovery" }),
      ).toBeVisible({ timeout: 10_000 });
      expect(staffErrors.pageErrors).toEqual([]);
      expect(
        staffErrors.consoleErrors.filter((m) => !m.includes("500")),
      ).toEqual([]);
    } finally {
      await staffCtx.close();
    }
  });

  test("handles mid-session 5xx recovery, ahead-version unchanged force-full, and mid-session 404 transition", async ({
    page,
  }) => {
    const errors = attachErrorListeners(page);
    const created = await createConfiguredSessionViaApi(page);

    await page.goto(created.controllerUrl);
    await expect(
      page.getByTestId("window-status-badge"),
    ).toBeVisible();

    let mode: "normal" | "500" | "ahead" | "404" = "500";
    let sawForceFullAfterAhead = false;

    await page.route(`**/api/sessions/${created.sessionId}**`, async (route) => {
      const req = route.request();
      if (req.method() !== "GET") {
        await route.continue();
        return;
      }

      if (mode === "500") {
        mode = "ahead";
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Transient 500", code: "INTERNAL" }),
        });
        return;
      }

      if (mode === "ahead" && req.url().includes("sinceVersion=")) {
        mode = "normal";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            unchanged: true,
            version: 999,
            serverNowMs: Date.now(),
            effectiveNowMs: Date.now(),
            windowStatus: "ALLOWED",
          }),
        });
        return;
      }

      if (mode === "normal" && !req.url().includes("sinceVersion=")) {
        sawForceFullAfterAhead = true;
      }

      if (mode === "404") {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "Not found", code: "NOT_FOUND" }),
        });
        return;
      }

      await route.continue();
    });

    // Mid-session 500 shows a short reconnect status, then recovers
    await expect(page.getByText(/Reconnecting…/)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Reconnecting…/)).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect
      .poll(() => sawForceFullAfterAhead, { timeout: 10_000 })
      .toBe(true);

    // Mid-session 404 transitions to Session Not Found screen
    mode = "404";
    await expect(
      page.getByRole("heading", { name: "Session Not Found" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: "Back to Home" })).toBeVisible();

    expect(errors.pageErrors).toEqual([]);
    expect(
      errors.consoleErrors.filter(
        (m) => !m.includes("500") && !m.includes("404"),
      ),
    ).toEqual([]);
  });

  test("post-clear brand-new late-joiner receives exactly 1 audio & 1 vibrate alert for 1 new student (Bug 1)", async ({
    browser,
    page,
  }) => {
    const controllerErrors = attachErrorListeners(page);
    const created = await createConfiguredSessionViaApi(page);

    // Generate 4 pre-clear alerts via API
    for (const num of ["PRE-1", "PRE-2", "PRE-3", "PRE-4"]) {
      const subRes = await page.request.post(
        `/api/sessions/${created.sessionId}/entries`,
        {
          headers: { "x-controller-key": created.controllerKey },
          data: { sex: "M", studentNumber: num },
        },
      );
      expect(subRes.status()).toBe(201);
      const subBody = (await subRes.json()) as { entry: { id: string } };
      const enterRes = await page.request.post(
        `/api/sessions/${created.sessionId}/entries/${subBody.entry.id}/action`,
        {
          headers: { "x-controller-key": created.controllerKey },
          data: { action: "enter" },
        },
      );
      expect(enterRes.status()).toBe(200);
      const retRes = await page.request.post(
        `/api/sessions/${created.sessionId}/entries/${subBody.entry.id}/action`,
        {
          headers: { "x-controller-key": created.controllerKey },
          data: { action: "return" },
        },
      );
      expect(retRes.status()).toBe(200);
    }

    // Clear session (clearedSeq = 1, lastNextAlert = null)
    const clearRes = await page.request.post(
      `/api/sessions/${created.sessionId}/clear`,
      { headers: { "x-controller-key": created.controllerKey }, data: {} },
    );
    expect(clearRes.status()).toBe(200);

    // Brand-new staff client joins after clear while lastNextAlert === null
    const staffCtx = await browser.newContext({
      viewport: page.viewportSize() ?? undefined,
    });
    await staffCtx.addInitScript(() => {
      const calls: number[][] = [];
      Object.defineProperty(window, "__vibrateCalls", {
        value: calls,
        writable: false,
      });
      Object.defineProperty(Navigator.prototype, "vibrate", {
        configurable: true,
        value: (pattern: number | number[]) => {
          calls.push(Array.isArray(pattern) ? pattern : [pattern]);
          return true;
        },
      });
    });

    const staffPage = await staffCtx.newPage();
    const staffErrors = attachErrorListeners(staffPage);

    try {
      await staffPage.goto(created.joinUrl);
      await staffPage.locator("#staff-label-input").fill("Late Joiner");
      await staffPage.getByRole("button", { name: "Join Session" }).click();
      await expect(
        staffPage.getByRole("button", { name: "Late Joiner" }),
      ).toBeVisible();

      const telemetry = staffPage.getByTestId("alert-telemetry");
      await expect(telemetry).toHaveAttribute("data-audio-alert-count", "0");
      await expect(telemetry).toHaveAttribute("data-vibrate-alert-count", "0");

      // Submit 1 post-clear student
      await page.goto(created.controllerUrl);
      await page.locator("#controller-student-number").fill("POST-1");
      await page.getByRole("button", { name: "Add Student" }).click();

      await expect(
        staffPage
          .getByTestId("next-student-alert")
          .getByText("#POST-1"),
      ).toBeVisible({ timeout: 10_000 });
      await expect(telemetry).toHaveAttribute("data-audio-alert-count", "1");
      await expect(telemetry).toHaveAttribute("data-vibrate-alert-count", "1");
      await expect(telemetry).toHaveAttribute("data-last-alert-seq", "5");

      const alertDetails = await staffPage.evaluate(() => ({
        stats: (window as unknown as { __examqAlertStats?: unknown })
          .__examqAlertStats,
        vibrateLen: (window as unknown as { __vibrateCalls?: number[][] })
          .__vibrateCalls?.length,
      }));
      expect(alertDetails.vibrateLen).toBe(1);
      expect(alertDetails.stats).toMatchObject({
        audioAlertCount: 1,
        vibrateAlertCount: 1,
        visualAlertCount: 1,
        lastAlertSeq: 5,
      });

      expect(controllerErrors.consoleErrors).toEqual([]);
      expect(controllerErrors.pageErrors).toEqual([]);
      expect(staffErrors.consoleErrors).toEqual([]);
      expect(staffErrors.pageErrors).toEqual([]);
    } finally {
      await staffCtx.close();
    }
  });

  test("ignores malformed BroadcastChannel payloads without React crash (Bug 3)", async ({
    page,
  }) => {
    const errors = attachErrorListeners(page);
    const created = await createConfiguredSessionViaApi(page);

    await page.goto(created.controllerUrl);
    await expect(
      page.getByTestId("window-status-badge"),
    ).toBeVisible();

    await page.evaluate((sid) => {
      const ch = new BroadcastChannel(`examq_session_${sid}`);
      ch.postMessage("not-an-object");
      ch.postMessage({ type: "SNAPSHOT", snapshot: null });
      ch.postMessage({
        type: "SNAPSHOT",
        snapshot: { id: sid, version: 999, clearedSeq: 0 },
      });
      ch.postMessage({
        type: "SNAPSHOT",
        snapshot: {
          id: sid,
          createdAt: Date.now(),
          version: 999,
          clearedSeq: 0,
          serverNowMs: Date.now(),
          effectiveNowMs: Date.now(),
          windowStatus: "BOGUS_STATUS",
          examConfig: null,
          entries: [],
          staff: [],
          nextBySex: { M: null, F: null },
          lastNextAlert: null,
        },
      });
      ch.close();
    }, created.sessionId);

    // UI remains intact and unaffected
    await expect(
      page.getByTestId("window-status-badge"),
    ).toBeVisible();
    await expect(page.getByTestId("window-status-badge")).toHaveAttribute(
      "data-window-status",
      "ALLOWED",
    );
    expect(errors.pageErrors).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
  });

  test("survives AudioContext throwing, resume() rejecting, and navigator.vibrate throwing or returning false", async ({
    browser,
    page,
  }) => {
    const created = await createConfiguredSessionViaApi(page);

    const ctx = await browser.newContext({
      viewport: page.viewportSize() ?? undefined,
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: class ThrowingAudioContext {
          constructor() {
            throw new Error("AudioContext blocked");
          }
        },
      });
      Object.defineProperty(window, "webkitAudioContext", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(Navigator.prototype, "vibrate", {
        configurable: true,
        value: () => {
          throw new Error("Vibrate blocked");
        },
      });
    });

    const staffPage = await ctx.newPage();
    const errors = attachErrorListeners(staffPage);

    try {
      await staffPage.goto(created.joinUrl);
      await staffPage.locator("#staff-label-input").fill("Audio Fail Test");
      await staffPage.getByRole("button", { name: "Join Session" }).click();
      await expect(
        staffPage.getByRole("button", { name: "Audio Fail Test" }),
      ).toBeVisible();

      const subRes = await page.request.post(
        `/api/sessions/${created.sessionId}/entries`,
        {
          headers: { "x-controller-key": created.controllerKey },
          data: { sex: "F", studentNumber: "RES-1" },
        },
      );
      expect(subRes.status()).toBe(201);

      await expect(
        staffPage
          .getByTestId("next-student-alert")
          .getByText("#RES-1"),
      ).toBeVisible({ timeout: 10_000 });

      const telemetry = staffPage.getByTestId("alert-telemetry");
      await expect(telemetry).toHaveAttribute("data-audio-alert-count", "0");
      await expect(telemetry).toHaveAttribute("data-vibrate-alert-count", "0");
      expect(errors.pageErrors).toEqual([]);
      expect(errors.consoleErrors).toEqual([]);
    } finally {
      await ctx.close();
    }

    // Second variant: resume() rejects and vibrate() returns false
    const ctx2 = await browser.newContext({
      viewport: page.viewportSize() ?? undefined,
    });
    await ctx2.addInitScript(() => {
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: class RejectingResumeAudioContext {
          state = "suspended";
          currentTime = 0;
          destination = {};
          resume() {
            return Promise.reject(new Error("NotAllowedError"));
          }
          createGain() {
            return {
              gain: {
                setValueAtTime: () => {},
                exponentialRampToValueAtTime: () => {},
              },
              connect: () => {},
            };
          }
          createOscillator() {
            return {
              type: "sine",
              frequency: { setValueAtTime: () => {} },
              connect: () => {},
              start: () => {},
              stop: () => {},
            };
          }
        },
      });
      Object.defineProperty(Navigator.prototype, "vibrate", {
        configurable: true,
        value: () => false,
      });
    });

    const staffPage2 = await ctx2.newPage();
    const errors2 = attachErrorListeners(staffPage2);
    try {
      await staffPage2.goto(created.joinUrl);
      await staffPage2.locator("#staff-label-input").fill("Resume Reject Test");
      await staffPage2.getByRole("button", { name: "Join Session" }).click();
      await expect(
        staffPage2.getByRole("button", { name: "Resume Reject Test" }),
      ).toBeVisible();

      const subRes2 = await page.request.post(
        `/api/sessions/${created.sessionId}/entries`,
        {
          headers: { "x-controller-key": created.controllerKey },
          data: { sex: "M", studentNumber: "RES-2" },
        },
      );
      expect(subRes2.status()).toBe(201);

      await expect(
        staffPage2
          .getByTestId("next-student-alert")
          .getByText("#RES-2"),
      ).toBeVisible({ timeout: 10_000 });
      await expect(staffPage2.getByTestId("alert-telemetry")).toHaveAttribute(
        "data-vibrate-alert-count",
        "0",
      );
      expect(errors2.pageErrors).toEqual([]);
      expect(errors2.consoleErrors).toEqual([]);
    } finally {
      await ctx2.close();
    }
  });

  test("handles rapid double-clicks cleanly and clears stored controllerKey on tampered ?key=", async ({
    browser,
    page,
  }) => {
    const errors = attachErrorListeners(page);

    // Rapid double-click on Create Exam Session
    await page.goto("/");
    const createBtn = page.getByRole("button", { name: "Create Exam Session" });
    await createBtn.dblclick();
    await expect(
      page.getByTestId("window-status-badge"),
    ).toBeVisible({ timeout: 10_000 });

    const sessionId = new URL(page.url()).pathname.replace(/^\/s\//, "");
    const storedKeyBefore = await page.evaluate(
      (id) => window.sessionStorage.getItem(`examq_controller_key_${id}`),
      sessionId,
    );
    expect(storedKeyBefore).toBeTruthy();

    // Configure into ALLOWED
    await page.getByRole("button", { name: "Exam Timer Settings" }).click();
    await page.getByRole("button", { name: "Set Start = Now" }).click();
    await page.locator("#exam-duration-minutes").fill("120");
    await page.locator("#exam-clock-offset").fill("35");
    await page.getByRole("button", { name: "Save Exam Config" }).click();
    await expect(page.getByText("Timer saved.")).toBeVisible();

    // Staff rapid double-click on Join Session and Submit Student
    const staffCtx = await browser.newContext({
      viewport: page.viewportSize() ?? undefined,
    });
    const staffPage = await staffCtx.newPage();
    const staffErrors = attachErrorListeners(staffPage);

    try {
      await staffPage.goto(`/s/${sessionId}`);
      await staffPage.locator("#staff-label-input").fill("Double Clicker");
      await staffPage.getByRole("button", { name: "Join Session" }).dblclick();
      await expect(
        staffPage.getByRole("button", { name: "Double Clicker" }),
      ).toBeVisible();

      await staffPage.locator("#staff-student-number").fill("DBL-1");
      await staffPage.getByRole("button", { name: "Submit Student" }).dblclick();
      await expect(
        staffPage.getByText(/#DBL-1 added/),
      ).toBeVisible();
      await expect(staffPage.getByTestId("staff-submit-error")).toHaveCount(0);
    } finally {
      await staffCtx.close();
    }

    // Controller rapid double-click on Enter Bathroom and Confirm Clear
    const dblItem = page
      .getByTestId("queue-column-M")
      .locator("li[data-student-number='DBL-1']");
    await expect(dblItem).toBeVisible({ timeout: 10_000 });
    await dblItem.getByRole("button", { name: "Enter Bathroom" }).dblclick();
    await expect(
      page.getByTestId("occupancy-M").getByText("#DBL-1"),
    ).toBeVisible();
    await expect(page.getByTestId("controller-queue-error")).toHaveCount(0);

    await page.getByRole("button", { name: "Clear Session" }).click();
    await page.getByRole("button", { name: /Confirm Clear|Force Clear/i }).dblclick();
    await expect(
      page.getByText("Session cleared."),
    ).toBeVisible();

    // Tampered ?key= clears stored controllerKey and falls back to Staff Join view
    await page.goto(`/s/${sessionId}?key=tampered-invalid-key`);
    await expect(
      page.getByRole("heading", { name: "Staff Check-In" }),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("key"))
      .toBeNull();
    const storedKeyAfter = await page.evaluate(
      (id) => window.sessionStorage.getItem(`examq_controller_key_${id}`),
      sessionId,
    );
    expect(storedKeyAfter).toBeNull();

    expect(errors.pageErrors).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
    expect(staffErrors.pageErrors).toEqual([]);
    expect(staffErrors.consoleErrors).toEqual([]);
  });
});
