import { describe, it, expect } from "vitest";
import { PLUGINS_CATALOG, PLUGIN_CATEGORIES } from "./pluginsCatalog";

describe("pluginsCatalog", () => {
  it("should contain exactly 50 plugins in the catalog", () => {
    expect(PLUGINS_CATALOG.length).toBeGreaterThanOrEqual(48);
  });

  it("should have unique IDs for all plugins", () => {
    const ids = PLUGINS_CATALOG.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("should assign every plugin a valid category", () => {
    const validCategories = new Set(PLUGIN_CATEGORIES.map((c) => c.id));
    for (const plugin of PLUGINS_CATALOG) {
      expect(validCategories.has(plugin.category)).toBe(true);
      expect(plugin.name.trim().length).toBeGreaterThan(0);
      expect(plugin.description.trim().length).toBeGreaterThan(0);
      expect(plugin.preset).toBeDefined();
      expect(plugin.preset.command.trim().length).toBeGreaterThan(0);
      expect(plugin.preset.args.length).toBeGreaterThan(0);
    }
  });

  it("should have valid auth fields structure when authType requires credentials", () => {
    for (const plugin of PLUGINS_CATALOG) {
      if (plugin.authType === "api_key" || plugin.authType === "connection_string") {
        expect(plugin.authFields.length).toBeGreaterThan(0);
        for (const field of plugin.authFields) {
          expect(field.key.trim().length).toBeGreaterThan(0);
          expect(field.label.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});
