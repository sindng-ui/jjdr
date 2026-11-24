import { describe, expect, it } from "vitest";
import { detectCodeLanguage, highlightCodeLine } from "./codeHighlighter";

describe("codeHighlighter", () => {
  it("detects common source languages by file extension", () => {
    expect(detectCodeLanguage("src/engine/Render.cpp")).toBe("cpp");
    expect(detectCodeLanguage("src-tauri/src/lib.rs")).toBe("rust");
    expect(detectCodeLanguage("src/App.tsx")).toBe("typescript");
    expect(detectCodeLanguage("package.json")).toBe("json");
    expect(detectCodeLanguage("Cargo.toml")).toBe("toml");
    expect(detectCodeLanguage("notes.unknown")).toBe("plain");
  });

  it("highlights keywords, strings, and comments while escaping HTML safely", () => {
    const cpp = highlightCodeLine('const char* s = "<script>"; // note', "cpp");
    expect(cpp).toContain('class="cv-keyword">const</span>');
    expect(cpp).toContain('class="cv-string">&quot;&lt;script&gt;&quot;</span>');
    expect(cpp).toContain('class="cv-comment">// note</span>');
    expect(cpp).not.toContain("<script>");

    const preproc = highlightCodeLine("#include <vector>", "cpp");
    expect(preproc).toContain('class="cv-preproc"');
    expect(preproc).toContain("&lt;vector&gt;");
  });
});
