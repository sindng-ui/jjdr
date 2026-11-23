import { describe, expect, it } from "vitest";
import { formatEffectiveCommand } from "./agents";

describe("formatEffectiveCommand", () => {
  it("applies default autonomous (YOLO) flags for agy, claude, gemini, and codex", () => {
    expect(formatEffectiveCommand("agy", true)).toBe(
      "agy --dangerously-skip-permissions"
    );
    expect(formatEffectiveCommand("agy --continue", true)).toBe(
      "agy --continue --dangerously-skip-permissions"
    );
    expect(formatEffectiveCommand("claude", true)).toBe(
      "claude --dangerously-skip-permissions"
    );
    expect(formatEffectiveCommand("gemini", true)).toBe("gemini -y");
    expect(formatEffectiveCommand("codex", true)).toBe(
      "codex --no-daemon --dangerously-bypass-approvals-and-sandbox"
    );
  });

  it("does not duplicate existing flags and respects autonomous=false", () => {
    expect(formatEffectiveCommand("gemini -y", true)).toBe("gemini -y");
    expect(formatEffectiveCommand("agy", false)).toBe("agy");
    expect(formatEffectiveCommand("codex", false)).toBe("codex --no-daemon");
  });
});
