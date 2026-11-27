import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "guide");
const PORT = 3107;
const BASE_URL = process.env.EXAMQ_GUIDE_BASE_URL || `http://127.0.0.1:${PORT}`;

async function waitForHealth(url, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server did not become healthy at ${url} within ${timeoutMs}ms`);
}

async function annotateAndSave(page, items, filename) {
  const resolved = [];
  for (const item of items) {
    const box = await item.locator.boundingBox();
    if (!box) {
      throw new Error(`Missing boundingBox for step ${item.num} in ${filename}`);
    }
    resolved.push({
      num: item.num,
      dx: item.dx ?? 0,
      dy: item.dy ?? -48,
      color: item.color ?? "#059669",
      box,
    });
  }

  await page.evaluate((annotations) => {
    const existing = document.getElementById("examq-guide-overlay");
    if (existing) existing.remove();

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("id", "examq-guide-overlay");
    svg.setAttribute("width", String(window.innerWidth));
    svg.setAttribute("height", String(window.innerHeight));
    svg.style.position = "fixed";
    svg.style.inset = "0";
    svg.style.width = "100vw";
    svg.style.height = "100vh";
    svg.style.pointerEvents = "none";
    svg.style.zIndex = "99999";

    const defs = document.createElementNS(svgNS, "defs");

    const filter = document.createElementNS(svgNS, "filter");
    filter.setAttribute("id", "badge-shadow");
    filter.setAttribute("x", "-30%");
    filter.setAttribute("y", "-30%");
    filter.setAttribute("width", "160%");
    filter.setAttribute("height", "160%");
    const feDrop = document.createElementNS(svgNS, "feDropShadow");
    feDrop.setAttribute("dx", "0");
    feDrop.setAttribute("dy", "2");
    feDrop.setAttribute("stdDeviation", "3");
    feDrop.setAttribute("flood-color", "#0f172a");
    feDrop.setAttribute("flood-opacity", "0.28");
    filter.appendChild(feDrop);
    defs.appendChild(filter);

    const uniqueColors = [...new Set(annotations.map((a) => a.color))];
    for (const color of uniqueColors) {
      const marker = document.createElementNS(svgNS, "marker");
      marker.setAttribute("id", `arrow-${color.replace("#", "")}`);
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "6");
      marker.setAttribute("markerHeight", "6");
      marker.setAttribute("orient", "auto-start-reverse");
      const arrowPath = document.createElementNS(svgNS, "path");
      arrowPath.setAttribute("d", "M 0 1.5 L 9 5 L 0 8.5 z");
      arrowPath.setAttribute("fill", color);
      marker.appendChild(arrowPath);
      defs.appendChild(marker);
    }
    svg.appendChild(defs);

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    for (const a of annotations) {
      const { box, num, dx, dy, color } = a;
      const pad = 4;
      const rx = Math.max(2, box.x - pad);
      const ry = Math.max(2, box.y - pad);
      const rw = box.width + pad * 2;
      const rh = box.height + pad * 2;

      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(rx));
      rect.setAttribute("y", String(ry));
      rect.setAttribute("width", String(rw));
      rect.setAttribute("height", String(rh));
      rect.setAttribute("rx", "10");
      rect.setAttribute("fill", color);
      rect.setAttribute("fill-opacity", "0.08");
      rect.setAttribute("stroke", color);
      rect.setAttribute("stroke-width", "2.5");
      svg.appendChild(rect);

      const targetCenterX = rx + rw / 2;
      const targetCenterY = ry + rh / 2;

      const badgeR = 16;
      const cx = Math.min(vw - badgeR - 6, Math.max(badgeR + 6, targetCenterX + dx));
      const cy = Math.min(vh - badgeR - 6, Math.max(badgeR + 6, targetCenterY + dy));

      // Closest point on target rect border from badge center
      const tx = Math.max(rx, Math.min(cx, rx + rw));
      const ty = Math.max(ry, Math.min(cy, ry + rh));

      const dist = Math.hypot(tx - cx, ty - cy);
      if (dist > badgeR + 4) {
        const ux = (tx - cx) / dist;
        const uy = (ty - cy) / dist;
        const x1 = cx + ux * (badgeR + 2);
        const y1 = cy + uy * (badgeR + 2);
        const x2 = tx - ux * 3;
        const y2 = ty - uy * 3;

        // White halo for contrast
        const halo = document.createElementNS(svgNS, "line");
        halo.setAttribute("x1", String(x1));
        halo.setAttribute("y1", String(y1));
        halo.setAttribute("x2", String(x2));
        halo.setAttribute("y2", String(y2));
        halo.setAttribute("stroke", "#ffffff");
        halo.setAttribute("stroke-width", "5.5");
        halo.setAttribute("stroke-linecap", "round");
        halo.setAttribute("stroke-opacity", "0.9");
        svg.appendChild(halo);

        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
        line.setAttribute("stroke", color);
        line.setAttribute("stroke-width", "3");
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("marker-end", `url(#arrow-${color.replace("#", "")})`);
        svg.appendChild(line);
      }

      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", String(cx));
      circle.setAttribute("cy", String(cy));
      circle.setAttribute("r", String(badgeR));
      circle.setAttribute("fill", color);
      circle.setAttribute("stroke", "#ffffff");
      circle.setAttribute("stroke-width", "2.5");
      circle.setAttribute("filter", "url(#badge-shadow)");
      svg.appendChild(circle);

      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", String(cx));
      text.setAttribute("y", String(cy + 1));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.setAttribute("fill", "#ffffff");
      text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
      text.setAttribute("font-size", "14");
      text.setAttribute("font-weight", "700");
      text.textContent = String(num);
      svg.appendChild(text);
    }

    document.body.appendChild(svg);
  }, resolved);

  await page.screenshot({ path: path.join(OUT_DIR, filename) });
  await page.evaluate(() => {
    document.getElementById("examq-guide-overlay")?.remove();
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let serverProc = null;
  if (!process.env.EXAMQ_GUIDE_BASE_URL) {
    serverProc = spawn("npx", ["next", "start", "-p", String(PORT)], {
      cwd: ROOT,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProc.stderr?.on("data", (d) => process.stderr.write(d));
  }

  let browser;
  try {
    await waitForHealth(BASE_URL);
    browser = await chromium.launch();

    // 1. Home Page
    const homeCtx = await browser.newContext({ viewport: { width: 1100, height: 740 } });
    const homePage = await homeCtx.newPage();
    homePage.on("pageerror", (err) => console.error("[home pageerror]", err.message));
    homePage.on("response", (res) => {
      if (res.status() >= 400) console.error("[home http]", res.status(), res.url());
    });
    await homePage.goto(BASE_URL, { waitUntil: "load" });
    await homePage.getByRole("button", { name: "Create Exam Session" }).waitFor();
    await annotateAndSave(
      homePage,
      [
        { num: 1, locator: homePage.getByTestId("locale-toggle"), dx: -48, dy: 48, color: "#0284c7" },
        { num: 2, locator: homePage.getByTestId("theme-toggle"), dx: 42, dy: 48, color: "#0284c7" },
        { num: 3, locator: homePage.getByRole("button", { name: "Create" }), dx: 0, dy: 64, color: "#059669" },
        { num: 4, locator: homePage.getByRole("button", { name: "Scan QR code" }), dx: 185, dy: -40, color: "#2563eb" },
        { num: 5, locator: homePage.getByPlaceholder("Staff link or code"), dx: -195, dy: 0, color: "#2563eb" },
        { num: 6, locator: homePage.getByRole("button", { name: "Join" }), dx: 64, dy: 58, color: "#2563eb" },
      ],
      "01-home.png",
    );

    // Create a session from Home
    console.log("Clicking Create Exam Session...");
    const [createRes] = await Promise.all([
      homePage.waitForResponse((r) => r.url().includes("/api/sessions") && r.request().method() === "POST"),
      homePage.getByRole("button", { name: "Create Exam Session" }).click(),
    ]);
    console.log("POST /api/sessions status:", createRes.status());
    await homePage.waitForFunction(() => window.location.pathname.startsWith("/s/"), undefined, { timeout: 45000 });
    await homePage.getByRole("button", { name: "Exam Timer Settings" }).waitFor({ timeout: 45000 });

    // 2. Controller Timer Drawer
    const ctrlPage = homePage;
    await ctrlPage.setViewportSize({ width: 1120, height: 860 });
    await ctrlPage.getByRole("button", { name: "Exam Timer Settings" }).click();
    await ctrlPage.getByRole("button", { name: "Set Start = Now" }).waitFor();

    // Set start time 45 mins ago and duration 120 mins so window is ALLOWED
    const pastIso = new Date(Date.now() - 45 * 60 * 1000);
    const pad2 = (n) => String(n).padStart(2, "0");
    const localStart = `${pastIso.getFullYear()}-${pad2(pastIso.getMonth() + 1)}-${pad2(pastIso.getDate())}T${pad2(pastIso.getHours())}:${pad2(pastIso.getMinutes())}`;
    await ctrlPage.getByLabel("Start Time").fill(localStart);
    await ctrlPage.getByLabel("Duration (min)").fill("120");
    await ctrlPage.waitForTimeout(200);

    await annotateAndSave(
      ctrlPage,
      [
        { num: 1, locator: ctrlPage.getByRole("button", { name: "Exam Timer Settings" }), dx: -68, dy: 56, color: "#0284c7" },
        { num: 2, locator: ctrlPage.getByLabel("Start Time"), dx: -145, dy: -46, color: "#059669" },
        { num: 3, locator: ctrlPage.getByRole("button", { name: "Set Start = Now" }), dx: 85, dy: -48, color: "#059669" },
        { num: 4, locator: ctrlPage.getByLabel("Duration (min)"), dx: 0, dy: 62, color: "#059669" },
        { num: 5, locator: ctrlPage.getByLabel("Block first (minutes)"), dx: -155, dy: 58, color: "#d97706" },
        { num: 6, locator: ctrlPage.getByRole("button", { name: "Save Exam Config" }), dx: 125, dy: 52, color: "#059669" },
      ],
      "02-controller-timer.png",
    );

    await ctrlPage.getByRole("button", { name: "Save Exam Config" }).click();
    await ctrlPage.getByText("Timer saved.").waitFor();
    await ctrlPage.getByRole("button", { name: "Exam Timer Settings" }).click();

    // 3. Controller Share QR Drawer
    await ctrlPage.getByRole("button", { name: "Share QR Code" }).click();
    await ctrlPage.getByLabel("Staff Join Link").waitFor();
    const staffJoinUrl = await ctrlPage.getByLabel("Staff Join Link").inputValue();
    await ctrlPage.waitForTimeout(200);

    await annotateAndSave(
      ctrlPage,
      [
        { num: 1, locator: ctrlPage.getByRole("button", { name: "Share QR Code" }), dx: -56, dy: 58, color: "#0284c7" },
        { num: 2, locator: ctrlPage.locator("section svg").first(), dx: -120, dy: 0, color: "#2563eb" },
        { num: 3, locator: ctrlPage.getByRole("button", { name: "Copy Link" }), dx: 0, dy: -52, color: "#059669" },
        { num: 4, locator: ctrlPage.getByRole("button", { name: "Rotate Join Link" }), dx: 40, dy: 54, color: "#d97706" },
        { num: 5, locator: ctrlPage.getByTestId("enlarge-qr-button"), dx: 120, dy: 54, color: "#7c3aed" },
      ],
      "03-controller-share.png",
    );
    await ctrlPage.getByRole("button", { name: "Share QR Code" }).click();

    // 4. Staff Join Page
    const staffCtx = await browser.newContext({ viewport: { width: 960, height: 680 } });
    const staffPage = await staffCtx.newPage();
    await staffPage.goto(staffJoinUrl, { waitUntil: "load" });
    await staffPage.getByPlaceholder("Your name or room").fill("Row A (Proctor)");

    await annotateAndSave(
      staffPage,
      [
        { num: 1, locator: staffPage.getByTestId("locale-toggle"), dx: -54, dy: 48, color: "#0284c7" },
        { num: 2, locator: staffPage.getByPlaceholder("Your name or room"), dx: -195, dy: -46, color: "#2563eb" },
        { num: 3, locator: staffPage.getByRole("button", { name: "Join Session" }), dx: 135, dy: 54, color: "#059669" },
      ],
      "04-staff-join.png",
    );

    await staffPage.getByRole("button", { name: "Join Session" }).click();
    await staffPage.getByTestId("window-status-badge").waitFor();

    // 5. Staff Submit Student & Queue Rules
    await staffPage.getByPlaceholder("Student #").fill("104");
    await staffPage.getByRole("button", { name: "Male", exact: true }).click();
    await staffPage.getByRole("button", { name: "Submit" }).click();
    await staffPage.getByText("#104").first().waitFor();
    await staffPage.getByPlaceholder("Student #").fill("109");

    await annotateAndSave(
      staffPage,
      [
        { num: 1, locator: staffPage.getByTestId("window-status-badge"), dx: 135, dy: -46, color: "#059669" },
        { num: 2, locator: staffPage.getByPlaceholder("Student #"), dx: -165, dy: -48, color: "#2563eb" },
        { num: 3, locator: staffPage.getByRole("button", { name: "Male", exact: true }), dx: 0, dy: -54, color: "#2563eb" },
        { num: 4, locator: staffPage.getByRole("button", { name: "Submit" }), dx: 92, dy: 52, color: "#059669" },
        { num: 5, locator: staffPage.getByTestId("dual-queue-summary"), dx: -180, dy: -42, color: "#7c3aed" },
      ],
      "05-queue-submit.png",
    );
    await staffPage.getByRole("button", { name: "Submit" }).click();
    await staffPage.getByText("#109").first().waitFor();

    // Add one more male and one female for rich Controller queue view
    await staffPage.getByPlaceholder("Student #").fill("115");
    await staffPage.getByRole("button", { name: "Submit" }).click();
    await staffPage.getByText("#115").first().waitFor();

    await staffPage.getByPlaceholder("Student #").fill("205");
    await staffPage.getByRole("button", { name: "Female", exact: true }).click();
    await staffPage.getByRole("button", { name: "Submit" }).click();
    await staffPage.getByText("#205").first().waitFor();

    // 6. Controller Live Queue Management
    await ctrlPage.reload({ waitUntil: "load" });
    await ctrlPage.getByText("#104").first().waitFor();
    // Put #104 into bathroom
    await ctrlPage.getByRole("button", { name: /Enter/i }).first().click();
    await ctrlPage.getByRole("button", { name: "Returned" }).first().waitFor();
    await ctrlPage.waitForTimeout(250);

    await annotateAndSave(
      ctrlPage,
      [
        { num: 1, locator: ctrlPage.getByTestId("occupancy-M"), dx: -130, dy: -48, color: "#d97706" },
        { num: 2, locator: ctrlPage.getByRole("button", { name: "Returned" }).first(), dx: 0, dy: -52, color: "#059669" },
        { num: 3, locator: ctrlPage.getByRole("button", { name: /Enter/i }).first(), dx: -115, dy: 50, color: "#2563eb" },
        { num: 4, locator: ctrlPage.getByRole("button", { name: "Move Up" }).first(), dx: 0, dy: 58, color: "#7c3aed" },
        { num: 5, locator: ctrlPage.getByRole("button", { name: "Remove" }).first(), dx: 72, dy: 58, color: "#dc2626" },
        { num: 6, locator: ctrlPage.getByPlaceholder("Student #"), dx: -155, dy: -48, color: "#0284c7" },
      ],
      "06-controller-queue.png",
    );

    // 7. Mark #104 Returned -> Triggers Next-Up Alert on Staff!
    await ctrlPage.getByRole("button", { name: "Returned" }).first().click();
    await staffPage.getByTestId("next-student-alert").waitFor({ timeout: 10000 });
    await staffPage.waitForTimeout(300);

    await annotateAndSave(
      staffPage,
      [
        { num: 1, locator: staffPage.getByTestId("next-student-alert"), dx: -180, dy: -66, color: "#059669" },
        { num: 2, locator: staffPage.getByTestId("alert-acknowledge-button"), dx: 110, dy: 52, color: "#059669" },
        { num: 3, locator: staffPage.getByRole("button", { name: /Mute Alerts|Unmute Alerts/i }), dx: -90, dy: 54, color: "#2563eb" },
        { num: 4, locator: staffPage.getByTitle("Switch Staff"), dx: 70, dy: 54, color: "#7c3aed" },
      ],
      "07-alerts-push.png",
    );

    // 8. Clear Session & Footer on Controller
    await ctrlPage.getByRole("button", { name: "Clear Session" }).click();
    await ctrlPage.getByRole("button", { name: "Confirm Clear" }).waitFor();
    await ctrlPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await ctrlPage.waitForTimeout(200);

    await annotateAndSave(
      ctrlPage,
      [
        { num: 1, locator: ctrlPage.getByTestId("undo-button"), dx: -95, dy: 52, color: "#7c3aed" },
        { num: 2, locator: ctrlPage.getByTestId("export-csv-button"), dx: -30, dy: 52, color: "#059669" },
        { num: 3, locator: ctrlPage.getByRole("button", { name: "Confirm Clear" }), dx: 55, dy: 56, color: "#dc2626" },
        { num: 4, locator: ctrlPage.getByTestId("guide-link"), dx: 100, dy: 52, color: "#0284c7" },
      ],
      "08-reset-sync.png",
    );

    await staffCtx.close();
    await homeCtx.close();
    console.log("Successfully generated 8 annotated guide screenshots in public/guide/");
  } finally {
    if (browser) await browser.close();
    if (serverProc && serverProc.pid) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(serverProc.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        serverProc.kill("SIGTERM");
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
