import React, { useEffect, useState } from "react";
import { Bot, Check, PlusCircle, Terminal, X, Zap } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { launchSession } from "../../services/tauriBridge";
import { normalizePath } from "../../workers/dashboardLogic";
import {
  formatEffectiveCommand,
  RESUME_AGENT_OPTIONS,
} from "../../utils/agents";
import {
  countWorktreeLiveShells,
  MAX_SHELLS_PER_WORKTREE,
} from "../../utils/worktreeSessions";

type SessionKind = "ai" | "shell";

interface ShellOption {
  id: string;
  label: string;
  argv: string[];
  hint: string;
}

const SHELL_OPTIONS: ShellOption[] = [
  {
    id: "powershell",
    label: "PowerShell (기본 쉘)",
    argv: [],
    hint: "OS 기본 PowerShell 터미널",
  },
  {
    id: "cmd",
    label: "Command Prompt (cmd)",
    argv: ["cmd.exe"],
    hint: "Windows 명령 프롬프트",
  },
];

export const LaunchSessionModal = React.memo(function LaunchSessionModal() {
  const target = useUiStore((s) => s.launchTarget);
  const setTarget = useUiStore((s) => s.setLaunchTarget);
  const showToast = useUiStore((s) => s.showToast);
  const lastAgentMap = useAppStore((s) => s.lastAgentByWorktree);
  const allSessions = useAppStore((s) => s.computed.allSessions);
  const templates = useAppStore((s) => s.templates);

  const [sessionKind, setSessionKind] = useState<SessionKind>("ai");
  const [selectedShellId, setSelectedShellId] = useState<string>("powershell");
  const [cmdText, setCmdText] = useState("agy");
  const [autonomous, setAutonomous] = useState(true);
  const [customMode, setCustomMode] = useState(false);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (!target) return;
    const saved = lastAgentMap[normalizePath(target.cwd)];
    const initial = saved?.join(" ") || target.defaultAgent || "agy";
    setSessionKind("ai");
    setSelectedShellId("powershell");
    setCmdText(initial);
    const isKnown =
      RESUME_AGENT_OPTIONS.some((o) => o.cmd === initial) ||
      templates.some((t) => t.name === initial);
    setCustomMode(!isKnown);
    setAutonomous(true);
    setPrompt("");
  }, [target, lastAgentMap, templates]);

  if (!target) return null;

  const liveShellCount = countWorktreeLiveShells(
    allSessions,
    target.cwd,
    target.projectId
  );
  const shellLimitReached = liveShellCount >= MAX_SHELLS_PER_WORKTREE;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (sessionKind === "shell" && shellLimitReached) {
      showToast(
        `한 Worktree당 PowerShell은 최대 ${MAX_SHELLS_PER_WORKTREE}개까지 열 수 있습니다.`,
        "info"
      );
      return;
    }

    let argv: string[] = [];
    let toastLabel = "PowerShell";

    if (sessionKind === "shell") {
      const chosen =
        SHELL_OPTIONS.find((s) => s.id === selectedShellId) ?? SHELL_OPTIONS[0];
      argv = chosen.argv;
      toastLabel = chosen.label;
    } else {
      argv = cmdText.trim().split(/\s+/).filter(Boolean);
      if (argv.length === 0) return;
      toastLabel = argv[0];
    }

    const snapTarget = target;
    const snapKind = sessionKind;
    const snapPrompt = prompt.trim() || undefined;
    const snapAutonomous = autonomous;
    const normCwd = normalizePath(snapTarget.cwd);
    const targetCardKey = snapTarget.projectId
      ? `wt::${snapTarget.projectId}::${normCwd}`
      : null;

    // Close modal IMMEDIATELY (0ms) so the user can keep working while session spawns in background
    setTarget(null);
    showToast(`${toastLabel} 백그라운드에서 실행 중...`, "info", 2600);

    void launchSession({
      project_id: snapTarget.projectId,
      cwd: snapTarget.cwd,
      branch: snapTarget.branch,
      argv,
      initial_prompt: snapKind === "ai" ? snapPrompt : undefined,
      autonomous: snapKind === "ai" ? snapAutonomous : false,
    })
      .then((addr) => {
        if (snapKind === "ai" && argv.length > 0) {
          useAppStore.getState().recordLastAgent(normCwd, argv);
        }
        const ui = useUiStore.getState();
        ui.showToast(`${toastLabel} 실행됨 (${addr})`, "success");
        if (addr) {
          if (targetCardKey) {
            ui.rememberCardSession(targetCardKey, addr);
          }
          // Auto-attach only if user hasn't moved on to another card's active terminal
          const sameCardOrIdle =
            !ui.attachedAddress ||
            (targetCardKey !== null && ui.selectedCardKey === targetCardKey);
          if (sameCardOrIdle) {
            ui.setSelectedAddress(addr);
            ui.setAttachedAddress(addr);
          }
        }
      })
      .catch((err) => {
        useUiStore
          .getState()
          .showToast(`세션 실행 실패 (${toastLabel}): ${String(err)}`, "error", 6000);
      });
  };

  const chipStyle = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--accent-soft)" : "var(--input-bg)",
    border: `1px solid ${active ? "var(--accent)" : "var(--input-border)"}`,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
  });

  return (
    <div
      onClick={() => setTarget(null)}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-md rounded-[22px] overflow-hidden"
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <PlusCircle
              className="w-4 h-4 shrink-0"
              style={{ color: "var(--ready-fg)" }}
            />
            <h3
              className="text-sm font-bold truncate"
              style={{ color: "var(--text-primary)" }}
            >
              새 세션 추가 · {target.branch || "Worktree"}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setTarget(null)}
            className="p-1.5 rounded-full hover:bg-black/10 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div
            className="text-[11px] font-mono-code truncate"
            style={{ color: "var(--text-muted)" }}
          >
            {target.cwd}
          </div>

          {/* Section 1: AI CLI */}
          <div className="space-y-2">
            <div
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-secondary)" }}
            >
              <Bot className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
              <span>AI CLI</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {RESUME_AGENT_OPTIONS.map((opt) => {
                const active =
                  sessionKind === "ai" && !customMode && cmdText === opt.cmd;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setSessionKind("ai");
                      setCustomMode(false);
                      setCmdText(opt.cmd);
                    }}
                    style={chipStyle(active)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer"
                  >
                    {active && <Check className="w-3 h-3" />}
                    {opt.label}
                  </button>
                );
              })}
              {templates.map((t) => {
                const active =
                  sessionKind === "ai" && !customMode && cmdText === t.name;
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => {
                      setSessionKind("ai");
                      setCustomMode(false);
                      setCmdText(t.name);
                    }}
                    style={chipStyle(active)}
                    className="px-3 py-1.5 rounded-full text-xs cursor-pointer"
                  >
                    tpl:{t.name}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setSessionKind("ai");
                  setCustomMode(true);
                }}
                style={chipStyle(sessionKind === "ai" && customMode)}
                className="px-3 py-1.5 rounded-full text-xs cursor-pointer"
              >
                Custom…
              </button>
            </div>
          </div>

          {/* Section 2: Terminal / Shell (#1) */}
          <div
            className="pt-3 space-y-2"
            style={{ borderTop: "1px solid var(--divider)" }}
          >
            <div
              className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-secondary)" }}
            >
              <span className="flex items-center gap-1.5">
                <Terminal
                  className="w-3.5 h-3.5"
                  style={{ color: "var(--ready-fg)" }}
                />
                <span>터미널 (Terminal)</span>
              </span>
              <span
                className="font-mono-code text-[10px] normal-case"
                style={{
                  color: shellLimitReached
                    ? "var(--warn-fg)"
                    : "var(--text-faint)",
                }}
              >
                {liveShellCount}/{MAX_SHELLS_PER_WORKTREE}
                {shellLimitReached ? " 최대 도달" : " 가능"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SHELL_OPTIONS.map((sh) => {
                const active =
                  sessionKind === "shell" && selectedShellId === sh.id;
                return (
                  <button
                    key={sh.id}
                    type="button"
                    disabled={shellLimitReached}
                    title={
                      shellLimitReached
                        ? `한 Worktree당 터미널은 최대 ${MAX_SHELLS_PER_WORKTREE}개까지 열 수 있습니다`
                        : sh.hint
                    }
                    onClick={() => {
                      setSessionKind("shell");
                      setCustomMode(false);
                      setSelectedShellId(sh.id);
                    }}
                    style={chipStyle(active)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {active && <Check className="w-3 h-3" />}
                    {sh.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI-only controls */}
          {sessionKind === "ai" && (
            <>
              {customMode && (
                <input
                  type="text"
                  autoFocus
                  value={cmdText}
                  onChange={(e) => setCmdText(e.target.value)}
                  className="jjdr-input w-full px-3.5 py-2 rounded-full font-mono-code"
                />
              )}

              <div
                className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl"
                style={{
                  background: "var(--input-bg)",
                  border: "1px solid var(--input-border)",
                }}
              >
                <div className="min-w-0">
                  <div
                    className="flex items-center gap-1.5 text-xs font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    <Zap
                      className="w-3.5 h-3.5"
                      style={{ color: "var(--warn-fg)" }}
                    />
                    <span>Autonomous Mode</span>
                  </div>
                  <div
                    className="mt-0.5 text-[10px] font-mono-code truncate"
                    style={{ color: "var(--text-muted)" }}
                  >
                    $ {formatEffectiveCommand(cmdText, autonomous)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAutonomous((v) => !v)}
                  className="px-3 py-1 rounded-full text-[11px] font-semibold shrink-0 cursor-pointer"
                  style={
                    autonomous
                      ? {
                          background: "var(--warn-soft)",
                          border: "1px solid var(--warn-border)",
                          color: "var(--warn-fg)",
                        }
                      : {
                          background: "var(--pill-bg)",
                          border: "1px solid var(--pill-border)",
                          color: "var(--text-muted)",
                        }
                  }
                >
                  {autonomous ? "ON (YOLO)" : "OFF (Ask)"}
                </button>
              </div>

              <textarea
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Optional first prompt..."
                className="jjdr-input w-full px-3.5 py-2.5 rounded-2xl resize-none"
              />
            </>
          )}
        </div>

        <div
          className="px-5 py-3.5 flex justify-end gap-2"
          style={{
            background: "var(--modal-footer)",
            borderTop: "1px solid var(--divider)",
          }}
        >
          <button
            type="button"
            onClick={() => setTarget(null)}
            className="px-4 py-1.5 rounded-full text-xs cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="jjdr-primary-btn px-4 py-1.5 rounded-full text-xs font-semibold cursor-pointer"
          >
            {sessionKind === "shell" ? "터미널 열기" : "AI 실행"}
          </button>
        </div>
      </form>
    </div>
  );
});
