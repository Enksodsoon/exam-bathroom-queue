import { expect, test } from "@playwright/test";

test("feedback enhancements: dual M/F summary strip, CSV export, staff enter/return, undo, larger QR & popup scanner", async ({
  browser,
}) => {
  const ctrlCtx = await browser.newContext();
  const ctrlPage = await ctrlCtx.newPage();

  await ctrlPage.goto("/");

  // 6. Home QR scanner opens as a popup dialog modal
  await ctrlPage.getByRole("button", { name: "Scan QR code" }).click();
  await expect(ctrlPage.getByTestId("qr-scanner-modal")).toBeVisible();
  await ctrlPage.getByRole("button", { name: "Close scanner" }).click();
  await expect(ctrlPage.getByTestId("qr-scanner-modal")).toBeHidden();

  // Create session
  await ctrlPage.getByRole("button", { name: "Create Exam Session" }).click();
  await ctrlPage.waitForURL(/\/s\/.+/, { timeout: 20000 });

  // Configure exam timer so window is ALLOWED
  await ctrlPage.getByRole("button", { name: "Exam Timer Settings" }).click();
  const pastIso = new Date(Date.now() - 45 * 60_000);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const localStart = `${pastIso.getFullYear()}-${pad2(pastIso.getMonth() + 1)}-${pad2(pastIso.getDate())}T${pad2(pastIso.getHours())}:${pad2(pastIso.getMinutes())}`;
  await ctrlPage.getByLabel("Start Time").fill(localStart);
  await ctrlPage.getByLabel("Duration (min)").fill("120");
  await ctrlPage.getByRole("button", { name: "Save Exam Config" }).click();
  await expect(ctrlPage.getByText("Timer saved.")).toBeVisible();
  await ctrlPage.getByRole("button", { name: "Exam Timer Settings" }).click();

  // 5. Bigger QR + Enlarge QR modal
  await ctrlPage.getByRole("button", { name: "Share QR Code" }).click();
  const qrBox = await ctrlPage.locator("section svg").first().boundingBox();
  expect(qrBox?.width ?? 0).toBeGreaterThanOrEqual(200);
  const staffJoinUrl = await ctrlPage.getByLabel("Staff Join Link").inputValue();

  await ctrlPage.getByTestId("enlarge-qr-button").click();
  await expect(ctrlPage.getByTestId("qr-enlarge-modal")).toBeVisible();
  await ctrlPage.getByRole("button", { name: "Close large QR" }).click();
  await expect(ctrlPage.getByTestId("qr-enlarge-modal")).toBeHidden();
  await ctrlPage.getByRole("button", { name: "Share QR Code" }).click();

  // Staff joins
  const staffCtx = await browser.newContext();
  const staffPage = await staffCtx.newPage();
  await staffPage.goto(staffJoinUrl);
  await staffPage.getByPlaceholder("Your name or room").fill("Row B");
  await staffPage.getByRole("button", { name: "Join Session" }).click();
  await expect(staffPage.getByTestId("dual-queue-summary")).toBeVisible();

  // Submit 1 Male and 1 Female student
  await staffPage.getByPlaceholder("Student #").fill("301");
  await staffPage.getByRole("button", { name: "Male", exact: true }).click();
  await staffPage.getByRole("button", { name: "Submit" }).click();
  await expect(staffPage.getByTestId("queue-column-M")).toContainText("#301");

  await staffPage.getByPlaceholder("Student #").fill("401");
  await staffPage.getByRole("button", { name: "Female", exact: true }).click();
  await staffPage.getByRole("button", { name: "Submit" }).click();
  await expect(staffPage.getByTestId("queue-column-F")).toContainText("#401");

  // 1. Simultaneous M/F summary strip shows both M and F
  await expect(staffPage.getByTestId("dual-summary-M")).toContainText("#301");
  await expect(staffPage.getByTestId("dual-summary-F")).toContainText("#401");
  await expect(ctrlPage.getByTestId("dual-queue-summary")).toBeVisible();

  // 3. Staff has Enter & Return buttons, NOT Move Up/Down/Remove
  await expect(staffPage.getByRole("button", { name: "Enter Bathroom #301" })).toBeVisible();
  await expect(staffPage.getByRole("button", { name: "Move Up #301" })).toHaveCount(0);
  await expect(staffPage.getByRole("button", { name: "Remove #301" })).toHaveCount(0);

  await staffPage.getByRole("button", { name: "Enter Bathroom #301" }).click();
  await expect(staffPage.getByRole("button", { name: "Mark Returned #301" })).toBeVisible();

  // 4. Staff Undo button reverts their Enter action
  await staffPage.getByTestId("undo-button").click();
  await expect(staffPage.getByRole("button", { name: "Enter Bathroom #301" })).toBeVisible();

  // Controller enters & returns #301, then exports CSV
  await ctrlPage.getByRole("button", { name: "Enter Bathroom #301" }).click();
  await expect(ctrlPage.getByRole("button", { name: "Mark Returned #301" })).toBeVisible();
  await ctrlPage.getByRole("button", { name: "Mark Returned #301" }).click();
  await expect(ctrlPage.getByTestId("occupancy-M")).toContainText("Vacant");

  // Controller Undo reverts Return back to In Bathroom
  await ctrlPage.getByTestId("undo-button").click();
  await expect(ctrlPage.getByRole("button", { name: "Mark Returned #301" })).toBeVisible();
  await ctrlPage.getByRole("button", { name: "Mark Returned #301" }).click();

  // 2. Export CSV downloads a file
  const [download] = await Promise.all([
    ctrlPage.waitForEvent("download"),
    ctrlPage.getByTestId("export-csv-button").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^examq-log-.*\.csv$/);

  await staffCtx.close();
  await ctrlCtx.close();
});
