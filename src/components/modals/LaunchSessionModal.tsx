import React, { useEffect, useState } from "react";
import { Check, Play, X, Zap } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { launchSession } from "../../services/tauriBridge";
import { normalizePath } from "../../workers/dashboardLogic";
import {
  formatEffectiveCommand,
  RESUME_AGENT_OPTIONS,
} from "../../utils/agents";

export const LaunchSessionModal = React.memo(function LaunchSessionModal() {
  const target = useUiStore((s) => s.launchTarget);
  const setTarget = useUiStore((s) => s.setLaunchTarget);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const rememberCardSession = useUiStore((s) => s.rememberCardSession);
  const showToast = useUiStore((s) => s.showToast);
  const lastAgentMap = useAppStore((s) => s.lastAgentByWorktree);
  const templates = useAppStore((s) => s.templates);

  const [cmdText, setCmdText] = useState("agy");
  const [autonomous, setAutonomous] = useState(true);
  const [customMode, setCustomMode] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    if (!target) return;
    const saved = lastAgentMap[normalizePath(target.cwd)];
    const initial = saved?.join(" ") || target.defaultAgent || "agy";
    setCmdText(initial);
    const isKnown =
      RESUME_AGENT_OPTIONS.some((o) => o.cmd === initial) ||
      templates.some((t) => t.name === initial);
    setCustomMode(!isKnown);
    setAutonomous(true);
    setPrompt("");
  }, [target, lastAgentMap, templates]);

  if (!target) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const argv = cmdText.trim().split(/\s+/).filter(Boolean);
    if (argv.length === 0) return;
    setLaunching(true);
    try {
      const addr = await launchSession({
        project_id: target.projectId,
        cwd: target.cwd,
        branch: target.branch,
        argv,
        initial_prompt: prompt.trim() || undefined,
        autonomous,
      });
      useAppStore.getState().recordLastAgent(normalizePath(target.cwd), argv);
      showToast(`Launched ${argv[0]} (${addr})`, "success");
      if (addr) {
        setSelectedAddress(addr);
        setAttachedAddress(addr);
        if (target.projectId) {
          rememberCardSession(
            `wt::${target.projectId}::${normalizePath(target.cwd)}`,
            addr
          );
        }
      }
      setTarget(null);
    } catch (err) {
      showToast(`Launch failed: ${String(err)}`, "error");
    } finally {
      setLaunching(false);
    }
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
        onSubmit={(e) => void handleSubmit(e)}
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-md rounded-[22px] overflow-hidden"
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4" style={{ color: "var(--ready-fg)" }} />
            <h3
              className="text-sm font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              Launch AI CLI · {target.branch || "Worktree"}
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

        <div className="p-5 space-y-3.5 text-xs">
          <div
            className="text-[11px] font-mono-code truncate"
            style={{ color: "var(--text-muted)" }}
          >
            {target.cwd}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {RESUME_AGENT_OPTIONS.map((opt) => {
              const active = !customMode && cmdText === opt.cmd;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
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
              const active = !customMode && cmdText === t.name;
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => {
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
              onClick={() => setCustomMode(true)}
              style={chipStyle(customMode)}
              className="px-3 py-1.5 rounded-full text-xs cursor-pointer"
            >
              Custom…
            </button>
          </div>

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
            disabled={launching}
            className="jjdr-primary-btn px-4 py-1.5 rounded-full text-xs font-semibold cursor-pointer"
          >
            {launching ? "Starting..." : "Launch"}
          </button>
        </div>
      </form>
    </div>
  );
});
