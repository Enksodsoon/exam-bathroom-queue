import { expect, test } from "@playwright/test";

test("minimal home and check-in retain named controls, alerts, and critical warnings", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page.getByRole("button", {name:"Scan QR code"})).toBeVisible();
  await expect(page.getByText("1-tap session, timer & QR")).toHaveCount(0);
  await page.getByRole("button", {name:"Create Exam Session"}).click();
  await expect(page.getByTestId("window-status-badge")).toBeVisible();
  await page.getByRole("button", {name:"Exam Timer Settings"}).click();
  await expect(page.getByLabel("Block first (minutes)")).toHaveValue("30");
  await expect(page.getByText("Normal request window: 70 min.", {exact:true})).toBeVisible();
  await page.locator("#exam-duration-minutes").fill("40");
  await expect(page.getByLabel(/Confirm override-only exam/)).toBeVisible();
  await page.getByRole("button", {name:"Share QR Code"}).click();
  const invite = await page.getByRole("textbox", {name:"Staff Join Link"}).inputValue();
  await expect(page.getByRole("button", {name:"Copy Link"})).toBeVisible();

  const ctx = await browser.newContext({viewport:{width:390,height:844}});
  try {
    const staff = await ctx.newPage();
    await staff.goto(invite);
    await expect(staff.getByRole("heading",{name:"Staff Check-In"})).toBeVisible();
    await expect(staff.getByText("Name or room · no password")).toHaveCount(0);
    await staff.getByRole("textbox", {name:"Your Name or Label"}).fill("Synthetic Hall");
    await staff.getByRole("button",{name:"Join Session"}).click();
    await expect(staff.getByTestId("staff-window-block-notice")).toContainText("Timer not set.");
    await staff.getByRole("button", {name:"Test in-tab alert"}).click();
    await expect(staff.getByRole("status").filter({hasText:"Test alert."})).toBeVisible();
    expect(await staff.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await ctx.close();
  }
});
