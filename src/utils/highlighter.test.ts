import { describe, it, expect } from "vitest";
import { highlightCode } from "./highlighter";
import DOMPurify from "dompurify";

describe("highlighter sanitization", () => {
  it("successfully highlights valid code blocks", async () => {
    const code = "const a = 1;";
    const html = await highlightCode(code, "js");
    expect(html).not.toBeNull();
    expect(html).toContain('class="hljs-keyword"');
  });

  it("escapes script tags injected into code as display text", async () => {
    const htmlCode = '<div><script>alert("XSS")</script></div>';
    const htmlResult = await highlightCode(htmlCode, "html");
    expect(htmlResult).not.toBeNull();
    // It should not output raw unescaped script tag
    expect(htmlResult).not.toContain("<script");
    expect(htmlResult).not.toContain("<div");
  });

  it("escapes iframe tags from code as display text", async () => {
    const code = '<div><iframe src="javascript:alert(1)"></iframe></div>';
    const html = await highlightCode(code, "html");
    expect(html).not.toBeNull();
    expect(html).not.toContain("<iframe");
  });

  it("escapes img tags and attributes as display text", async () => {
    const code = '<img src="x" onerror="alert(1)" />';
    const html = await highlightCode(code, "html");
    expect(html).not.toBeNull();
    expect(html).not.toContain("<img");
  });

  it("DOMPurify sanitizes raw unescaped unsafe HTML tags and attributes", () => {
    const unsafeHtml = '<div><script>alert(1)</script><span onclick="alert(2)" class="test">content</span></div>';
    const sanitized = DOMPurify.sanitize(unsafeHtml, {
      ALLOWED_TAGS: ["span", "pre", "code", "br"],
      ALLOWED_ATTR: ["class"],
    });
    // script tag and div tags should be stripped, onclick should be stripped, class and span should be kept
    expect(sanitized).not.toContain("<script>");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).toContain('<span class="test">content</span>');
  });
});
