import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bot,
  FolderPlus,
  GitBranchPlus,
  Sparkles,
  Users,
} from "lucide-react";
import type { ZenDispatchProjectSummary } from "../../utils/zenDispatch";
import type { ZenHiringState } from "../../store/useUiStore";
import { getWorkerPersona } from "../../utils/workerPersona";
import { WorkerMonsterAvatar } from "./WorkerMonsterAvatar";

interface ZenProjectPickerProps {
  projectSummaries: ZenDispatchProjectSummary[];
  onSelectProject: (projectId: string) => void;
  onAddProject: () => void;
}

export const ZenProjectPicker = React.memo(function ZenProjectPicker({
  projectSummaries,
  onSelectProject,
  onAddProject,
}: ZenProjectPickerProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-6">
      <div
        className="zen-anim-rise w-full max-w-2xl rounded-[26px] p-7 space-y-6"
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          boxShadow: "var(--stage-shadow)",
        }}
      >
        <div className="text-center space-y-1.5">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold font-mono-code"
            style={{
              background: "var(--accent-soft)",
              border: "1px solid var(--accent-border)",
              color: "var(--accent)",
            }}
          >
            STEP 1 · PROJECT
          </span>
          <h2
            className="text-xl font-black tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            Which project needs a worker?
          </h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Pick a project below or press 1–9 to jump straight in.
          </p>
        </div>

        {projectSummaries.length === 0 ? (
          <div className="py-6 text-center space-y-3">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              No projects registered yet. Add a Git repository first.
            </p>
            <button
              type="button"
              onClick={onAddProject}
              className="jjdr-primary-btn inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Add Project</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {projectSummaries.map((sum, idx) => (
              <button
                key={sum.project.id}
                type="button"
                onClick={() => onSelectProject(sum.project.id)}
                className="jjdr-card-lift text-left rounded-2xl p-4 space-y-2.5 cursor-pointer transition-colors"
                style={{
                  background: "var(--input-bg)",
                  border: "1px solid var(--card-border)",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: sum.project.color }}
                    />
                    <span
                      className="text-sm font-bold truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {sum.project.name}
                    </span>
                  </div>
                  {idx < 9 && (
                    <kbd
                      className="text-[10px] font-mono-code px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        background: "var(--pill-bg)",
                        border: "1px solid var(--pill-border)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {idx + 1}
                    </kbd>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono-code">
                  <span
                    className="px-2 py-0.5 rounded-full font-semibold"
                    style={{
                      background:
                        sum.idleAiCount > 0
                          ? "var(--ready-soft)"
                          : "var(--pill-bg)",
                      color:
                        sum.idleAiCount > 0
                          ? "var(--ready-fg)"
                          : "var(--text-faint)",
                    }}
                  >
                    AI Standby {sum.idleAiCount}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full"
                    style={{
                      background: "var(--pill-bg)",
                      color:
                        sum.emptyWorktreeCount > 0
                          ? "var(--text-secondary)"
                          : "var(--text-faint)",
                    }}
                  >
                    Empty {sum.emptyWorktreeCount}
                  </span>
                  {sum.runningCount > 0 && (
                    <span
                      className="px-2 py-0.5 rounded-full"
                      style={{
                        background: "var(--run-soft)",
                        color: "var(--run-fg)",
                      }}
                    >
                      Running {sum.runningCount}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

interface ZenActionPickerProps {
  summary: ZenDispatchProjectSummary;
  onChangeProject: () => void;
  onHireNew: () => void;
  onAssignExisting: () => void;
}

export const ZenActionPicker = React.memo(function ZenActionPicker({
  summary,
  onChangeProject,
  onHireNew,
  onAssignExisting,
}: ZenActionPickerProps) {
  const canBrowse = summary.totalAvailableCount > 0;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-6">
      <div
        className="zen-anim-rise w-full max-w-2xl rounded-[26px] p-7 space-y-6"
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          boxShadow: "var(--stage-shadow)",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onChangeProject}
            className="jjdr-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer"
            style={{ color: "var(--text-secondary)" }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Change Project</span>
          </button>
          <div className="flex items-center gap-2 text-xs font-bold">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: summary.project.color }}
            />
            <span style={{ color: "var(--text-primary)" }}>
              {summary.project.name}
            </span>
          </div>
        </div>

        <div className="text-center space-y-1.5">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold font-mono-code"
            style={{
              background: "var(--accent-soft)",
              border: "1px solid var(--accent-border)",
              color: "var(--accent)",
            }}
          >
            STEP 2 · RECRUIT OR ASSIGN
          </span>
          <h2
            className="text-xl font-black tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            Hire a new worker or assign an existing one?
          </h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Spin up a fresh worktree worker or flip through standby workers one by one.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={onHireNew}
            className="jjdr-card-lift text-left rounded-2xl p-5 space-y-3 cursor-pointer flex flex-col justify-between"
            style={{
              background: "var(--input-bg)",
              border: "1.5px solid var(--accent-border)",
            }}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center"
                  style={{
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                  }}
                >
                  <GitBranchPlus className="w-5 h-5" />
                </div>
                <kbd
                  className="text-[11px] font-mono-code px-2 py-0.5 rounded"
                  style={{
                    background: "var(--pill-bg)",
                    border: "1px solid var(--pill-border)",
                    color: "var(--text-muted)",
                  }}
                >
                  1
                </kbd>
              </div>
              <div className="space-y-1">
                <div
                  className="text-base font-black"
                  style={{ color: "var(--text-primary)" }}
                >
                  Hire Worker
                </div>
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: "var(--text-muted)" }}
                >
                  Create a new worktree branch and launch a fresh{" "}
                  <span className="font-mono-code font-semibold">AI</span>{" "}
                  worker session.
                </p>
              </div>
            </div>
            <div
              className="text-[11px] font-semibold"
              style={{ color: "var(--accent)" }}
            >
              + New Session / Worktree →
            </div>
          </button>

          <button
            type="button"
            disabled={!canBrowse}
            onClick={onAssignExisting}
            className="jjdr-card-lift text-left rounded-2xl p-5 space-y-3 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex flex-col justify-between"
            style={{
              background: canBrowse ? "var(--ready-bg)" : "var(--input-bg)",
              border: `1.5px solid ${
                canBrowse ? "var(--ready-border)" : "var(--divider)"
              }`,
            }}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center"
                  style={{
                    background: canBrowse
                      ? "var(--ready-soft)"
                      : "var(--pill-bg)",
                    color: canBrowse ? "var(--ready-fg)" : "var(--text-faint)",
                  }}
                >
                  <Users className="w-5 h-5" />
                </div>
                <kbd
                  className="text-[11px] font-mono-code px-2 py-0.5 rounded"
                  style={{
                    background: "var(--pill-bg)",
                    border: "1px solid var(--pill-border)",
                    color: "var(--text-muted)",
                  }}
                >
                  2 · Enter
                </kbd>
              </div>
              <div className="space-y-1">
                <div
                  className="text-base font-black"
                  style={{ color: "var(--text-primary)" }}
                >
                  Assign Worker
                </div>
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: "var(--text-muted)" }}
                >
                  {canBrowse
                    ? "Inspect standby workers one face at a time, then type directly in the right terminal."
                    : "No standby workers available right now. Hire a new worker on the left."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono-code font-semibold">
              <span style={{ color: "var(--ready-fg)" }}>
                AI Standby {summary.idleAiCount}
              </span>
              <span style={{ color: "var(--text-faint)" }}>·</span>
              <span style={{ color: "var(--text-secondary)" }}>
                Empty {summary.emptyWorktreeCount}
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
});

const HIRING_MESSAGES = [
  "Summoning a fresh monster from the guild...",
  "Carving out git worktree & sharpening claws...",
  "Booting up AI brain & loading workspace...",
  "Handing over badge & reporting for duty!",
];

interface ZenHiringStageProps {
  hiring: ZenHiringState;
  onDismissWaiting: () => void;
}

/** Playful Zero-Blur recruiting stage shown while creating a worktree & spawning AI */
export const ZenHiringStage = React.memo(function ZenHiringStage({
  hiring,
  onDismissWaiting,
}: ZenHiringStageProps) {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    setElapsedSec(0);
    const id = setInterval(() => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - hiring.startedAt) / 1000)));
    }, 500);
    return () => clearInterval(id);
  }, [hiring.startedAt]);

  const previewPersona = useMemo(
    () => getWorkerPersona(`${hiring.projectId}::${hiring.branchName}`),
    [hiring.projectId, hiring.branchName]
  );

  const stageMsg =
    HIRING_MESSAGES[Math.min(HIRING_MESSAGES.length - 1, Math.floor(elapsedSec / 2))];

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-6">
      <div
        className="zen-anim-rise w-full max-w-md rounded-[26px] p-8 text-center space-y-5"
        style={{
          background: "var(--card-bg)",
          border: "1.5px solid var(--accent-border)",
          boxShadow: "var(--stage-shadow)",
        }}
      >
        <div className="flex items-center justify-center">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono-code font-bold"
            style={{
              background: "var(--accent-soft)",
              border: "1px solid var(--accent-border)",
              color: "var(--accent)",
            }}
          >
            <Sparkles className="w-3 h-3" />
            HIRING WORKER · {elapsedSec}s
          </span>
        </div>

        {/* Orbiting Recruitment Portal + Mystery Monster Silhouette (Zero-Blur) */}
        <div className="relative mx-auto w-28 h-28 flex items-center justify-center">
          <svg
            width="112"
            height="112"
            viewBox="0 0 112 112"
            className="absolute inset-0"
            aria-hidden="true"
          >
            <circle
              cx="56"
              cy="56"
              r="50"
              fill="none"
              stroke="var(--accent-border)"
              strokeWidth="2"
              strokeDasharray="6 6"
            />
            <g className="zen-orbit-spin">
              <circle cx="56" cy="6" r="5" fill="var(--accent)" />
              <circle cx="106" cy="56" r="3.5" fill="var(--ready-fg)" />
            </g>
          </svg>
          <WorkerMonsterAvatar
            persona={previewPersona}
            mood="mystery"
            size={74}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-center gap-2 text-xs font-semibold">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: hiring.projectColor }}
            />
            <span style={{ color: "var(--text-secondary)" }}>
              {hiring.projectName}
            </span>
            <span style={{ color: "var(--text-faint)" }}>/</span>
            <span
              className="font-mono-code font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              {hiring.branchName}
            </span>
          </div>
          <h3
            className="text-lg font-black tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            Recruiting New AI Worker...
          </h3>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {stageMsg}
          </p>
        </div>

        <div className="pt-1">
          <button
            type="button"
            onClick={onDismissWaiting}
            className="jjdr-pill px-4 py-1.5 rounded-full text-[11px] font-medium cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            Continue in Background
          </button>
        </div>
      </div>
    </div>
  );
});

