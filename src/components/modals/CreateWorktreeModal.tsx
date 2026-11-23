import React, { useEffect, useState } from "react";
import { Check, GitBranch, GitBranchPlus, X, Zap } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  createWorktreeAndLaunch,
  inspectGitRepo,
  listProjectWorktrees,
} from "../../services/tauriBridge";
import { normalizePath } from "../../workers/dashboardLogic";
import {
  AGENT_OPTIONS,
  BRANCH_PREFIXES,
  formatEffectiveCommand,
} from "../../utils/agents";

export const CreateWorktreeModal = React.memo(function CreateWorktreeModal() {
  const projectId = useUiStore((s) => s.createWorktreeProjectId);
  const setProjectId = useUiStore((s) => s.setCreateWorktreeProjectId);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const showToast = useUiStore((s) => s.showToast);

  const project = useAppStore((s) =>
    projectId ? s.projects.find((p) => p.id === projectId) : undefined
  );
  const templates = useAppStore((s) => s.templates);

  const [branchName, setBranchName] = useState("");
  const [currentBranch, setCurrentBranch] = useState<string>("");
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [overrideBase, setOverrideBase] = useState<string>(""); // empty => current branch (HEAD)
  const [showBasePicker, setShowBasePicker] = useState(false);

  const [agentCmd, setAgentCmd] = useState("agy");
  const [autonomous, setAutonomous] = useState(true);
  const [customAgentMode, setCustomAgentMode] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    setBranchName("");
    setOverrideBase("");
    setShowBasePicker(false);
    setAutonomous(true);
    const defAgent = project.default_agent || "agy";
    setAgentCmd(defAgent);
    const isKnown =
      defAgent === "" ||
      AGENT_OPTIONS.some((a) => a.cmd === defAgent) ||
      templates.some((t) => t.name === defAgent);
    setCustomAgentMode(!isKnown);
    setInitialPrompt("");
    setError(null);

    void inspectGitRepo(project.repo_path)
      .then((info) => {
        setCurrentBranch(info.current_branch);
        setLocalBranches(info.branches);
      })
      .catch(() => {
        setCurrentBranch(project.default_branch || "HEAD");
        setLocalBranches([]);
      });
  }, [project, templates]);

  if (!projectId || !project) return null;

  const applyPrefix = (prefix: string) => {
    const stripped = branchName.replace(/^(feat|fix|refactor|chore)\//, "");
    setBranchName(`${prefix}${stripped}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchName.trim()) {
      setError("Branch name is required.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const launchArgv = agentCmd.trim()
        ? agentCmd.trim().split(/\s+/)
        : undefined;
      const res = await createWorktreeAndLaunch({
        project_id: project.id,
        branch_name: branchName.trim(),
        // Undefined => backend automatically bases on repository's current branch (HEAD)
        base_branch: overrideBase || undefined,
        launch_argv: launchArgv,
        initial_prompt: initialPrompt.trim() || undefined,
        autonomous,
      });

      if (launchArgv && launchArgv.length > 0) {
        useAppStore
          .getState()
          .recordLastAgent(normalizePath(res.worktree_path), launchArgv);
      }

      const updatedWts = await listProjectWorktrees(project.id).catch(() => []);
      useAppStore.getState().setProjectWorktrees(project.id, updatedWts);

      showToast(
        res.terminal_address
          ? `Created ${res.branch_name} & launched ${res.terminal_address}`
          : `Created worktree ${res.branch_name}`,
        "success"
      );
      if (res.terminal_address) {
        setSelectedAddress(res.terminal_address);
      }
      setProjectId(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      onClick={() => setProjectId(null)}
      className="fixed inset-0 z-50 bg-[#05070a]/80 flex items-center justify-center p-4"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-[#111318] border border-[#252932] overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-[#1c1f26] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranchPlus className="w-4 h-4 text-[#58a6ff]" />
            <h3 className="text-sm font-bold text-[#e6edf3]">
              New Worktree · {project.name}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setProjectId(null)}
            className="text-[#8b949e] hover:text-[#e6edf3] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs">
          {error && (
            <div className="p-2.5 rounded bg-[#2d1619] border border-[#f85149]/50 text-[#ff7b72]">
              {error}
            </div>
          )}

          {/* Auto-base indicator (Current Branch by default, optional dropdown override) */}
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#0b0c0e] border border-[#1c1f26]">
            <div className="flex items-center gap-1.5 text-[11px] text-[#9aa7b8] min-w-0">
              <GitBranch className="w-3.5 h-3.5 text-[#3fb950] shrink-0" />
              <span>Base:</span>
              <span className="font-mono-code font-semibold text-[#e6edf3] truncate">
                {overrideBase || `${currentBranch || "current branch"} (current)`}
              </span>
            </div>
            {localBranches.length > 1 && (
              <button
                type="button"
                onClick={() => setShowBasePicker((v) => !v)}
                className="text-[11px] text-[#58a6ff] hover:underline shrink-0 cursor-pointer"
              >
                {showBasePicker ? "Hide" : "Change"}
              </button>
            )}
          </div>

          {showBasePicker && (
            <select
              value={overrideBase}
              onChange={(e) => setOverrideBase(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded bg-[#0b0c0e] border border-[#222630] text-[#e6edf3] font-mono-code focus:border-[#58a6ff] focus:outline-none"
            >
              <option value="">
                Current branch ({currentBranch || "HEAD"})
              </option>
              {localBranches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}

          {/* Branch name + quick prefix chips */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[#9aa7b8] font-medium">
                New Branch Name *
              </label>
              <div className="flex items-center gap-1">
                {BRANCH_PREFIXES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => applyPrefix(p)}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono-code bg-[#1a202c] hover:bg-[#253044] text-[#9aa7b8] hover:text-[#e6edf3] cursor-pointer"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="text"
              autoFocus
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="feat/fast-search"
              className="w-full px-2.5 py-2 rounded bg-[#0b0c0e] border border-[#222630] focus:border-[#58a6ff] focus:outline-none text-[#e6edf3] font-mono-code text-sm"
            />
          </div>

          {/* Choice-first AI CLI picker */}
          <div>
            <label className="block text-[#9aa7b8] mb-1.5 font-medium">
              AI CLI to Launch
            </label>
            <div className="flex flex-wrap gap-1.5">
              {AGENT_OPTIONS.map((a) => {
                const active = !customAgentMode && agentCmd === a.cmd;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setCustomAgentMode(false);
                      setAgentCmd(a.cmd);
                    }}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border cursor-pointer ${
                      active
                        ? "bg-[#1f2a3d] border-[#58a6ff] text-[#79c0ff]"
                        : "bg-[#0b0c0e] border-[#1c1f26] text-[#c9d1d9] hover:border-[#3d4a63]"
                    }`}
                  >
                    {active && <Check className="w-3 h-3" />}
                    {a.label}
                  </button>
                );
              })}

              {templates.map((tpl) => {
                const active = !customAgentMode && agentCmd === tpl.name;
                return (
                  <button
                    key={tpl.name}
                    type="button"
                    onClick={() => {
                      setCustomAgentMode(false);
                      setAgentCmd(tpl.name);
                    }}
                    title={tpl.description}
                    className={`px-2.5 py-1.5 rounded text-xs border cursor-pointer ${
                      active
                        ? "bg-[#1f2a3d] border-[#58a6ff] text-[#79c0ff]"
                        : "bg-[#0b0c0e] border-[#1c1f26] text-[#9aa7b8] hover:text-[#e6edf3]"
                    }`}
                  >
                    tpl:{tpl.name}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  setCustomAgentMode(false);
                  setAgentCmd("");
                }}
                className={`px-2.5 py-1.5 rounded text-xs border cursor-pointer ${
                  !customAgentMode && agentCmd === ""
                    ? "bg-[#1f2a3d] border-[#58a6ff] text-[#79c0ff]"
                    : "bg-[#0b0c0e] border-[#1c1f26] text-[#8b949e] hover:text-[#e6edf3]"
                }`}
              >
                No AI (Worktree Only)
              </button>

              <button
                type="button"
                onClick={() => setCustomAgentMode(true)}
                className={`px-2.5 py-1.5 rounded text-xs border cursor-pointer ${
                  customAgentMode
                    ? "bg-[#1f2a3d] border-[#58a6ff] text-[#79c0ff]"
                    : "bg-[#0b0c0e] border-[#1c1f26] text-[#8b949e] hover:text-[#e6edf3]"
                }`}
              >
                Custom…
              </button>
            </div>

            {customAgentMode && (
              <input
                type="text"
                value={agentCmd}
                onChange={(e) => setAgentCmd(e.target.value)}
                placeholder="Custom command (e.g. agy --mode auto)"
                className="mt-2 w-full px-2.5 py-1.5 rounded bg-[#0b0c0e] border border-[#222630] focus:border-[#58a6ff] focus:outline-none text-[#e6edf3] font-mono-code"
              />
            )}
          </div>

          {/* Autonomous (YOLO) mode toggle + effective command preview */}
          {agentCmd.trim() !== "" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded bg-[#0b0c0e] border border-[#1c1f26]">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-[#e6edf3]">
                    <Zap className="w-3.5 h-3.5 text-[#e3b341]" />
                    <span>Autonomous Mode (Auto-Approve)</span>
                  </div>
                  <div className="mt-0.5 text-[10px] font-mono-code text-[#8b949e] truncate">
                    $ {formatEffectiveCommand(agentCmd, autonomous)}
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

              <div>
                <label className="block text-[#9aa7b8] mb-1 font-medium">
                  First Task (optional)
                </label>
                <textarea
                  rows={2}
                  value={initialPrompt}
                  onChange={(e) => setInitialPrompt(e.target.value)}
                  placeholder="Leave blank to open interactive CLI immediately..."
                  className="w-full px-2.5 py-1.5 rounded bg-[#0b0c0e] border border-[#222630] focus:border-[#58a6ff] focus:outline-none text-[#e6edf3] resize-none"
                />
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 bg-[#0e1014] border-t border-[#1c1f26] flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setProjectId(null)}
            className="px-3 py-1.5 rounded text-xs text-[#9aa7b8] hover:text-[#e6edf3] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating || !branchName.trim()}
            className="px-4 py-1.5 rounded text-xs font-semibold bg-[#1f6feb] hover:bg-[#388bfd] disabled:opacity-40 text-white cursor-pointer"
          >
            {creating ? "Creating..." : "Create & Launch"}
          </button>
        </div>
      </form>
    </div>
  );
});
