import { expect, test } from "@playwright/test";

test("light/dark mode and Thai/English language toggle persist across Home, Controller, and Staff", async ({
  browser,
  page,
}) => {
  await page.goto("/");

  // Default English
  await expect(page.getByRole("heading", { name: "Bathroom Queue" })).toBeVisible();
  await expect(page.getByTestId("author-footer")).toContainText(
    "© 2026 Piyakawin Sodsoon · Creator & Developer",
  );

  // Toggle to Dark mode
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  // Toggle to Thai
  await page.getByTestId("locale-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(page.getByRole("heading", { name: "คิวเข้าห้องน้ำห้องสอบ" })).toBeVisible();
  await expect(page.getByTestId("author-footer")).toContainText(
    "© 2026 ปิยกวิน สดสุ่น · ผู้พัฒนาและออกแบบระบบ",
  );

  // Reload and verify persistence
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(page.getByRole("heading", { name: "คิวเข้าห้องน้ำห้องสอบ" })).toBeVisible();

  // Create session -> Controller inherits Thai + Dark
  await page.getByRole("button", { name: "Create Exam Session" }).click();
  await expect(page.getByTestId("window-status-badge")).toHaveText("ยังไม่ตั้งเวลา");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  // Switch back to English and Light mode on Controller
  await page.getByTestId("locale-toggle").click();
  await expect(page.getByTestId("window-status-badge")).toHaveText("Unconfigured");
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

  // Staff context can also switch to Thai + Dark independently
  const staffCtx = await browser.newContext();
  try {
    const staffPage = await staffCtx.newPage();
    await page.getByRole("button", { name: "Share QR Code" }).click();
    const joinUrl = await page.getByRole("textbox", { name: "Staff Join Link" }).inputValue();
    await staffPage.goto(joinUrl);
    await staffPage.getByTestId("locale-toggle").click();
    await staffPage.getByTestId("theme-toggle").click();
    await expect(staffPage.getByRole("heading", { name: "ลงชื่อผู้ช่วยคุมสอบ" })).toBeVisible();
    await expect(staffPage.locator("html")).toHaveClass(/\bdark\b/);
  } finally {
    await staffCtx.close();
  }
});
