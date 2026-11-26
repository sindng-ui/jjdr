import { describe, expect, it } from "vitest";
import {
  buildReleaseNotesMarkdown,
  classifyCommit,
  extractChangelogSection,
  parseGitLogOutput,
} from "./generate-release-notes.mjs";

describe("generate-release-notes", () => {
  it("parses git log records with multiline bodies", () => {
    const raw =
      "abcdef123456\x1fabcdef1\x1ffeat(update): add auto updater\x1f- popup UI\n- skip button\nCo-authored-by: Bot <bot@example.com>\x1e" +
      "123456abcdef\x1f123456a\x1ffix(radar): prevent double focus\x1f\x1e";
    const parsed = parseGitLogOutput(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].shortHash).toBe("abcdef1");
    expect(parsed[0].body).toContain("- popup UI");
    expect(parsed[1].subject).toBe("fix(radar): prevent double focus");
  });

  it("classifies conventional commits, strips version-only scope, and filters trailers", () => {
    const entry = classifyCommit({
      hash: "dba70e4000",
      shortHash: "dba70e4",
      subject: "feat(v0.4.3): GitHub Releases auto-update popup",
      body: "- What's New markdown\n- In-app installer\nSigned-off-by: Dev <dev@example.com>",
    });
    expect(entry.category).toBe("feat");
    expect(entry.scope).toBe("");
    expect(entry.description).toBe("GitHub Releases auto-update popup");
    expect(entry.bullets).toEqual(["What's New markdown", "In-app installer"]);

    const scoped = classifyCommit({
      hash: "04e8663000",
      shortHash: "04e8663",
      subject: "perf(terminal): debounce rapid card switches",
      body: "",
    });
    expect(scoped.category).toBe("improve");
    expect(scoped.scope).toBe("terminal");
  });

  it("extracts matching version section from CHANGELOG.md", () => {
    const md = [
      "# Changelog",
      "",
      "## [0.4.4] - 2026-11-27",
      "- 한글 릴리즈 요약 A",
      "- 한글 릴리즈 요약 B",
      "",
      "## [0.4.3] - 2026-11-26",
      "- 이전 버전 요약",
    ].join("\n");

    const sec = extractChangelogSection(md, "v0.4.4");
    expect(sec).toContain("한글 릴리즈 요약 A");
    expect(sec).not.toContain("이전 버전 요약");
  });

  it("builds grouped What's New markdown with commit links and compare footer", () => {
    const md = buildReleaseNotesMarkdown({
      version: "0.4.4",
      previousTag: "v0.4.3",
      repo: "sindng-ui/jjdr",
      commits: [
        {
          hash: "1111111aaaa",
          shortHash: "1111111",
          subject: "feat(updater): add automatic release notes generator",
          body: "- Groups commits by category\n- Supports CHANGELOG.md",
        },
        {
          hash: "2222222bbbb",
          shortHash: "2222222",
          subject: "fix(modal): keep Escape shortcut clean",
          body: "",
        },
        {
          hash: "3333333cccc",
          shortHash: "3333333",
          subject: "Daily Recap, Start Splash",
          body: "",
        },
      ],
    });

    expect(md).toContain("## What's New in v0.4.4");
    expect(md).toContain("### ✨ 새로운 기능");
    expect(md).toContain("**updater**: add automatic release notes generator");
    expect(md).toContain("  - Groups commits by category");
    expect(md).toContain("### 🐛 버그 수정");
    expect(md).toContain("### 📌 주요 변경사항");
    expect(md).toContain(
      "**Full Changelog**: [v0.4.3...v0.4.4](https://github.com/sindng-ui/jjdr/compare/v0.4.3...v0.4.4)"
    );
  });
});
