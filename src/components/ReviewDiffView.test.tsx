import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseGitDiff } from "../utils/gitDiff";
import { ReviewDiffView } from "./ReviewDiffView";

describe("graphical review", () => {
  it("highlights code and replaces patch headers with a file header and omitted-context labels", async () => {
    const [file] = parseGitDiff(`diff --git a/src/test.ts b/src/test.ts
index 123..456 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -71 +71 @@
-const before = 1;
+const after = 2;
`);
    const { container } = render(<ReviewDiffView file={file} />);
    expect(screen.getByRole("region", { name: "Diff for src/test.ts" })).toBeInTheDocument();
    expect(screen.getByText("70 unmodified lines")).toBeInTheDocument();
    expect(screen.getAllByText("1–70")).toHaveLength(1);
    expect(container).not.toHaveTextContent("diff --git");
    expect(container).not.toHaveTextContent("@@");
    expect(container).not.toHaveTextContent("index 123");
    await waitFor(() => expect(screen.getAllByText("const", { exact: true })[0]).toHaveClass("hljs-keyword"));
    expect(screen.getByText("Added line 71:")).toBeInTheDocument();
    expect(screen.getByText("Deleted line 71:")).toBeInTheDocument();
  });

  it("keeps binary patches out of the code view", () => {
    const [file] = parseGitDiff(`diff --git a/image.png b/image.png
GIT binary patch
literal 10
+encoded-data
`);
    render(<ReviewDiffView file={file} />);
    expect(screen.getByText("Binary file changed. No text preview available.")).toBeInTheDocument();
    expect(screen.queryByText(/encoded-data/)).not.toBeInTheDocument();
  });

  it("allows the remaining lines in a large diff to be revealed", () => {
    const [file] = parseGitDiff(`diff --git a/test.txt b/test.txt
new file mode 100644
@@ -0,0 +1,501 @@
${Array.from({ length: 501 }, (_, index) => `+source line ${index + 1}`).join("\n")}`);
    render(<ReviewDiffView file={file} />);
    expect(screen.queryByText("source line 501", { exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more lines (1 remaining)" }));
    expect(screen.getByText("source line 501", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show more lines/ })).not.toBeInTheDocument();
  });

  it("shows line ranges for context omitted between hunks", () => {
    const [file] = parseGitDiff(`diff --git a/src/test.ts b/src/test.ts
--- a/src/test.ts
+++ b/src/test.ts
@@ -1 +1 @@
-before
+after
@@ -6 +6 @@
-older
+newer`);
    render(<ReviewDiffView file={file} />);
    expect(screen.getByText("4 unmodified lines")).toBeInTheDocument();
    expect(screen.getAllByText("2–5")).toHaveLength(1);
  });
});
