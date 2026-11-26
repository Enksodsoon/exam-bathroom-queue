import { expect, test, type Browser, type Page } from "@playwright/test";

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

async function assertResponsiveLayout(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const overflow =
      document.documentElement.scrollWidth > window.innerWidth
        ? {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          }
        : null;

    const smallControls: Array<{ tag: string; text: string; height: number }> =
      [];
    const elements = document.querySelectorAll<HTMLElement>(
      "button, a, input:not([type='checkbox'])",
    );

    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        continue;
      }
      if (rect.height < 43.5) {
        smallControls.push({
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || el.getAttribute("aria-label") || el.id || "")
            .trim()
            .slice(0, 40),
          height: Math.round(rect.height * 10) / 10,
        });
      }
    }

    return { overflow, smallControls };
  });

  expect(metrics.overflow).toBeNull();
  expect(metrics.smallControls).toEqual([]);
}

async function createConfiguredControllerSession(
  page: Page,
  offsetMinutes = 35,
): Promise<{ sessionId: string; shareUrl: string }> {
  await page.goto("/");
  await assertResponsiveLayout(page);

  await page.getByRole("button", { name: "Create Exam Session" }).click();
  await expect(
    page.getByTestId("window-status-badge"),
  ).toBeVisible();

  await expect
    .poll(() => new URL(page.url()).searchParams.get("key"))
    .toBeNull();

  const sessionId = new URL(page.url()).pathname.replace(/^\/s\//, "");

  const storedKey = await page.evaluate(
    (id) => window.sessionStorage.getItem(`examq_controller_key_${id}`),
    sessionId,
  );
  expect(storedKey).toBeTruthy();

  await page.getByRole("button", { name: "Share QR Code" }).click();
  const qrSvg = page.locator("svg[role='img'][data-qr-url]");
  await expect(qrSvg).toBeVisible();
  const shareUrl = await qrSvg.getAttribute("data-qr-url");
  expect(shareUrl).toBeTruthy();
  expect(shareUrl).toContain(`/s/${sessionId}`);
  expect(shareUrl).not.toContain("key=");
  expect(shareUrl).not.toContain(storedKey!);

  await page.getByRole("button", { name: "Exam Timer Settings" }).click();
  await page.getByRole("button", { name: "Set Start = Now" }).click();
  await page.locator("#exam-duration-minutes").fill("120");
  await page.locator("#exam-clock-offset").fill(String(offsetMinutes));
  await page.getByRole("button", { name: "Save Exam Config" }).click();
  await expect(page.getByText("Timer saved.")).toBeVisible();

  return { sessionId, shareUrl: shareUrl! };
}

async function openJoinedStaffPage(
  browser: Browser,
  shareUrl: string,
  staffLabel: string,
  viewport?: { width: number; height: number },
): Promise<{
  page: Page;
  errors: ErrorRecorder;
  close: () => Promise<void>;
}> {
  const context = await browser.newContext(
    viewport ? { viewport } : undefined,
  );
  await context.addInitScript(() => {
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

  const page = await context.newPage();
  const errors = attachErrorListeners(page);

  await page.goto(shareUrl);
  await expect(
    page.getByRole("heading", { name: "Staff Check-In" }),
  ).toBeVisible();
  await assertResponsiveLayout(page);

  await page.getByRole("button", { name: "Join Session" }).click();
  await expect(
    page.getByText("Enter your name or hall label."),
  ).toBeVisible();

  await page.locator("#staff-label-input").fill("A".repeat(41));
  await page.getByRole("button", { name: "Join Session" }).click();
  await expect(
    page.getByText("Max 40 characters."),
  ).toBeVisible();

  await page.locator("#staff-label-input").fill(staffLabel);
  await page.getByRole("button", { name: "Join Session" }).click();
  await expect(page.getByRole("button", { name: staffLabel })).toBeVisible();

  return {
    page,
    errors,
    close: () => context.close(),
  };
}

test.describe("M3 Exam Bathroom Queue E2E", () => {
  test("multi-client sync, QR safety, opposite-sex concurrency, 409 guard, reorder, return, remove", async ({
    browser,
    page,
  }) => {
    const controllerErrors = attachErrorListeners(page);
    const { sessionId, shareUrl } = await createConfiguredControllerSession(
      page,
      35,
    );

    const viewport = page.viewportSize() ?? undefined;
    const staff = await openJoinedStaffPage(
      browser,
      shareUrl,
      "Proctor Hall 1",
      viewport,
    );

    try {
      await expect(
        staff.page.getByTestId("window-status-badge"),
      ).toHaveAttribute("data-window-status", "ALLOWED");
      await expect(
        staff.page.getByRole("button", { name: "Enter Bathroom" }),
      ).toHaveCount(0);
      await expect(
        staff.page.getByRole("button", { name: "Clear Session" }),
      ).toHaveCount(0);

      // Staff submits M101, M102, F201
      await staff.page.getByRole("button", { name: "Male", exact: true }).click();
      await staff.page.locator("#staff-student-number").fill("M101");
      await staff.page.getByRole("button", { name: "Submit Student" }).click();
      await expect(
        staff.page.getByText(/#M101 added/),
      ).toBeVisible();

      await staff.page.locator("#staff-student-number").fill("M102");
      await staff.page.getByRole("button", { name: "Submit Student" }).click();
      await expect(
        staff.page.getByText(/#M102 added/),
      ).toBeVisible();

      await staff.page.getByRole("button", { name: "Female", exact: true }).click();
      await staff.page.locator("#staff-student-number").fill("F201");
      await staff.page.getByRole("button", { name: "Submit Student" }).click();
      await expect(
        staff.page.getByText(/#F201 added/),
      ).toBeVisible();

      // Controller sees all 3 without reload
      const maleCol = page.getByTestId("queue-column-M");
      const femaleCol = page.getByTestId("queue-column-F");
      await expect(maleCol.getByText("#M101")).toBeVisible();
      await expect(maleCol.getByText("#M102")).toBeVisible();
      await expect(femaleCol.getByText("#F201")).toBeVisible();

      // Controller marks M101 and F201 in_bathroom simultaneously
      await maleCol
        .locator("li[data-student-number='M101']")
        .getByRole("button", { name: "Enter Bathroom" })
        .click();
      await expect(
        page.getByTestId("occupancy-M").getByText("#M101"),
      ).toBeVisible();

      await femaleCol
        .locator("li[data-student-number='F201']")
        .getByRole("button", { name: "Enter Bathroom" })
        .click();
      await expect(
        page.getByTestId("occupancy-F").getByText("#F201"),
      ).toBeVisible();

      // Attempting second Male enter while M101 occupied triggers 409 rejection
      await maleCol
        .locator("li[data-student-number='M102']")
        .getByRole("button", { name: "Enter Bathroom" })
        .click();
      await expect(page.getByTestId("controller-queue-error")).toBeVisible();

      // Staff adds M103, controller moves M103 up ahead of M102
      await staff.page.getByRole("button", { name: "Male", exact: true }).click();
      await staff.page.locator("#staff-student-number").fill("M103");
      await staff.page.getByRole("button", { name: "Submit Student" }).click();

      const m103Item = maleCol.locator("li[data-student-number='M103']");
      await expect(m103Item).toBeVisible();
      await m103Item.getByRole("button", { name: "Move Up" }).click();
      await expect(
        maleCol.locator("ol li").first().getByText("#M103"),
      ).toBeVisible();

      // Controller marks M101 returned and removes M102
      await page
        .getByTestId("occupancy-M")
        .getByRole("button", { name: "Mark Returned" })
        .click();
      await expect(
        page.getByTestId("occupancy-M").getByText("Vacant", { exact: true }),
      ).toBeVisible();

      await maleCol
        .locator("li[data-student-number='M102']")
        .getByRole("button", { name: "Remove" })
        .click();
      await expect(
        maleCol.locator("ol li[data-student-number='M102']"),
      ).toHaveCount(0);

      // Staff view automatically converges without reload
      await expect(
        staff.page.getByTestId("occupancy-M").getByText("Vacant", { exact: true }),
      ).toBeVisible();
      await expect(
        staff.page.getByTestId("occupancy-F").getByText("#F201"),
      ).toBeVisible();
      await expect(
        staff.page.getByTestId("queue-column-M").locator("ol li").first(),
      ).toContainText("#M103");

      // Verify Home Page Join Existing Session + per-session sessionStorage isolation
      const homeContext = await browser.newContext(
        viewport ? { viewport } : undefined,
      );
      const homePage = await homeContext.newPage();
      const homeErrors = attachErrorListeners(homePage);
      try {
        await homePage.goto("/");
        await homePage.locator("#join-session-input").fill(shareUrl);
        await homePage.getByRole("button", { name: "Join Session" }).click();
        await expect(homePage).toHaveURL(shareUrl);
        await expect(
          homePage.getByRole("heading", { name: "Staff Check-In" }),
        ).toBeVisible();
        expect(homeErrors.consoleErrors).toEqual([]);
        expect(homeErrors.pageErrors).toEqual([]);
      } finally {
        await homeContext.close();
      }

      await page.goto("/");
      await page.getByRole("button", { name: "Create Exam Session" }).click();
      await expect(
        page.getByTestId("window-status-badge"),
      ).toBeVisible();
      const secondSessionId = new URL(page.url()).pathname.replace(/^\/s\//, "");
      expect(secondSessionId).not.toBe(sessionId);
      const keysStillIsolated = await page.evaluate(
        ([firstId, secondId]) => ({
          first: window.sessionStorage.getItem(`examq_controller_key_${firstId}`),
          second: window.sessionStorage.getItem(
            `examq_controller_key_${secondId}`,
          ),
        }),
        [sessionId, secondSessionId],
      );
      expect(keysStillIsolated.first).toBeTruthy();
      expect(keysStillIsolated.second).toBeTruthy();
      expect(keysStillIsolated.first).not.toBe(keysStillIsolated.second);

      await assertResponsiveLayout(page);
      await assertResponsiveLayout(staff.page);

      const unexpectedControllerErrors = controllerErrors.consoleErrors.filter(
        (msg) => !msg.includes("409 (Conflict)"),
      );
      expect(unexpectedControllerErrors).toEqual([]);
      expect(controllerErrors.pageErrors).toEqual([]);
      expect(staff.errors.consoleErrors).toEqual([]);
      expect(staff.errors.pageErrors).toEqual([]);
    } finally {
      await staff.close();
    }
  });

  test("next-student alerts: no false fire on initial join, audio/vibrate telemetry, mute toggle, clear reset", async ({
    browser,
    page,
  }) => {
    const controllerErrors = attachErrorListeners(page);
    const { shareUrl } = await createConfiguredControllerSession(page, 35);

    // Pre-populate queue with M301 and M302 before staff joins
    await page.getByRole("button", { name: "Male", exact: true }).click();
    await page.locator("#controller-student-number").fill("M301");
    await page.getByRole("button", { name: "Add Student" }).click();
    await expect(page.getByTestId("queue-column-M").getByText("#M301")).toBeVisible();

    await page.locator("#controller-student-number").fill("M302");
    await page.getByRole("button", { name: "Add Student" }).click();
    await expect(page.getByTestId("queue-column-M").getByText("#M302")).toBeVisible();

    await page.locator("#controller-student-number").fill("M303");
    await page.getByRole("button", { name: "Add Student" }).click();
    await expect(page.getByTestId("queue-column-M").getByText("#M303")).toBeVisible();

    const viewport = page.viewportSize() ?? undefined;
    const staff = await openJoinedStaffPage(
      browser,
      shareUrl,
      "Proctor Alert",
      viewport,
    );

    try {
      const telemetry = staff.page.getByTestId("alert-telemetry");
      await expect(telemetry).toHaveAttribute("data-audio-alert-count", "0");
      await expect(telemetry).toHaveAttribute("data-vibrate-alert-count", "0");
      await expect(staff.page.getByTestId("next-student-alert")).toHaveCount(0);

      // Transition NEXT from M301 -> M302
      await page
        .getByTestId("queue-column-M")
        .locator("li[data-student-number='M301']")
        .getByRole("button", { name: "Enter Bathroom" })
        .click();

      await expect(
        staff.page
          .getByTestId("next-student-alert")
          .getByText("#M302"),
      ).toBeVisible();
      await expect(telemetry).toHaveAttribute("data-audio-alert-count", "0");
      await expect(telemetry).toHaveAttribute("data-vibrate-alert-count", "0");

      const statsAfterFirst = await staff.page.evaluate(() => ({
        stats: (window as unknown as { __examqAlertStats?: unknown })
          .__examqAlertStats,
      }));
      expect(statsAfterFirst.stats).toMatchObject({
        audioAlertCount: 0,
        vibrateAlertCount: 0,
        visualAlertCount: 1,
        muted: false,
      });

      // Mute alerts, then transition NEXT from M302 -> M303
      await staff.page.getByRole("button", { name: "Mute Alerts" }).click();
      await expect(telemetry).toHaveAttribute("data-alerts-muted", "true");

      await page
        .getByTestId("occupancy-M")
        .getByRole("button", { name: "Mark Returned" })
        .click();
      await page
        .getByTestId("queue-column-M")
        .locator("li[data-student-number='M302']")
        .getByRole("button", { name: "Enter Bathroom" })
        .click();

      await expect(
        staff.page
          .getByTestId("next-student-alert")
          .getByText("#M303"),
      ).toBeVisible();
      await expect(telemetry).toHaveAttribute("data-audio-alert-count", "0");
      await expect(telemetry).toHaveAttribute("data-vibrate-alert-count", "0");

      // Clear session dismisses active alert and resets all queues across clients
      await page.getByRole("button", { name: "Clear Session" }).click();
      await page.getByRole("button", { name: /Confirm Clear|Force Clear/i }).click();

      await expect(staff.page.getByTestId("next-student-alert")).toHaveCount(0);
      await expect(
        staff.page.getByTestId("queue-column-M").getByText("Empty queue"),
      ).toBeVisible();
      await expect(
        staff.page.getByTestId("occupancy-M").getByText("Vacant", { exact: true }),
      ).toBeVisible();

      await assertResponsiveLayout(page);
      await assertResponsiveLayout(staff.page);

      expect(controllerErrors.consoleErrors).toEqual([]);
      expect(controllerErrors.pageErrors).toEqual([]);
      expect(staff.errors.consoleErrors).toEqual([]);
      expect(staff.errors.pageErrors).toEqual([]);
    } finally {
      await staff.close();
    }
  });

  test("time-window enforcement (FIRST_30_MIN and LAST_20_MIN) + controller override add & enter", async ({
    browser,
    page,
  }) => {
    const controllerErrors = attachErrorListeners(page);
    const { shareUrl } = await createConfiguredControllerSession(page, 0);

    await expect(page.getByTestId("window-status-badge")).toHaveAttribute(
      "data-window-status",
      "FIRST_30_MIN",
    );

    const viewport = page.viewportSize() ?? undefined;
    const staff = await openJoinedStaffPage(
      browser,
      shareUrl,
      "Proctor Window",
      viewport,
    );

    try {
      await expect(
        staff.page.getByTestId("window-status-badge"),
      ).toHaveAttribute("data-window-status", "FIRST_30_MIN");
      await expect(
        staff.page.getByTestId("staff-window-block-notice"),
      ).toBeVisible();

      // Staff blocked during FIRST_30_MIN
      await staff.page.locator("#staff-student-number").fill("W100");
      await staff.page.getByRole("button", { name: "Submit Student" }).click();
      await expect(staff.page.getByTestId("staff-submit-error")).toBeVisible();
      await expect(
        page.getByTestId("queue-column-M").getByText("#W100"),
      ).toHaveCount(0);

      // Controller enables override -> adds W101 and marks Enter Bathroom outside window
      await page
        .getByRole("switch", { name: /Controller Override/i }).click();
      await page.locator("#controller-student-number").fill("W101");
      await page.getByRole("button", { name: "Add Student" }).click();
      await expect(
        page.getByTestId("queue-column-M").getByText("#W101"),
      ).toBeVisible();

      await page
        .getByRole("switch", { name: /Controller Override/i })
        .click();
      await page
        .getByTestId("queue-column-M")
        .locator("li[data-student-number='W101']")
        .getByRole("button", { name: "Enter Bathroom" })
        .click();
      await expect(
        page.getByTestId("occupancy-M").getByText("#W101"),
      ).toBeVisible();

      // Switch offset to +105m (LAST_20_MIN for 120m exam) -> staff still blocked
      await page.getByRole("button", { name: "+105m" }).click();
      await page.getByRole("button", { name: "Save Exam Config" }).click();
      await expect(page.getByTestId("window-status-badge")).toHaveAttribute(
        "data-window-status",
        "LAST_20_MIN",
      );

      await expect(
        staff.page.getByTestId("window-status-badge"),
      ).toHaveAttribute("data-window-status", "LAST_20_MIN");
      await staff.page.locator("#staff-student-number").fill("W102");
      await staff.page.getByRole("button", { name: "Submit Student" }).click();
      await expect(staff.page.getByTestId("staff-submit-error")).toBeVisible();

      // Switch offset to +35m (ALLOWED) -> staff succeeds
      await page.getByRole("button", { name: "+35m" }).click();
      await page.getByRole("button", { name: "Save Exam Config" }).click();
      await expect(
        staff.page.getByTestId("window-status-badge"),
      ).toHaveAttribute("data-window-status", "ALLOWED");

      await staff.page.locator("#staff-student-number").fill("W103");
      await staff.page.getByRole("button", { name: "Submit Student" }).click();
      await expect(
        staff.page.getByText(/#W103 added/),
      ).toBeVisible();

      await assertResponsiveLayout(page);
      await assertResponsiveLayout(staff.page);

      const unexpectedStaffErrors = staff.errors.consoleErrors.filter(
        (msg) => !msg.includes("403 (Forbidden)"),
      );
      expect(controllerErrors.consoleErrors).toEqual([]);
      expect(controllerErrors.pageErrors).toEqual([]);
      expect(unexpectedStaffErrors).toEqual([]);
      expect(staff.errors.pageErrors).toEqual([]);
    } finally {
      await staff.close();
    }
  });
});
