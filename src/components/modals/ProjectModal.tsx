import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, FolderOpen, Plus, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  inspectGitRepo,
  listAllWorktrees,
  upsertProject,
} from "../../services/tauriBridge";
import type { RepoInspectInfo } from "../../types/domain";
import { PROJECT_COLORS } from "../../utils/format";
import { AGENT_OPTIONS, DEFAULT_PROJECT_GROUPS } from "../../utils/agents";

export const ProjectModal = React.memo(function ProjectModal() {
  const target = useUiStore((s) => s.projectModalProject);
  const setTarget = useUiStore((s) => s.setProjectModalProject);
  const showToast = useUiStore((s) => s.showToast);

  const existingProjects = useAppStore((s) => s.projects);
  const templates = useAppStore((s) => s.templates);

  const editing = target && target !== "new" ? target : null;

  const [repoPath, setRepoPath] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [defaultAgent, setDefaultAgent] = useState("agy");
  const [customAgentMode, setCustomAgentMode] = useState(false);
  const [group, setGroup] = useState("Default");
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupDraft, setNewGroupDraft] = useState("");

  const [inspectInfo, setInspectInfo] = useState<RepoInspectInfo | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [selectedEnvFiles, setSelectedEnvFiles] = useState<string[]>([]);
  const [setupCommand, setSetupCommand] = useState("");
  const [verifyCommand, setVerifyCommand] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupChoices = useMemo(() => {
    const set = new Set<string>(DEFAULT_PROJECT_GROUPS);
    for (const p of existingProjects) {
      if (p.group) set.add(p.group);
    }
    if (group) set.add(group);
    return Array.from(set);
  }, [existingProjects, group]);

  const runInspect = async (path: string, autoFillFields: boolean) => {
    setInspecting(true);
    setError(null);
    try {
      const info = await inspectGitRepo(path);
      setInspectInfo(info);
      setRepoPath(info.canonical_path);
      if (autoFillFields) {
        setName((prev) => (prev.trim() ? prev : info.suggested_name));
        setSelectedEnvFiles(info.detected_env_files);
        if (info.suggested_verify_commands.length > 0) {
          setVerifyCommand(info.suggested_verify_commands[0]);
        }
      }
    } catch (err) {
      setInspectInfo(null);
      setError(String(err));
    } finally {
      setInspecting(false);
    }
  };

  useEffect(() => {
    if (!target) return;
    setError(null);
    setShowAdvanced(false);
    setAddingGroup(false);
    setNewGroupDraft("");
    setInspectInfo(null);

    if (editing) {
      setRepoPath(editing.repo_path);
      setName(editing.name);
      setColor(editing.color);
      const agent = editing.default_agent || "agy";
      setDefaultAgent(agent);
      const isKnown =
        AGENT_OPTIONS.some((a) => a.cmd === agent) ||
        templates.some((t) => t.name === agent);
      setCustomAgentMode(!isKnown);
      setGroup(editing.group || "Default");
      setSelectedEnvFiles(editing.bootstrap?.copy_files ?? []);
      setSetupCommand(editing.bootstrap?.setup_command ?? "");
      setVerifyCommand(editing.verify_command ?? "");
      void runInspect(editing.repo_path, false);
    } else {
      setRepoPath("");
      setName("");
      setColor(PROJECT_COLORS[existingProjects.length % PROJECT_COLORS.length]);
      setDefaultAgent("agy");
      setCustomAgentMode(false);
      setGroup("Default");
      setSelectedEnvFiles([]);
      setSetupCommand("");
      setVerifyCommand("");
    }
  }, [target, editing, templates, existingProjects.length]);

  if (!target) return null;

  const handleBrowse = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string" && selected) {
        setName("");
        await runInspect(selected, true);
      }
    } catch (e) {
      setError(`Folder picker error: ${String(e)}`);
    }
  };

  const toggleEnvFile = (file: string) => {
    setSelectedEnvFiles((prev) =>
      prev.includes(file) ? prev.filter((f) => f !== file) : [...prev, file]
    );
  };

  const handleConfirmNewGroup = () => {
    const trimmed = newGroupDraft.trim();
    if (trimmed) {
      setGroup(trimmed);
    }
    setAddingGroup(false);
    setNewGroupDraft("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoPath.trim()) {
      setError("Please select a Git repository folder first.");
      return;
    }
    const finalName =
      name.trim() ||
      inspectInfo?.suggested_name ||
      repoPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
      "project";

    setSaving(true);
    setError(null);
    try {
      const updated = await upsertProject({
        id: editing?.id,
        name: finalName,
        repo_path: repoPath.trim(),
        color,
        default_branch: inspectInfo?.default_branch || editing?.default_branch || undefined,
        default_agent: defaultAgent.trim() || "agy",
        verify_command: verifyCommand.trim() || undefined,
        group: group.trim() || "Default",
        bootstrap: {
          copy_files: selectedEnvFiles,
          setup_command: setupCommand.trim() || null,
        },
      });
      useAppStore.getState().setProjects(updated);
      const wts = await listAllWorktrees().catch(() => ({}));
      useAppStore.getState().setWorktreesByProject(wts);
      showToast(editing ? `Updated ${finalName}` : `Added ${finalName}`, "success");
      setTarget(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const envOptions = Array.from(
    new Set([...(inspectInfo?.detected_env_files ?? []), ...selectedEnvFiles])
  );
  const setupChoices = Array.from(
    new Set([
      ...(inspectInfo?.suggested_setup_commands ?? []),
      ...(setupCommand ? [setupCommand] : []),
    ])
  );
  const verifyChoices = Array.from(
    new Set([
      ...(inspectInfo?.suggested_verify_commands ?? []),
      ...(verifyCommand ? [verifyCommand] : []),
    ])
  );

  return (
    <div
      onClick={() => setTarget(null)}
      className="fixed inset-0 z-50 bg-[#05070a]/80 flex items-center justify-center p-4"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-[#111318] border border-[#252932] overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-[#1c1f26] flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#e6edf3]">
            {editing ? `Edit Project — ${editing.name}` : "Add Git Project"}
          </h3>
          <button
            type="button"
            onClick={() => setTarget(null)}
            className="text-[#8b949e] hover:text-[#e6edf3] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="p-2.5 rounded bg-[#2d1619] border border-[#f85149]/50 text-[#ff7b72]">
              {error}
            </div>
          )}

          {/* Step 1: Select Folder (auto-fills everything else) */}
          <div>
            <label className="block text-[#9aa7b8] mb-1.5 font-medium">
              1. Git Repository Folder *
            </label>
            <button
              type="button"
              onClick={() => void handleBrowse()}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded bg-[#0b0c0e] hover:bg-[#161c28] border border-[#252932] hover:border-[#58a6ff] text-left cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FolderOpen className="w-4 h-4 text-[#58a6ff] shrink-0" />
                <span
                  className={`font-mono-code truncate ${
                    repoPath ? "text-[#e6edf3]" : "text-[#6c788a]"
                  }`}
                >
                  {repoPath || "Click to pick a local Git repository folder..."}
                </span>
              </div>
              <span className="px-2 py-0.5 rounded bg-[#1f2a3d] text-[#79c0ff] text-[11px] font-medium shrink-0">
                {inspecting ? "Scanning..." : "Browse"}
              </span>
            </button>
            {inspectInfo && (
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[#8b949e]">
                <span className="text-[#56d364]">✓ Git repo detected</span>
                <span>·</span>
                <span>
                  HEAD: <code className="text-[#c9d1d9]">{inspectInfo.current_branch}</code>
                </span>
                {inspectInfo.detected_env_files.length > 0 && (
                  <>
                    <span>·</span>
                    <span>
                      Auto-copy: {inspectInfo.detected_env_files.join(", ")}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Step 2: Project Name (auto-filled) + Color */}
          <div className="grid grid-cols-3 gap-3 items-end">
            <div className="col-span-2">
              <label className="block text-[#9aa7b8] mb-1 font-medium">
                2. Project Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Auto-filled from folder"
                className="w-full px-2.5 py-1.5 rounded bg-[#0b0c0e] border border-[#222630] focus:border-[#58a6ff] focus:outline-none text-[#e6edf3]"
              />
            </div>

            <div>
              <label className="block text-[#9aa7b8] mb-1 font-medium">
                Color
              </label>
              <div className="flex items-center gap-1 flex-wrap py-1">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-5 h-5 rounded cursor-pointer border-2 ${
                      color === c ? "border-white" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Step 3: Default AI CLI (Multiple-choice chips) */}
          <div>
            <label className="block text-[#9aa7b8] mb-1.5 font-medium">
              3. Default AI CLI
            </label>
            <div className="flex flex-wrap gap-1.5">
              {AGENT_OPTIONS.map((a) => {
                const active = !customAgentMode && defaultAgent === a.cmd;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setCustomAgentMode(false);
                      setDefaultAgent(a.cmd);
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
                const active = !customAgentMode && defaultAgent === tpl.name;
                return (
                  <button
                    key={tpl.name}
                    type="button"
                    onClick={() => {
                      setCustomAgentMode(false);
                      setDefaultAgent(tpl.name);
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
                value={defaultAgent}
                onChange={(e) => setDefaultAgent(e.target.value)}
                placeholder="Custom CLI command"
                className="mt-2 w-full px-2.5 py-1.5 rounded bg-[#0b0c0e] border border-[#222630] focus:border-[#58a6ff] focus:outline-none text-[#e6edf3] font-mono-code"
              />
            )}
          </div>

          {/* Step 4: Group (Multiple-choice chips) */}
          <div>
            <label className="block text-[#9aa7b8] mb-1.5 font-medium">
              4. Group
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {groupChoices.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroup(g)}
                  className={`px-2.5 py-1 rounded text-xs border cursor-pointer ${
                    group === g
                      ? "bg-[#1f2a3d] border-[#58a6ff] text-[#79c0ff] font-medium"
                      : "bg-[#0b0c0e] border-[#1c1f26] text-[#9aa7b8] hover:text-[#e6edf3]"
                  }`}
                >
                  {g}
                </button>
              ))}
              {addingGroup ? (
                <div className="inline-flex items-center gap-1">
                  <input
                    type="text"
                    autoFocus
                    value={newGroupDraft}
                    onChange={(e) => setNewGroupDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleConfirmNewGroup();
                      }
                    }}
                    placeholder="Group name"
                    className="w-24 px-2 py-1 rounded bg-[#0b0c0e] border border-[#58a6ff] text-xs text-[#e6edf3] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleConfirmNewGroup}
                    className="px-2 py-1 rounded bg-[#238636] text-white text-[11px] cursor-pointer"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingGroup(true)}
                  className="inline-flex items-center gap-0.5 px-2 py-1 rounded text-xs border border-dashed border-[#252932] text-[#8b949e] hover:text-[#e6edf3] cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  New
                </button>
              )}
            </div>
          </div>

          {/* Optional Advanced Settings (Collapsed by default, choice-first) */}
          <div className="pt-2 border-t border-[#1c1f26]">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-[#8b949e] hover:text-[#e6edf3] cursor-pointer"
            >
              {showAdvanced ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              Advanced Options (Auto-detected bootstrap & verify)
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 pl-1">
                {envOptions.length > 0 && (
                  <div>
                    <div className="text-[#9aa7b8] mb-1">
                      Copy files into new worktree
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {envOptions.map((f) => {
                        const checked = selectedEnvFiles.includes(f);
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => toggleEnvFile(f)}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded font-mono-code text-[11px] border cursor-pointer ${
                              checked
                                ? "bg-[#12281c] border-[#3fb950] text-[#56d364]"
                                : "bg-[#0b0c0e] border-[#1c1f26] text-[#8b949e]"
                            }`}
                          >
                            {checked && <Check className="w-3 h-3" />}
                            {f}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[#9aa7b8] mb-1">
                    Post-create Setup Command
                  </label>
                  <select
                    value={setupCommand}
                    onChange={(e) => setSetupCommand(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0b0c0e] border border-[#222630] text-[#e6edf3] font-mono-code focus:border-[#58a6ff] focus:outline-none"
                  >
                    <option value="">None (fastest)</option>
                    {setupChoices.map((cmd) => (
                      <option key={cmd} value={cmd}>
                        {cmd}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[#9aa7b8] mb-1">
                    One-Click Verify Command
                  </label>
                  <select
                    value={verifyCommand}
                    onChange={(e) => setVerifyCommand(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0b0c0e] border border-[#222630] text-[#e6edf3] font-mono-code focus:border-[#58a6ff] focus:outline-none"
                  >
                    <option value="">None</option>
                    {verifyChoices.map((cmd) => (
                      <option key={cmd} value={cmd}>
                        {cmd}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 bg-[#0e1014] border-t border-[#1c1f26] flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setTarget(null)}
            className="px-3 py-1.5 rounded text-xs text-[#9aa7b8] hover:text-[#e6edf3] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !repoPath.trim()}
            className="px-4 py-1.5 rounded text-xs font-semibold bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 text-white cursor-pointer"
          >
            {saving ? "Saving..." : editing ? "Save Changes" : "Add Project"}
          </button>
        </div>
      </form>
    </div>
  );
});
