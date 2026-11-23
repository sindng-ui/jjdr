export interface AgentOption {
  id: string;
  label: string;
  cmd: string;
  safeCmd: string;
  hint: string;
}

export const AGENT_OPTIONS: AgentOption[] = [
  {
    id: "agy",
    label: "Antigravity (agy)",
    cmd: "agy",
    safeCmd: "agy",
    hint: "Google Antigravity CLI (--dangerously-skip-permissions)",
  },
  {
    id: "claude",
    label: "Claude Code",
    cmd: "claude",
    safeCmd: "claude",
    hint: "Anthropic Claude CLI (--dangerously-skip-permissions)",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    cmd: "gemini",
    safeCmd: "gemini",
    hint: "Google Gemini CLI (-y)",
  },
  {
    id: "codex",
    label: "Codex",
    cmd: "codex --no-daemon",
    safeCmd: "codex --no-daemon",
    hint: "OpenAI Codex CLI (--dangerously-bypass-approvals-and-sandbox)",
  },
];

export const RESUME_AGENT_OPTIONS: AgentOption[] = [
  {
    id: "agy",
    label: "Antigravity (agy)",
    cmd: "agy",
    safeCmd: "agy",
    hint: "New autonomous session",
  },
  {
    id: "agy-c",
    label: "agy --continue",
    cmd: "agy --continue",
    safeCmd: "agy --continue",
    hint: "Resume latest",
  },
  {
    id: "claude",
    label: "Claude Code",
    cmd: "claude",
    safeCmd: "claude",
    hint: "New autonomous session",
  },
  {
    id: "claude-c",
    label: "claude --continue",
    cmd: "claude --continue",
    safeCmd: "claude --continue",
    hint: "Resume latest",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    cmd: "gemini",
    safeCmd: "gemini",
    hint: "New autonomous session",
  },
  {
    id: "codex",
    label: "Codex",
    cmd: "codex --no-daemon",
    safeCmd: "codex --no-daemon",
    hint: "New autonomous session",
  },
];

export function formatEffectiveCommand(cmd: string, autonomous: boolean): string {
  const parts = cmd.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const bin = parts[0].toLowerCase();
  const out = [...parts];

  if (bin === "codex" && !out.includes("--no-daemon")) {
    out.push("--no-daemon");
  }
  if (autonomous) {
    if (
      (bin === "agy" || bin === "claude") &&
      !out.includes("--dangerously-skip-permissions")
    ) {
      out.push("--dangerously-skip-permissions");
    } else if (bin === "gemini" && !out.includes("-y") && !out.includes("--yolo")) {
      out.push("-y");
    } else if (
      bin === "codex" &&
      !out.includes("--dangerously-bypass-approvals-and-sandbox") &&
      !out.includes("--yolo")
    ) {
      out.push("--dangerously-bypass-approvals-and-sandbox");
    }
  }
  return out.join(" ");
}

export const DEFAULT_PROJECT_GROUPS = ["Default", "Work", "Side", "Personal"];

export const BRANCH_PREFIXES = ["feat/", "fix/", "refactor/", "chore/"];
