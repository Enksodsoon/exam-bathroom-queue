import { expect, test } from "@playwright/test";

test("controller adjusts request blocks and proctor sees the same enforced window", async ({ browser, page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create Exam Session" }).click();
  await expect(page.getByTestId("window-status-badge")).toBeVisible();
  await page.getByRole("button", { name: "Exam Timer Settings" }).click();
  const first = page.getByLabel("Block first (minutes)", { exact: true });
  const last = page.getByLabel("Block last (minutes)", { exact: true });
  const save = page.getByRole("button", { name: "Save Exam Config" });
  await expect(first).toHaveValue("30");
  await expect(last).toHaveValue("20");

  const browserLocalStart = await page.evaluate(() => {
    const start = new Date(Date.now() - 12 * 60_000);
    const local = new Date(start.getTime() - start.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  });
  await page.locator("#exam-start-time").fill(browserLocalStart);
  await page.locator("#exam-duration-minutes").fill("90");

  await first.fill("10");
  await last.fill("5");
  await expect(page.getByRole("group", { name: "Bathroom request blocks" }).getByText("75 min", { exact: true })).toBeVisible();
  await save.click();
  await expect(page.getByTestId("window-status-badge")).toHaveText("Bathroom Window Open");
  await expect(page.getByRole("group", { name: /Bathroom request blocks/i }).getByText("75 min")).toBeVisible();
  await page.getByRole("button", { name: "Share QR Code" }).click();
  const joinUrl = await page.getByRole("textbox", { name: "Staff Join Link" }).inputValue();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const staff = await ctx.newPage();
    await staff.goto(joinUrl);
    await staff.locator("#staff-label-input").fill("Synthetic Hall");
    await staff.getByRole("button", { name: "Join Session" }).click();
    const staffStatus = staff.getByTestId("window-status-badge");
    await expect(staffStatus).toHaveText("Bathroom Window Open");
    await expect(staff.getByLabel(/first 10 minutes blocked, final 5 minutes blocked/i)).toBeVisible();

    await page.getByRole("button", { name: "Exam Timer Settings" }).click();
    await first.fill("15");
    await save.click();
    await expect(page.getByTestId("window-status-badge")).toHaveText(/First 15 Minutes/);
    await expect(staffStatus).toHaveText(/First 15 Minutes/);

    await first.fill("0");
    await last.fill("80");
    await save.click();
    await expect(staffStatus).toHaveText(/Last 80 Minutes/);

    await first.fill("20");
    await save.click();
    await expect(page.getByText("Confirm that there is no normal bathroom window before saving.")).toBeVisible();
    await page.getByLabel(/Confirm override-only exam/).check();
    await save.click();
    await expect(staffStatus).toHaveText("No normal request window");

    await first.fill("0");
    await last.fill("0");
    await save.click();
    await expect(staffStatus).toHaveText("Bathroom Window Open");
    await staff.locator("#staff-student-number").fill("SYN-001");
    await staff.getByRole("button", { name: "Submit Student" }).click();
    await expect(page.getByTestId("queue-column-M").getByText("#SYN-001", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reset to 30 / 20" }).click();
    await expect(first).toHaveValue("30");
    await expect(last).toHaveValue("20");
  } finally {
    await ctx.close();
  }
});
