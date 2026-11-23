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
  const [overrideBase, setOverrideBase] = useState<string>("");
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

  const chipStyle = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--accent-soft)" : "var(--input-bg)",
    border: `1px solid ${active ? "var(--accent)" : "var(--input-border)"}`,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
  });

  return (
    <div
      onClick={() => setProjectId(null)}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-lg rounded-[22px] overflow-hidden"
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-center gap-2">
            <GitBranchPlus
              className="w-4 h-4"
              style={{ color: "var(--accent)" }}
            />
            <h3
              className="text-sm font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              New Worktree · {project.name}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setProjectId(null)}
            className="p-1.5 rounded-full hover:bg-black/10 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {error && (
            <div
              className="p-3 rounded-2xl"
              style={{
                background: "var(--action-soft)",
                border: "1px solid var(--action-border)",
                color: "var(--action-fg)",
              }}
            >
              {error}
            </div>
          )}

          {/* Auto-base indicator */}
          <div
            className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-full"
            style={{
              background: "var(--input-bg)",
              border: "1px solid var(--input-border)",
            }}
          >
            <div
              className="flex items-center gap-1.5 text-[11px] min-w-0"
              style={{ color: "var(--text-secondary)" }}
            >
              <GitBranch
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: "var(--ready-fg)" }}
              />
              <span>Base:</span>
              <span
                className="font-mono-code font-bold truncate"
                style={{ color: "var(--text-primary)" }}
              >
                {overrideBase ||
                  `${currentBranch || "current branch"} (current)`}
              </span>
            </div>
            {localBranches.length > 1 && (
              <button
                type="button"
                onClick={() => setShowBasePicker((v) => !v)}
                className="text-[11px] font-semibold hover:underline shrink-0 cursor-pointer"
                style={{ color: "var(--accent)" }}
              >
                {showBasePicker ? "Hide" : "Change"}
              </button>
            )}
          </div>

          {showBasePicker && (
            <select
              value={overrideBase}
              onChange={(e) => setOverrideBase(e.target.value)}
              className="jjdr-input w-full px-3.5 py-2 rounded-full font-mono-code"
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

          {/* Branch name + quick prefix pills */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                className="font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                New Branch Name *
              </label>
              <div className="flex items-center gap-1">
                {BRANCH_PREFIXES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => applyPrefix(p)}
                    className="jjdr-pill px-2 py-0.5 rounded-full text-[10px] font-mono-code cursor-pointer"
                    style={{ color: "var(--text-muted)" }}
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
              className="jjdr-input w-full px-3.5 py-2.5 rounded-full font-mono-code text-sm"
            />
          </div>

          {/* Choice-first AI CLI picker */}
          <div>
            <label
              className="block mb-1.5 font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
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
                    style={chipStyle(active)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer"
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
                    style={chipStyle(active)}
                    className="px-3 py-1.5 rounded-full text-xs cursor-pointer"
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
                style={chipStyle(!customAgentMode && agentCmd === "")}
                className="px-3 py-1.5 rounded-full text-xs cursor-pointer"
              >
                No AI (Worktree Only)
              </button>

              <button
                type="button"
                onClick={() => setCustomAgentMode(true)}
                style={chipStyle(customAgentMode)}
                className="px-3 py-1.5 rounded-full text-xs cursor-pointer"
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
                className="jjdr-input mt-2 w-full px-3.5 py-2 rounded-full font-mono-code"
              />
            )}
          </div>

          {/* Autonomous (YOLO) mode toggle */}
          {agentCmd.trim() !== "" && (
            <div className="space-y-3">
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
                    <span>Autonomous Mode (Auto-Approve)</span>
                  </div>
                  <div
                    className="mt-0.5 text-[10px] font-mono-code truncate"
                    style={{ color: "var(--text-muted)" }}
                  >
                    $ {formatEffectiveCommand(agentCmd, autonomous)}
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

              <div>
                <label
                  className="block mb-1.5 font-semibold"
                  style={{ color: "var(--text-secondary)" }}
                >
                  First Task (optional)
                </label>
                <textarea
                  rows={2}
                  value={initialPrompt}
                  onChange={(e) => setInitialPrompt(e.target.value)}
                  placeholder="Leave blank to open interactive CLI immediately..."
                  className="jjdr-input w-full px-3.5 py-2.5 rounded-2xl resize-none"
                />
              </div>
            </div>
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
            onClick={() => setProjectId(null)}
            className="px-4 py-1.5 rounded-full text-xs cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating || !branchName.trim()}
            className="jjdr-primary-btn px-4 py-1.5 rounded-full text-xs font-semibold disabled:opacity-40 cursor-pointer"
          >
            {creating ? "Creating..." : "Create & Launch"}
          </button>
        </div>
      </form>
    </div>
  );
});
