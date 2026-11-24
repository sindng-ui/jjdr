import React from "react";
import { Bot, Plus, Terminal } from "lucide-react";

interface TerminalEmptyStateProps {
  projectName?: string;
  branch?: string;
  cwd?: string;
  defaultAgent?: string;
  launching: boolean;
  onLaunchDefaultAi: () => void;
  onLaunchShell: () => void;
  onOpenSessionPicker: () => void;
}

export const TerminalEmptyState = React.memo(function TerminalEmptyState({
  projectName,
  branch,
  cwd,
  defaultAgent,
  launching,
  onLaunchDefaultAi,
  onLaunchShell,
  onOpenSessionPicker,
}: TerminalEmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-3.5 bg-white/6 border border-white/10 text-slate-300">
        <Terminal className="w-5 h-5" />
      </div>
      <h4 className="text-sm font-semibold text-slate-100">
        실행 중인 세션이 없습니다
      </h4>
      {projectName && (
        <p className="mt-1 text-xs text-slate-400 font-mono-code">
          {projectName}
          {branch ? ` / ${branch}` : ""}
        </p>
      )}
      {cwd && (
        <p className="mt-0.5 text-[11px] text-slate-500 font-mono-code max-w-sm truncate">
          {cwd}
        </p>
      )}

      {cwd && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={launching}
            onClick={onLaunchDefaultAi}
            className="jjdr-primary-btn inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            <Bot className="w-3.5 h-3.5" />
            <span>{defaultAgent || "agy"} 시작</span>
          </button>
          <button
            type="button"
            disabled={launching}
            onClick={onLaunchShell}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium bg-white/10 hover:bg-white/15 text-slate-100 cursor-pointer disabled:opacity-50"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>PowerShell</span>
          </button>
          <button
            type="button"
            disabled={launching}
            onClick={onOpenSessionPicker}
            className="inline-flex items-center gap-1 px-3.5 py-2 rounded-full text-xs font-medium bg-white/6 hover:bg-white/12 text-slate-300 hover:text-white cursor-pointer disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>직접 선택</span>
          </button>
        </div>
      )}
    </div>
  );
});
