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
      if (
        attachedAddress &&
        target.terminalAddresses.includes(attachedAddress)
      ) {
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
      const updated = await listProjectWorktrees(target.projectId).catch(
        () => []
      );
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-md rounded-[22px] overflow-hidden"
        style={{ borderColor: "var(--action-border)" }}
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div
            className="flex items-center gap-2"
            style={{ color: "var(--action-fg)" }}
          >
            <Trash2 className="w-4 h-4" />
            <h3 className="text-sm font-bold">Clean Worktree Teardown</h3>
          </div>
          <button
            onClick={() => setTarget(null)}
            className="p-1.5 rounded-full hover:bg-black/10 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-xs">
          <div
            className="font-mono-code"
            style={{ color: "var(--text-primary)" }}
          >
            Branch: <span className="font-bold">{target.branch}</span>
          </div>
          <div
            className="text-[11px] font-mono-code break-all"
            style={{ color: "var(--text-muted)" }}
          >
            {target.worktreePath}
          </div>

          {target.dirtyCount > 0 && (
            <div
              className="p-3 rounded-2xl flex items-start gap-2"
              style={{
                background: "var(--warn-soft)",
                border: "1px solid var(--warn-border)",
                color: "var(--warn-fg)",
              }}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                This worktree has {target.dirtyCount} uncommitted file(s). Enable
                Force Remove only if you want to discard them.
              </span>
            </div>
          )}

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

          <label
            className="flex items-center gap-2 cursor-pointer"
            style={{ color: "var(--text-secondary)" }}
          >
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
            />
            Also delete local Git branch (
            {target.isMerged ? "already merged" : "unmerged"})
          </label>

          {target.dirtyCount > 0 && (
            <label
              className="flex items-center gap-2 cursor-pointer"
              style={{ color: "var(--action-fg)" }}
            >
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
              />
              Force remove worktree and discard uncommitted changes
            </label>
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
            onClick={() => setTarget(null)}
            className="px-4 py-1.5 rounded-full text-xs cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={running || (target.dirtyCount > 0 && !force)}
            className="px-4 py-1.5 rounded-full text-xs font-semibold disabled:opacity-40 text-white cursor-pointer"
            style={{ background: "var(--action-fg)" }}
          >
            {running ? "Removing..." : "Teardown Now"}
          </button>
        </div>
      </div>
    </div>
  );
});
