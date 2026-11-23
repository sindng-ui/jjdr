import React, { useEffect, useState } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  listProjectWorktrees,
  teardownWorktree,
} from "../../services/tauriBridge";

export const TeardownModal = React.memo(function TeardownModal() {
  const target = useUiStore((s) => s.teardownTarget);
  const setTarget = useUiStore((s) => s.setTeardownTarget);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const showToast = useUiStore((s) => s.showToast);

  const [deleteBranch, setDeleteBranch] = useState(true);
  const [force, setForce] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setDeleteBranch(target.isMerged);
      setForce(false);
      setError(null);
    }
  }, [target]);

  if (!target) return null;

  const handleConfirm = async () => {
    setRunning(true);
    setError(null);
    try {
      if (attachedAddress && target.terminalAddresses.includes(attachedAddress)) {
        setAttachedAddress(null);
      }
      await teardownWorktree({
        project_id: target.projectId,
        worktree_path: target.worktreePath,
        branch_name: target.branch,
        force,
        delete_branch: deleteBranch,
        terminal_addresses: target.terminalAddresses,
      });
      const updated = await listProjectWorktrees(target.projectId).catch(() => []);
      useAppStore.getState().setProjectWorktrees(target.projectId, updated);
      showToast(`Cleaned up worktree ${target.branch}`, "success");
      setTarget(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      onClick={() => setTarget(null)}
      className="fixed inset-0 z-50 bg-[#05070a]/80 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-[#111318] border border-[#f85149]/50 overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-[#1c1f26] flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#ff7b72]">
            <Trash2 className="w-4 h-4" />
            <h3 className="text-sm font-bold">Clean Worktree Teardown</h3>
          </div>
          <button
            onClick={() => setTarget(null)}
            className="text-[#8b949e] hover:text-[#e6edf3] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs">
          <div className="font-mono-code text-[#e6edf3]">
            Branch: <span className="font-bold">{target.branch}</span>
          </div>
          <div className="text-[11px] font-mono-code text-[#8b949e] break-all">
            {target.worktreePath}
          </div>

          {target.dirtyCount > 0 && (
            <div className="p-2.5 rounded bg-[#362411] border border-[#f0883e]/50 text-[#f0883e] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                This worktree has {target.dirtyCount} uncommitted file(s). Enable Force Remove only if you want to discard them.
              </span>
            </div>
          )}

          {error && (
            <div className="p-2.5 rounded bg-[#2d1619] border border-[#f85149]/50 text-[#ff7b72]">
              {error}
            </div>
          )}

          <label className="flex items-center gap-2 text-[#c9d1d9] cursor-pointer">
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
            />
            Also delete local Git branch ({target.isMerged ? "already merged" : "unmerged"})
          </label>

          {target.dirtyCount > 0 && (
            <label className="flex items-center gap-2 text-[#ff7b72] cursor-pointer">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
              />
              Force remove worktree and discard uncommitted changes
            </label>
          )}
        </div>

        <div className="px-4 py-3 bg-[#0e1014] border-t border-[#1c1f26] flex justify-end gap-2">
          <button
            onClick={() => setTarget(null)}
            className="px-3 py-1.5 rounded text-xs text-[#9aa7b8] cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={running || (target.dirtyCount > 0 && !force)}
            className="px-4 py-1.5 rounded text-xs font-semibold bg-[#da3633] hover:bg-[#f85149] disabled:opacity-40 text-white cursor-pointer"
          >
            {running ? "Removing..." : "Teardown Now"}
          </button>
        </div>
      </div>
    </div>
  );
});
