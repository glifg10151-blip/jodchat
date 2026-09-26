import { describe, it, expect } from "vitest";
import { MAX_INPUT_LENGTH, TITLE_MAX_LENGTH, DEFAULT_TEMPERATURE } from "../config/constants";

describe("constants", () => {
  it("MAX_INPUT_LENGTH is a positive number", () => {
    expect(MAX_INPUT_LENGTH).toBeGreaterThan(0);
  });

  it("TITLE_MAX_LENGTH is a positive number", () => {
    expect(TITLE_MAX_LENGTH).toBeGreaterThan(0);
  });

  it("DEFAULT_TEMPERATURE is between 0 and 2", () => {
    expect(DEFAULT_TEMPERATURE).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_TEMPERATURE).toBeLessThanOrEqual(2);
  });
});
