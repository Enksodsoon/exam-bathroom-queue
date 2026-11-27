import { expect, test } from "@playwright/test";

test("controller and staff automatically save sessions and can resume after leaving or closing a tab", async ({
  browser,
}) => {
  // 1. Controller creates a session, leaves to /, closes tab, opens a new tab, and resumes
  const ctrlCtx = await browser.newContext();
  const ctrlTab1 = await ctrlCtx.newPage();
  await ctrlTab1.goto("/");
  await ctrlTab1.getByRole("button", { name: "Create Exam Session" }).click();
  await ctrlTab1.waitForURL(/\/s\/.+/, { timeout: 20000 });
  const sessionUrl = ctrlTab1.url();
  const sessionId = sessionUrl.match(/\/s\/([^/?#]+)/)?.[1] ?? "";
  expect(sessionId.length).toBeGreaterThan(0);

  await ctrlTab1.getByRole("button", { name: "Share QR Code" }).click();
  const staffJoinUrl = await ctrlTab1.getByLabel("Staff Join Link").inputValue();

  // Close the first tab completely
  await ctrlTab1.close();

  // Open a fresh tab in the same browser context -> Resume card is on Home /
  const ctrlTab2 = await ctrlCtx.newPage();
  await ctrlTab2.goto("/");
  await expect(ctrlTab2.getByTestId("resume-sessions-card")).toBeVisible();
  await ctrlTab2.getByTestId(`resume-session-${sessionId}`).click();
  await ctrlTab2.waitForURL(new RegExp(`/s/${sessionId}`), { timeout: 15000 });
  await expect(ctrlTab2.getByRole("button", { name: "Exam Timer Settings" })).toBeVisible();

  // 2. Staff joins, closes tab, opens a fresh tab on /, and resumes as Staff
  const staffCtx = await browser.newContext();
  const staffTab1 = await staffCtx.newPage();
  await staffTab1.goto(staffJoinUrl);
  await staffTab1.getByPlaceholder("Your name or room").fill("Row C");
  await staffTab1.getByRole("button", { name: "Join Session" }).click();
  await expect(staffTab1.getByTestId("dual-queue-summary")).toBeVisible();
  await staffTab1.close();

  const staffTab2 = await staffCtx.newPage();
  await staffTab2.goto("/");
  await expect(staffTab2.getByTestId("resume-sessions-card")).toContainText("Row C");
  await staffTab2.getByTestId(`resume-session-${sessionId}`).click();
  await staffTab2.waitForURL(new RegExp(`/s/${sessionId}`), { timeout: 15000 });
  await expect(staffTab2.getByTestId("dual-queue-summary")).toBeVisible();
  await expect(staffTab2.getByTitle("Switch Staff")).toContainText("Row C");

  // 3. Controller clicks End Room -> Confirm Delete -> deletes room from DB & removes from Resume
  await ctrlTab2.getByTestId("end-room-button").click();
  await ctrlTab2.getByTestId("confirm-end-room-button").click();
  await ctrlTab2.waitForURL("/", { timeout: 15000 });
  await expect(ctrlTab2.getByTestId(`resume-session-${sessionId}`)).toHaveCount(0);

  // Opening the deleted room returns Session Not Found
  await ctrlTab2.goto(`/s/${sessionId}`);
  await expect(ctrlTab2.getByRole("heading", { name: "Session Not Found" })).toBeVisible();

  await staffCtx.close();
  await ctrlCtx.close();
});
