import { describe, expect, it } from "vitest";
import { createSession, evaluateExamWindow, getExamWindowBounds, submitStudent, toSessionSnapshot, updateExamConfig } from "@/lib/domain";
import { validateConfigBody } from "@/lib/api/validation";
import { describeWindowStatus } from "@/lib/client/format";

const start = 1_790_000_000_000;
const min = 60_000;
const defaults = { startTimeMs: start, durationMinutes: 90 };
const custom = { ...defaults, firstBlockMinutes: 10, lastBlockMinutes: 5 };

describe("Flexible exam request windows", () => {
  it("uses the legacy 30/20 defaults for saved exams without settings", () => {
    const bounds = getExamWindowBounds(defaults);
    expect(bounds.allowStartMs).toBe(start + 30 * min);
    expect(bounds.allowEndMs).toBe(start + 70 * min);
  });
  it("opens at the configured start boundary and closes at the configured end boundary", () => {
    expect(evaluateExamWindow(custom, start + 10 * min - 1).windowStatus).toBe("FIRST_30_MIN");
    expect(evaluateExamWindow(custom, start + 10 * min).windowStatus).toBe("ALLOWED");
    expect(evaluateExamWindow(custom, start + 85 * min - 1).windowStatus).toBe("ALLOWED");
    expect(evaluateExamWindow(custom, start + 85 * min).windowStatus).toBe("LAST_20_MIN");
  });
  it("supports zero-minute blocks and preserves before-start/after-end boundaries", () => {
    const zero = { ...defaults, firstBlockMinutes: 0, lastBlockMinutes: 0 };
    expect(evaluateExamWindow(zero, start - 1).windowStatus).toBe("BEFORE_START");
    expect(evaluateExamWindow(zero, start).windowStatus).toBe("ALLOWED");
    expect(evaluateExamWindow(zero, start + 90 * min - 1).windowStatus).toBe("ALLOWED");
    expect(evaluateExamWindow(zero, start + 90 * min).windowStatus).toBe("AFTER_END");
  });
  it("never opens when locks overlap or consume the exam", () => {
    for (const first of [50, 51]) {
      const noWindow = { ...defaults, firstBlockMinutes: first, lastBlockMinutes: 40 };
      for (let offset = 0; offset < 90; offset++) {
        expect(evaluateExamWindow(noWindow, start + offset * min).windowStatus).not.toBe("ALLOWED");
      }
    }
  });
  it.each([-1, 1.5, "10", null])("rejects invalid block minutes at the API (%s)", (v) => {
    expect(() => validateConfigBody({ ...defaults, firstBlockMinutes: v })).toThrow();
  });
  it("preserves config through API validation, stored session, and shared snapshot", () => {
    const cfg = validateConfigBody(custom);
    const session = updateExamConfig(createSession(start), cfg, start);
    const snapshot = toSessionSnapshot(session, start + 12 * min);
    expect(snapshot.examConfig).toMatchObject(custom);
    expect(snapshot.windowStatus).toBe("ALLOWED");
    expect(() => submitStudent(session, { studentNumber: "SYN001", sex: "F" }, start + 12 * min)).not.toThrow();
  });
  it("shows the configured duration in both shared blocked-state labels", () => {
    expect(describeWindowStatus("FIRST_30_MIN", custom).label).toContain("10");
    expect(describeWindowStatus("LAST_20_MIN", custom).label).toContain("5");
  });
});
