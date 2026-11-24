import { describe, expect, it } from "vitest";
import { isMarkdownFile, renderMarkdownToHtml } from "./markdownRenderer";

describe("markdownRenderer", () => {
  it("renders headings, tables, code blocks, alerts, and task lists", () => {
    const sample = [
      "# Hello World",
      "",
      "> [!TIP]",
      "> Fast viewer",
      "",
      "| Col A | Col B |",
      "| :--- | ---: |",
      "| **bold** | `code` |",
      "",
      "- [x] Done",
      "- [ ] Todo",
      "",
      "```ts",
      "const x = 1 < 2;",
      "```",
    ].join("\n");

    const html = renderMarkdownToHtml(sample);
    expect(html).toContain("<h1 id=\"hello-world\">Hello World</h1>");
    expect(html).toContain("md-alert-tip");
    expect(html).toContain("<table>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('type="checkbox" disabled checked');
    expect(html).toContain("const x = 1 &lt; 2;");
  });

  it("escapes raw script tags and blocks javascript: URLs", () => {
    const xss = `<script>alert(1)</script> [click](javascript:alert(2))`;
    const html = renderMarkdownToHtml(xss);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
  });

  it("detects markdown file extensions accurately", () => {
    expect(isMarkdownFile("README.md")).toBe(true);
    expect(isMarkdownFile("docs/GUIDE.MDX")).toBe(true);
    expect(isMarkdownFile("src/App.tsx")).toBe(false);
  });
});
