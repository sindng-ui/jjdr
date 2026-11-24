import React, { useEffect, useMemo, useState } from "react";
import { FolderOpen, GitBranch, X } from "lucide-react";
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
import { ProjectAdvancedSection } from "./ProjectAdvancedSection";
import { ProjectDefaultsSection } from "./ProjectDefaultsSection";

export const ProjectModal = React.memo(function ProjectModal() {
  const target = useUiStore((s) => s.projectModalProject);
  const setTarget = useUiStore((s) => s.setProjectModalProject);
  const showToast = useUiStore((s) => s.showToast);

  const existingProjects = useAppStore((s) => s.projects);
  const templates = useAppStore((s) => s.templates);

  const editing = target && target !== "new" ? target : null;

  const [repoPath, setRepoPath] = useState("");
  const [name, setName] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
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

  const branchChoices = useMemo(() => {
    const set = new Set<string>();
    if (inspectInfo?.current_branch && inspectInfo.current_branch !== "HEAD") {
      set.add(inspectInfo.current_branch);
    }
    if (inspectInfo?.default_branch) {
      set.add(inspectInfo.default_branch);
    }
    for (const b of inspectInfo?.branches ?? []) {
      if (b) set.add(b);
    }
    if (defaultBranch) set.add(defaultBranch);
    return Array.from(set);
  }, [inspectInfo, defaultBranch]);

  const runInspect = async (path: string, autoFillFields: boolean) => {
    setInspecting(true);
    setError(null);
    try {
      const info = await inspectGitRepo(path);
      setInspectInfo(info);
      setRepoPath(info.canonical_path);
      if (autoFillFields) {
        setName((prev) => (prev.trim() ? prev : info.suggested_name));
        setDefaultBranch(
          info.current_branch && info.current_branch !== "HEAD"
            ? info.current_branch
            : info.default_branch || info.branches[0] || ""
        );
        setSelectedEnvFiles(info.detected_env_files);
        if (info.suggested_verify_commands.length > 0) {
          setVerifyCommand(info.suggested_verify_commands[0]);
        }
      } else {
        setDefaultBranch(
          (prev) =>
            prev || info.default_branch || info.current_branch || info.branches[0] || ""
        );
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
      setDefaultBranch(editing.default_branch || "");
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
      setDefaultBranch("");
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
        setDefaultBranch("");
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
        default_branch:
          defaultBranch.trim() ||
          inspectInfo?.default_branch ||
          editing?.default_branch ||
          undefined,
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
      showToast(
        editing ? `Updated ${finalName}` : `Added ${finalName}`,
        "success"
      );
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
          <h3
            className="text-sm font-bold"
            style={{ color: "var(--text-primary)" }}
          >
            {editing ? `Edit Project — ${editing.name}` : "Add Git Project"}
          </h3>
          <button
            type="button"
            onClick={() => setTarget(null)}
            className="p-1.5 rounded-full hover:bg-black/10 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
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

          {/* Step 1: Select Folder */}
          <div>
            <label
              className="block mb-1.5 font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              1. Git Repository Folder *
            </label>
            <button
              type="button"
              onClick={() => void handleBrowse()}
              className="jjdr-input w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl text-left cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <FolderOpen
                  className="w-4 h-4 shrink-0"
                  style={{ color: "var(--accent)" }}
                />
                <span
                  className="font-mono-code truncate"
                  style={{
                    color: repoPath
                      ? "var(--text-primary)"
                      : "var(--text-muted)",
                  }}
                >
                  {repoPath || "Click to pick a local Git repository folder..."}
                </span>
              </div>
              <span
                className="px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0"
                style={{
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                }}
              >
                {inspecting ? "Scanning..." : "Browse"}
              </span>
            </button>
          </div>

          {/* Step 2: Default Git Branch Dropdown (#2) */}
          <div>
            <label
              className="flex items-center gap-1.5 mb-1.5 font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              <GitBranch
                className="w-3.5 h-3.5"
                style={{ color: "var(--ready-fg)" }}
              />
              <span>2. Git Branch</span>
            </label>
            <select
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              disabled={branchChoices.length === 0}
              className="jjdr-input w-full px-3.5 py-2 rounded-full font-mono-code disabled:opacity-50"
            >
              {branchChoices.length === 0 ? (
                <option value="">
                  {inspecting
                    ? "브랜치 목록 불러오는 중..."
                    : "Git 폴더를 먼저 선택하세요"}
                </option>
              ) : (
                branchChoices.map((b) => (
                  <option key={b} value={b}>
                    {b}
                    {inspectInfo?.current_branch === b ? " (current HEAD)" : ""}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Step 3: Name + Color */}
          <div className="grid grid-cols-3 gap-3 items-end">
            <div className="col-span-2">
              <label
                className="block mb-1.5 font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                3. Project Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Auto-filled from folder"
                className="jjdr-input w-full px-3.5 py-2 rounded-full"
              />
            </div>

            <div>
              <label
                className="block mb-1.5 font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                Color
              </label>
              <div className="flex items-center gap-1.5 flex-wrap py-1">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="w-5 h-5 rounded-full cursor-pointer transition-transform"
                    style={{
                      backgroundColor: c,
                      boxShadow:
                        color === c ? "0 0 0 2px var(--text-primary)" : "none",
                      transform: color === c ? "scale(1.1)" : "none",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <ProjectDefaultsSection
            defaultAgent={defaultAgent}
            customAgentMode={customAgentMode}
            templates={templates}
            onSelectAgent={(cmd) => {
              setCustomAgentMode(false);
              setDefaultAgent(cmd);
            }}
            onEnableCustomAgent={() => setCustomAgentMode(true)}
            onChangeCustomAgent={setDefaultAgent}
            group={group}
            groupChoices={groupChoices}
            addingGroup={addingGroup}
            newGroupDraft={newGroupDraft}
            onSelectGroup={setGroup}
            onStartAddGroup={() => setAddingGroup(true)}
            onChangeNewGroupDraft={setNewGroupDraft}
            onConfirmNewGroup={handleConfirmNewGroup}
          />

          <ProjectAdvancedSection
            open={showAdvanced}
            onToggle={() => setShowAdvanced((v) => !v)}
            envOptions={envOptions}
            selectedEnvFiles={selectedEnvFiles}
            onToggleEnvFile={toggleEnvFile}
            setupCommand={setupCommand}
            setupChoices={setupChoices}
            onChangeSetupCommand={setSetupCommand}
            verifyCommand={verifyCommand}
            verifyChoices={verifyChoices}
            onChangeVerifyCommand={setVerifyCommand}
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
            disabled={saving || !repoPath.trim()}
            className="jjdr-primary-btn px-4 py-1.5 rounded-full text-xs font-semibold disabled:opacity-40 cursor-pointer"
          >
            {saving ? "Saving..." : editing ? "Save Changes" : "Add Project"}
          </button>
        </div>
      </form>
    </div>
  );
});
