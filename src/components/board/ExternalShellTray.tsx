import React from "react";
import { Plus, Terminal, Trash2 } from "lucide-react";
import type { EnrichedSession } from "../../types/domain";
import { useUiStore } from "../../store/useUiStore";
import { StatusBadge } from "../shared/StatusBadge";
import { shortPath } from "../../utils/format";
import { killTerminal, launchSession } from "../../services/tauriBridge";

interface ExternalShellTrayProps {
  unassigned: EnrichedSession[];
  activeCols: number;
}

export const ExternalShellTray = React.memo(function ExternalShellTray({
  unassigned,
  activeCols,
}: ExternalShellTrayProps) {
  const selectedCardKey = useUiStore((s) => s.selectedCardKey);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const terminalDrawerOpen = useUiStore((s) => s.terminalDrawerOpen);
  const setSelectedCardKey = useUiStore((s) => s.setSelectedCardKey);
  const setSelectedAddress = useUiStore((s) => s.setSelectedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const detachToEmptyDrawer = useUiStore((s) => s.detachToEmptyDrawer);
  const showToast = useUiStore((s) => s.showToast);

  const handleLaunchStandaloneShell = async () => {
    try {
      const addr = await launchSession({
        cwd: "",
        argv: [],
      });
      if (addr) {
        setSelectedCardKey(`ext::${addr}`);
        setSelectedAddress(addr);
        setAttachedAddress(addr);
      }
    } catch (err) {
      showToast(`쉘 실행 실패: ${String(err)}`, "error");
    }
  };

  return (
    <section className="jjdr-tray w-full rounded-[22px] p-3.5 space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-6 h-6 rounded-[9px] flex items-center justify-center shrink-0"
            style={{
              background: "var(--pill-bg)",
              border: "1px solid var(--pill-border)",
              color: "var(--text-muted)",
            }}
          >
            <Terminal className="w-3 h-3" />
          </span>
          <span
            className="text-[13px] font-bold tracking-tight truncate"
            style={{ color: "var(--text-secondary)" }}
          >
            Shells & External
          </span>
          <span
            className="text-xs font-mono-code tabular-nums shrink-0"
            style={{ color: "var(--text-faint)" }}
          >
            {unassigned.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void handleLaunchStandaloneShell()}
          className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors shrink-0 cursor-pointer whitespace-nowrap"
          style={{ color: "var(--text-secondary)" }}
          title="새 PowerShell 터미널 열기"
        >
          <Plus className="w-3 h-3" />
          <span>Shell</span>
        </button>
      </div>

      {unassigned.length > 0 && (
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${activeCols}, minmax(0, 1fr))`,
          }}
        >
          {unassigned.map((s) => {
            const extKey = `ext::${s.address}`;
            const isSelected = selectedCardKey === extKey;
            const isAttached = attachedAddress === s.address;

            return (
              <div
                key={s.address}
                data-jjdr-card={extKey}
                data-jjdr-session-addr={s.address}
                onClick={() => {
                  setSelectedCardKey(extKey);
                  setSelectedAddress(s.address);
                  if ((terminalDrawerOpen || attachedAddress) && s.terminal.state === "live") {
                    setAttachedAddress(s.address);
                  }
                }}
                onDoubleClick={() => {
                  setSelectedCardKey(extKey);
                  setSelectedAddress(s.address);
                  if (s.terminal.state === "live") {
                    setAttachedAddress(s.address);
                  }
                }}
                className="jjdr-card-lift group rounded-[18px] p-3.5 flex items-center justify-between gap-2 cursor-pointer select-none min-w-0"
                style={{
                  background: isSelected ? "var(--card-bg)" : "var(--card-idle-bg)",
                  border: isSelected
                    ? "1px solid var(--accent-border)"
                    : "1px dashed var(--card-idle-border)",
                  boxShadow: isSelected
                    ? "var(--card-selected-shadow)"
                    : "var(--card-shadow)",
                }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge bucket={s.bucket} compact />
                    <span
                      className="text-[13px] font-mono-code font-bold truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {s.terminal.name || s.address}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 text-xs font-mono-code truncate"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {s.agentLabel} · {shortPath(s.worktreePath)}
                  </div>
                </div>
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 shrink-0"
                >
                  {isAttached && (
                    <Terminal
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: "var(--accent)" }}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      void killTerminal(s.address, true);
                      if (isAttached) detachToEmptyDrawer();
                    }}
                    title="Close terminal"
                    className="hidden group-hover:inline-flex p-1.5 rounded-full hover:bg-black/15 cursor-pointer"
                    style={{ color: "var(--action-fg)" }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
});
