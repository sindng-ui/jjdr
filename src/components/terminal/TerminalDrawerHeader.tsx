import React from "react";
import {
  ExternalLink,
  FileDiff,
  OctagonX,
  Settings2,
  X,
} from "lucide-react";
import type { EnrichedSession, PromptPreset } from "../../types/domain";
import { StatusBadge } from "../shared/StatusBadge";

interface TerminalDrawerHeaderProps {
  session: EnrichedSession | null;
  attachedAddress: string | null;
  fallbackTitle?: string;
  fallbackBranch?: string;
  statusText: string;
  presets: PromptPreset[];
  onOpenDiff?: () => void;
  onInterrupt?: () => void;
  onPopout?: () => void;
  onClose: () => void;
  onSendPreset: (prompt: string) => void;
  onOpenSettings: () => void;
}

export const TerminalDrawerHeader = React.memo(function TerminalDrawerHeader({
  session,
  attachedAddress,
  fallbackTitle,
  fallbackBranch,
  statusText,
  presets,
  onOpenDiff,
  onInterrupt,
  onPopout,
  onClose,
  onSendPreset,
  onOpenSettings,
}: TerminalDrawerHeaderProps) {
  return (
    <>
      <div
        className="h-11 px-4 flex items-center justify-between gap-2 shrink-0 select-none"
        style={{
          background: "var(--term-header-bg)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {session && (
            <StatusBadge
              bucket={session.bucket}
              status={session.terminal.status}
              compact
            />
          )}
          <span className="text-xs font-medium text-slate-300 truncate">
            {session ? session.projectName : fallbackTitle || "Terminal"}
          </span>
          {(session?.branch || fallbackBranch) && (
            <>
              <span className="text-slate-500">/</span>
              <span className="text-xs font-mono-code font-bold text-white truncate">
                {session?.branch || fallbackBranch}
              </span>
            </>
          )}
          {attachedAddress && (
            <span className="text-[11px] font-mono-code text-slate-400 shrink-0">
              {attachedAddress} · {statusText}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onOpenDiff && (
            <button
              onClick={onOpenDiff}
              title="View Git Diff"
              className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              <FileDiff className="w-3.5 h-3.5" />
            </button>
          )}
          {attachedAddress && onInterrupt && (
            <button
              onClick={onInterrupt}
              title="Send interrupt signal"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-white/8 hover:bg-amber-500/20 text-slate-200 hover:text-amber-300 transition-colors cursor-pointer"
            >
              <OctagonX className="w-3 h-3" />
              Stop
            </button>
          )}
          {attachedAddress && onPopout && (
            <button
              onClick={onPopout}
              title="Pop out in external terminal"
              className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            title="Close terminal pane (Ctrl+`)"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-white/10 hover:bg-white/15 text-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-3 h-3" />
            <kbd className="text-[10px] text-slate-300 font-mono-code">
              Ctrl+`
            </kbd>
          </button>
        </div>
      </div>

      {attachedAddress && (
        <div
          className="px-3.5 py-1.5 flex items-center gap-1.5 flex-wrap shrink-0 select-none"
          style={{
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          {presets.slice(0, 8).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSendPreset(p.prompt)}
              title={p.prompt}
              className="px-3 py-0.5 rounded-full text-[11px] bg-white/8 hover:bg-white/15 text-slate-200 hover:text-white transition-colors cursor-pointer"
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onOpenSettings}
            title="프롬프트 프리셋 편집"
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <Settings2 className="w-3 h-3" />
            <span>Edit</span>
          </button>
        </div>
      )}
    </>
  );
});
