import { describe, expect, it } from "vitest";
import { elapsedSeconds, formatElapsedDuration } from "./duration";

describe("duration formatting", () => {
  it("uses milliseconds for durations under one second", () => {
    expect(formatElapsedDuration(0)).toBe("0ms");
    expect(formatElapsedDuration(0.347)).toBe("347ms");
    expect(formatElapsedDuration(0.9999)).toBe("999ms");
  });

  it("floors elapsed whole seconds instead of rounding up", () => {
    expect(formatElapsedDuration(1.999)).toBe("1s");
    expect(formatElapsedDuration(240.999)).toBe("4m");
  });

  it("omits a zero seconds suffix from exact minutes", () => {
    expect(formatElapsedDuration(240)).toBe("4m");
    expect(formatElapsedDuration(241)).toBe("4m 1s");
  });

  it("converts timestamps without discarding sub-second precision", () => {
    expect(elapsedSeconds(1_000, 1_347)).toBe(0.347);
  });
});
