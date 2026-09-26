import { describe, expect, it } from "vitest";
import { getContrastColor, LIGHT_PRESETS, DARK_PRESETS, DEFAULT_THEME_CONFIG } from "./themePresets";

describe("themePresets", () => {
  it("does not include Sythoria Light or Dark presets", () => {
    expect(LIGHT_PRESETS["Sythoria Light"]).toBeUndefined();
    expect(DARK_PRESETS["Sythoria Dark"]).toBeUndefined();
  });

  it("sets Default Light and Default Dark as the defaults in DEFAULT_THEME_CONFIG", () => {
    expect(LIGHT_PRESETS["Default Light"]).toBeDefined();
    expect(DARK_PRESETS["Default Dark"]).toBeDefined();
    expect(DEFAULT_THEME_CONFIG.lightTheme).toEqual(LIGHT_PRESETS["Default Light"]);
    expect(DEFAULT_THEME_CONFIG.darkTheme).toEqual(DARK_PRESETS["Default Dark"]);
  });
});

describe("getContrastColor", () => {
  it("chooses the higher-contrast foreground for bright accents", () => {
    expect(getContrastColor("#3b82f6")).toBe("#000000");
    expect(getContrastColor("#f92672")).toBe("#000000");
    expect(getContrastColor("#ffffff")).toBe("#000000");
  });

  it("uses white for dark accents", () => {
    expect(getContrastColor("#0f172a")).toBe("#ffffff");
    expect(getContrastColor("#000000")).toBe("#ffffff");
  });

  it("supports shorthand colors", () => {
    expect(getContrastColor("#fff")).toBe("#000000");
    expect(getContrastColor("#111")).toBe("#ffffff");
  });
});
