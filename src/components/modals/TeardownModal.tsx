import React, { useEffect, useState } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import {
  listProjectWorktrees,
  teardownWorktree,
} from "../../services/tauriBridge";
import { normalizePath } from "../../workers/dashboardLogic";

export const TeardownModal = React.memo(function TeardownModal() {
  const target = useUiStore((s) => s.teardownTarget);
  const setTarget = useUiStore((s) => s.setTeardownTarget);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const setAttachedAddress = useUiStore((s) => s.setAttachedAddress);
  const showToast = useUiStore((s) => s.showToast);

  const [deleteBranch, setDeleteBranch] = useState(true);
  const [force, setForce] = useState(false);

  useEffect(() => {
    if (target) {
      setDeleteBranch(target.isMerged);
      setForce(false);
    }
  }, [target]);

  if (!target) return null;

  const handleConfirm = () => {
    const snap = target;
    const normWt = normalizePath(snap.worktreePath);

    // 1. Detach right terminal drawer & clear selection if it belonged to the deleted worktree
    if (
      attachedAddress &&
      snap.terminalAddresses.includes(attachedAddress)
    ) {
      setAttachedAddress(null);
    }
    const curSelected = useUiStore.getState().selectedAddress;
    if (curSelected && snap.terminalAddresses.includes(curSelected)) {
      useUiStore.getState().setSelectedAddress(null);
    }

    // 2. Optimistically hide the worktree card & close modal IMMEDIATELY (0ms UI block)
    useAppStore.getState().markWorktreeRemoving(snap.projectId, normWt);
    setTarget(null);
    showToast(`'${snap.branch}' 백그라운드에서 삭제 중...`, "info", 2800);

    // 3. Dispatch background Rust teardown (result arrives via `jjdr:worktree-teardown-result`)
    void teardownWorktree({
      project_id: snap.projectId,
      worktree_path: snap.worktreePath,
      branch_name: snap.branch,
      force,
      delete_branch: deleteBranch,
      terminal_addresses: snap.terminalAddresses,
    }).catch(async (err) => {
      const latest = await listProjectWorktrees(snap.projectId).catch(() => null);
      useAppStore
        .getState()
        .finishWorktreeRemoving(snap.projectId, normWt, latest);
      useUiStore
        .getState()
        .showToast(`Worktree 삭제 시작 실패 (${snap.branch}): ${String(err)}`, "error", 6000);
    });
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
            onClick={handleConfirm}
            disabled={target.dirtyCount > 0 && !force}
            className="px-4 py-1.5 rounded-full text-xs font-semibold disabled:opacity-40 text-white cursor-pointer"
            style={{ background: "var(--action-fg)" }}
          >
            Teardown Now
          </button>
        </div>
      </div>
    </div>
  );
});
