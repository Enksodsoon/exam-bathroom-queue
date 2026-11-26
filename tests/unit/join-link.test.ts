import { describe, expect, it } from "vitest";
import { resolveExamJoinPath } from "@/lib/client/joinLink";

const origin = "https://examq.example";

describe("ExamQ staff join links", () => {
  it("keeps the staff invitation on the same site without forwarding other values", () => {
    expect(resolveExamJoinPath(`${origin}/s/synthetic-1?invite=ABC-1&key=local-demo`, origin))
      .toBe("/s/synthetic-1?invite=ABC-1");
  });
  it("keeps legacy IDs available for manual entry only", () => {
    expect(resolveExamJoinPath("synthetic-1", origin)).toBe("/s/synthetic-1");
    expect(resolveExamJoinPath("synthetic-1", origin, true)).toBeNull();
    expect(resolveExamJoinPath("/s/synthetic-1", origin, true)).toBeNull();
  });
  it.each([
    "https://other.example/s/synthetic-1?invite=ABC-1",
    "//other.example/s/synthetic-1?invite=ABC-1",
    "javascript:alert(1)",
    "/s/synthetic-1/another?invite=ABC-1",
    "/s/synthetic-1?key=local-demo",
  ])("does not navigate scans outside the staff invite flow (%s)", (value) => {
    expect(resolveExamJoinPath(value, origin, true)).toBeNull();
  });
});
