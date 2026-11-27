import { expect, test } from "@playwright/test";

test("bilingual instruction manual (/guide) renders all sections, screenshots, and toggles cleanly", async ({
  page,
}) => {
  await page.goto("/");

  // Open /guide from the top bar link
  const guideLink = page.getByTestId("guide-link");
  await expect(guideLink).toBeVisible();
  const guideBox = await guideLink.boundingBox();
  expect(guideBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await guideLink.click();
  await page.waitForURL(/\/guide/);

  await expect(page.getByRole("heading", { name: "ExamQ User Manual" })).toBeVisible();
  await expect(page.getByTestId("guide-section-home-onboarding")).toBeVisible();
  await expect(page.getByTestId("guide-section-reset-sync")).toBeVisible();

  // Verify all 8 annotated screenshots load cleanly
  const images = page.locator("section img");
  await expect(images).toHaveCount(8);
  for (let i = 0; i < 8; i += 1) {
    const img = images.nth(i);
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0))
      .toBe(true);
  }

  // Toggle Thai and verify translated manual headings
  await page.getByTestId("locale-toggle").click();
  await expect(page.getByRole("heading", { name: "คู่มือการใช้งาน ExamQ" })).toBeVisible();
  await expect(page.getByTestId("guide-section-controller-queue")).toContainText(
    "การจัดการคิวสด (ผู้คุมห้อง)",
  );

  // Toggle Dark mode
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  // Toggle back to English & Light mode
  await page.getByTestId("locale-toggle").click();
  await page.getByTestId("theme-toggle").click();
  await expect(page.getByRole("heading", { name: "ExamQ User Manual" })).toBeVisible();
});
