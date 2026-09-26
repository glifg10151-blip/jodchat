import { describe, expect, it } from "vitest";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { de } from "./de";
import { zh } from "./zh";
import { ja } from "./ja";

describe("translation dictionary parity", () => {
  it.each([
    ["es", es],
    ["fr", fr],
    ["de", de],
    ["zh", zh],
    ["ja", ja],
  ])("keeps %s keys in parity with English", (_locale, dictionary) => {
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort());
  });
});