interface ZenNoWorkersNoticeProps {
  projectName: string;
  onHireNew: () => void;
  onChangeProject: () => void;
}

export const ZenNoWorkersNotice = React.memo(function ZenNoWorkersNotice({
  projectName,
  onHireNew,
  onChangeProject,
}: ZenNoWorkersNoticeProps) {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-6">
      <div
        className="zen-anim-rise w-full max-w-md rounded-[24px] p-7 text-center space-y-4"
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          boxShadow: "var(--stage-shadow)",
        }}
      >
        <div
          className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center"
          style={{
            background: "var(--accent-soft)",
            color: "var(--accent)",
          }}
        >
          <Bot className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3
            className="text-base font-black"
            style={{ color: "var(--text-primary)" }}
          >
            No standby workers
          </h3>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            All workers in {projectName} are currently busy or awaiting review.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={onHireNew}
            className="jjdr-primary-btn inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold cursor-pointer"
          >
            <GitBranchPlus className="w-3.5 h-3.5" />
            <span>Hire Worker</span>
          </button>
          <button
            type="button"
            onClick={onChangeProject}
            className="jjdr-pill px-4 py-2 rounded-full text-xs font-semibold cursor-pointer"
            style={{ color: "var(--text-secondary)" }}
          >
            Other Project
          </button>
        </div>
      </div>
    </div>
  );
});
