import { describe, expect, it } from "vitest";
import {
  ApiHttpError,
  isControllerKeyValid,
  verifyControllerKey,
} from "@/lib/api/http";

describe("Controller key validation helpers", () => {
  it("returns true only when expected and provided keys match exactly", () => {
    expect(isControllerKeyValid("secret-key-123", "secret-key-123")).toBe(
      true,
    );
    expect(isControllerKeyValid("secret-key-123", "secret-key-124")).toBe(
      false,
    );
    expect(isControllerKeyValid("secret-key-123", "SECRET-KEY-123")).toBe(
      false,
    );
    expect(isControllerKeyValid("secret-key-123", " secret-key-123 ")).toBe(
      false,
    );
    expect(isControllerKeyValid("secret-key-123", "short")).toBe(false);
  });

  it("returns false when expected or provided key is empty", () => {
    expect(isControllerKeyValid("secret-key-123", "")).toBe(false);
    expect(isControllerKeyValid("", "secret-key-123")).toBe(false);
    expect(isControllerKeyValid("", "")).toBe(false);
  });

  it("verifyControllerKey does not throw on match and throws 403 ApiHttpError on mismatch", () => {
    expect(() =>
      verifyControllerKey("ctrl-key-abc", "ctrl-key-abc"),
    ).not.toThrow();

    let caught: unknown;
    try {
      verifyControllerKey("ctrl-key-abc", "tampered-key");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiHttpError);
    expect(caught).toMatchObject({
      status: 403,
      code: "UNAUTHORIZED",
    });
  });
});
