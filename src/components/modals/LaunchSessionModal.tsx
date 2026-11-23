import React, { useEffect, useState } from "react";
import { Check, Play, X, Zap } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { launchSession } from "../../services/tauriBridge";
import { normalizePath } from "../../workers/dashboardLogic";
import { formatEffectiveCommand, RESUME_AGENT_OPTIONS } from "../../utils/agents";

export const LaunchSessionModal = React.memo(function LaunchSessionModal() {
  const target = useUiStore((s) => s.launchTarget);
  const setTarget = useUiStore((s) => s.setLaunchTarget);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
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
      if (addr) setSelectedAddress(addr);
      setTarget(null);
    } catch (err) {
      showToast(`Launch failed: ${String(err)}`, "error");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div
      onClick={() => setTarget(null)}
      className="fixed inset-0 z-50 bg-[#05070a]/80 flex items-center justify-center p-4"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-[#111318] border border-[#252932] overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-[#1c1f26] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4 text-[#56d364]" />
            <h3 className="text-sm font-bold text-[#e6edf3]">
              Launch AI CLI · {target.branch || "Worktree"}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setTarget(null)}
            className="text-[#8b949e] hover:text-[#e6edf3] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs">
          <div className="text-[11px] font-mono-code text-[#8b949e] truncate">
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
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border cursor-pointer ${
                    active
                      ? "bg-[#1f2a3d] border-[#58a6ff] text-[#79c0ff] font-medium"
                      : "bg-[#0b0c0e] border-[#1c1f26] text-[#c9d1d9] hover:border-[#3d4a63]"
                  }`}
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
                  className={`px-2.5 py-1.5 rounded text-xs border cursor-pointer ${
                    active
                      ? "bg-[#1f2a3d] border-[#58a6ff] text-[#79c0ff]"
                      : "bg-[#0b0c0e] border-[#1c1f26] text-[#9aa7b8]"
                  }`}
                >
                  tpl:{t.name}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCustomMode(true)}
              className={`px-2.5 py-1.5 rounded text-xs border cursor-pointer ${
                customMode
                  ? "bg-[#1f2a3d] border-[#58a6ff] text-[#79c0ff]"
                  : "bg-[#0b0c0e] border-[#1c1f26] text-[#8b949e]"
              }`}
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
              className="w-full px-2.5 py-1.5 rounded bg-[#0b0c0e] border border-[#222630] focus:border-[#58a6ff] focus:outline-none text-[#e6edf3] font-mono-code"
            />
          )}

          <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded bg-[#0b0c0e] border border-[#1c1f26]">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium text-[#e6edf3]">
                <Zap className="w-3.5 h-3.5 text-[#e3b341]" />
                <span>Autonomous Mode</span>
              </div>
              <div className="mt-0.5 text-[10px] font-mono-code text-[#8b949e] truncate">
                $ {formatEffectiveCommand(cmdText, autonomous)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAutonomous((v) => !v)}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold border shrink-0 cursor-pointer ${
                autonomous
                  ? "bg-[#33260f] border-[#d29922] text-[#e3b341]"
                  : "bg-[#1a202c] border-[#252932] text-[#8b949e]"
              }`}
            >
              {autonomous ? "ON (YOLO)" : "OFF (Ask)"}
            </button>
          </div>

          <textarea
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Optional first prompt..."
            className="w-full px-2.5 py-1.5 rounded bg-[#0b0c0e] border border-[#222630] focus:border-[#58a6ff] focus:outline-none text-[#e6edf3] resize-none"
          />
        </div>

        <div className="px-4 py-3 bg-[#0e1014] border-t border-[#1c1f26] flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setTarget(null)}
            className="px-3 py-1.5 rounded text-xs text-[#9aa7b8] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={launching}
            className="px-4 py-1.5 rounded text-xs font-semibold bg-[#238636] hover:bg-[#2ea043] text-white cursor-pointer"
          >
            {launching ? "Starting..." : "Launch"}
          </button>
        </div>
      </form>
    </div>
  );
});
