import { expect, test } from "@playwright/test";
import QRCode from "qrcode";

test("a staff QR camera frame opens check-in; a plain browser receives the live alert", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create Exam Session" }).click();
  await expect(page.getByTestId("window-status-badge")).toBeVisible();
  await page.getByRole("button", { name: "Exam Timer Settings" }).click();
  const local = await page.evaluate(() => {
    const d = new Date(Date.now() - 35 * 60_000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await page.locator("#exam-start-time").fill(local);
  await page.locator("#exam-duration-minutes").fill("90");
  await page.getByRole("button", { name: "Save Exam Config" }).click();
  await expect(page.getByTestId("window-status-badge")).toHaveText("Bathroom Window Open");
  await page.getByRole("button", { name: "Share QR Code" }).click();
  const invite = await page.getByRole("textbox", { name: "Staff Join Link" }).inputValue();
  const image = await QRCode.toDataURL(invite, { width: 440, margin: 4 });
  const staffCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await staffCtx.addInitScript((dataUrl) => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async (options: MediaStreamConstraints) => {
          if (options.audio !== false) throw new Error("Camera flow must not ask for audio");
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 440;
          const img = new Image();
          img.src = dataUrl;
          await img.decode();
          const ctx = canvas.getContext("2d")!;
          const stream = canvas.captureStream(10);
          const track = stream.getVideoTracks()[0];
          const originalStop = track.stop.bind(track);
          const timer = window.setInterval(() => ctx.drawImage(img, 0, 0), 100);
          track.stop = () => {
            window.clearInterval(timer);
            sessionStorage.setItem("synthetic-camera-stopped", "yes");
            originalStop();
          };
          ctx.drawImage(img, 0, 0);
          return stream;
        },
      });
    }, image);
    const staff = await staffCtx.newPage();
    const home = await staff.goto("/");
    expect(home?.headers()["permissions-policy"]).toContain("camera=(self)");
    await staff.getByRole("button", { name: "Scan QR code" }).click();
    await expect(staff.getByRole("heading", { name: "Staff Check-In" })).toBeVisible({ timeout: 12000 });
    expect(new URL(staff.url()).searchParams.get("invite")).toBe(new URL(invite).searchParams.get("invite"));
    expect(await staff.evaluate(() => sessionStorage.getItem("synthetic-camera-stopped"))).toBe("yes");
    await staff.locator("#staff-label-input").fill("Synthetic Proctor");
    await staff.getByRole("button", { name: "Join Session" }).click();
    await expect(staff.getByText("Live in this tab")).toBeVisible();
    await staff.getByRole("button", { name: "Test in-tab alert" }).click();
    await expect(staff.getByRole("status").filter({ hasText: "Test alert." })).toBeVisible();
    await page.getByRole("button", { name: "Male",exact: true }).click();
    await page.locator("#controller-student-number").fill("SYN-NEXT");
    await page.getByRole("button", { name: "Add Student" }).click();
    await expect(staff.getByTestId("next-student-alert")).toContainText("SYN-NEXT");
    await expect(staff.getByTestId("alert-telemetry")).toHaveAttribute("data-audio-alert-count", "1");
  } finally {
    await staffCtx.close();
  }
});

test("denied camera still leaves a usable join path and close restores focus", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable:true,
      value: async () => { throw new DOMException("Denied locally", "NotAllowedError"); },
    });
  });
  await page.goto("/");
  const scan = page.getByRole("button", { name: "Scan QR code" });
  await scan.click();
  await expect(page.getByRole("status").filter({ hasText: /Camera blocked/ })).toBeVisible();
  await expect(page.locator("#join-session-input")).toBeVisible();
  await page.getByRole("button", { name: "Close scanner" }).click();
  await expect(scan).toBeFocused();
});
