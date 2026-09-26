import { describe, expect, it } from "vitest";
import { joinProjectPath, parseGitDiff } from "./auxiliaryPanelUtils";

describe("parseGitDiff", () => {
  it("groups files and counts changed lines", () => {
    const files = parseGitDiff(`diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-const oldValue = 1;
+const newValue = 2;
 unchanged
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export {};
`);

    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ path: "src/a.ts", additions: 1, deletions: 1, status: "modified" });
    expect(files[1]).toMatchObject({ path: "src/new.ts", additions: 1, deletions: 0, status: "added" });
  });
});

describe("joinProjectPath", () => {
  it("joins root and nested project paths without leading separators", () => {
    expect(joinProjectPath("", "src")).toBe("src");
    expect(joinProjectPath("src/", "/components")).toBe("src/components");
  });
});
