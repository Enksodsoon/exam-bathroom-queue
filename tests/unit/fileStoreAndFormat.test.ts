import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, type WindowStatus } from "@/lib/domain";
import { FileSessionStore } from "@/lib/storage";
import {
  describeWindowStatus,
  formatTimeOnly,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
  windowBadgeClasses,
} from "@/lib/client/format";

describe("FileSessionStore Rename Retry Recovery & Client Format Helpers", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "examq-fs-unit-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  describe("FileSessionStore EPERM/EBUSY rename retry", () => {
    it("recovers from transient EPERM and EBUSY rename errors and persists updated state", async () => {
      const store = new FileSessionStore(tempDir);
      const session = createSession(1_000, {
        id: "retry-sess",
        controllerKey: "ctrl-retry",
      });
      await store.create(session);

      const realRename = fs.rename.bind(fs);
      let callCount = 0;
      const renameSpy = vi
        .spyOn(fs, "rename")
        .mockImplementation(async (oldPath, newPath) => {
          callCount += 1;
          if (callCount === 1) {
            const err = new Error("EPERM transient") as NodeJS.ErrnoException;
            err.code = "EPERM";
            throw err;
          }
          if (callCount === 2) {
            const err = new Error("EBUSY transient") as NodeJS.ErrnoException;
            err.code = "EBUSY";
            throw err;
          }
          return realRename(oldPath, newPath);
        });

      const updated = await store.mutate("retry-sess", (curr) => ({
        session: { ...curr, version: curr.version + 1 },
        result: curr.version + 1,
      }));

      expect(callCount).toBe(3);
      expect(renameSpy).toHaveBeenCalledTimes(3);
      expect(updated.result).toBe(2);
      expect(updated.session.version).toBe(2);

      const persisted = await store.get("retry-sess");
      expect(persisted?.version).toBe(2);
    });

    it("cleans up temp files and preserves existing session if rename retries exhaust", async () => {
      const store = new FileSessionStore(tempDir);
      const session = createSession(1_000, {
        id: "exhaust-sess",
        controllerKey: "ctrl-exhaust",
      });
      await store.create(session);

      const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async () => {
        const err = new Error("EPERM persistent") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      });

      await expect(
        store.mutate("exhaust-sess", (curr) => ({
          session: { ...curr, version: curr.version + 1 },
          result: null,
        })),
      ).rejects.toThrow("EPERM persistent");

      expect(renameSpy).toHaveBeenCalledTimes(6);

      // Original session file remains intact and no .tmp files remain
      renameSpy.mockRestore();
      const persisted = await store.get("exhaust-sess");
      expect(persisted?.version).toBe(1);
      const files = await fs.readdir(tempDir);
      expect(files).toEqual(["exhaust-sess.json"]);
    });
  });

  describe("Client format helpers", () => {
    it("describes all six WindowStatus values with expected tones", () => {
      const expectedTones: Record<
        WindowStatus,
        "allowed" | "blocked" | "neutral"
      > = {
        UNCONFIGURED: "neutral",
        BEFORE_START: "blocked",
        FIRST_30_MIN: "blocked",
        ALLOWED: "allowed",
        LAST_20_MIN: "blocked",
        AFTER_END: "blocked",
      };

      for (const [status, tone] of Object.entries(expectedTones) as Array<
        [WindowStatus, "allowed" | "blocked" | "neutral"]
      >) {
        const meta = describeWindowStatus(status);
        expect(meta.tone).toBe(tone);
        expect(meta.label.length).toBeGreaterThan(0);
        expect(meta.description.length).toBeGreaterThan(0);
      }
    });

    it("returns distinct badge CSS classes for allowed, blocked, and neutral tones", () => {
      expect(windowBadgeClasses("allowed")).toContain("emerald");
      expect(windowBadgeClasses("blocked")).toContain("rose");
      expect(windowBadgeClasses("neutral")).toContain("amber");
    });

    it("round-trips datetime-local formatting and rejects blank/invalid values", () => {
      const sampleMs = new Date(2026, 10, 25, 9, 5, 0, 0).getTime();
      const localStr = toDateTimeLocalValue(sampleMs);
      expect(localStr).toBe("2026-11-25T09:05");
      expect(fromDateTimeLocalValue(localStr)).toBe(sampleMs);

      expect(fromDateTimeLocalValue("")).toBeNull();
      expect(fromDateTimeLocalValue("   ")).toBeNull();
      expect(fromDateTimeLocalValue("not-a-date")).toBeNull();
    });

    it("formats time-only labels as non-empty strings", () => {
      const formatted = formatTimeOnly(Date.UTC(2026, 10, 25, 14, 30, 15));
      expect(typeof formatted).toBe("string");
      expect(formatted.trim().length).toBeGreaterThan(0);
    });
  });
});
