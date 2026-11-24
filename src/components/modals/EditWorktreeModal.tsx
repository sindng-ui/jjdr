import React, { useEffect, useState } from "react";
import { GitBranch, Pencil, X } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { normalizePath } from "../../workers/dashboardLogic";
import {
  listProjectWorktrees,
  renameWorktreeBranch,
} from "../../services/tauriBridge";

export const EditWorktreeModal = React.memo(function EditWorktreeModal() {
  const target = useUiStore((s) => s.editWorktreeTarget);
  const setTarget = useUiStore((s) => s.setEditWorktreeTarget);
  const showToast = useUiStore((s) => s.showToast);

  const normPath = target ? normalizePath(target.worktreePath) : "";
  const existingMeta = useAppStore((s) =>
    normPath ? s.worktreeMeta[normPath] : undefined
  );

  const [displayName, setDisplayName] = useState("");
  const [note, setNote] = useState("");
  const [branchName, setBranchName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setDisplayName(existingMeta?.display_name ?? "");
    setNote(existingMeta?.note ?? "");
    setBranchName(target.branch || "");
    setError(null);
  }, [target, existingMeta]);

  if (!target) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      // Optional Git branch rename for non-main worktrees
      const nextBranch = branchName.trim();
      if (
        !target.isMain &&
        target.branch &&
        nextBranch &&
        nextBranch !== target.branch
      ) {
        await renameWorktreeBranch({
          project_id: target.projectId,
          old_branch: target.branch,
          new_branch: nextBranch,
        });
        const updatedWts = await listProjectWorktrees(target.projectId).catch(
          () => null
        );
        if (updatedWts) {
          useAppStore
            .getState()
            .setProjectWorktrees(target.projectId, updatedWts);
        }
      }

      useAppStore.getState().setWorktreeMeta(normPath, {
        display_name: displayName.trim() || null,
        note: note.trim() || null,
      });

      showToast("Worktree 카드가 업데이트되었습니다.", "success");
      setTarget(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={() => setTarget(null)}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--modal-overlay)" }}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-md rounded-[22px] overflow-hidden"
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Pencil
              className="w-4 h-4 shrink-0"
              style={{ color: "var(--accent)" }}
            />
            <h3
              className="text-sm font-bold truncate"
              style={{ color: "var(--text-primary)" }}
            >
              Worktree 카드 편집
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setTarget(null)}
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

          <div
            className="text-[11px] font-mono-code truncate"
            style={{ color: "var(--text-muted)" }}
          >
            {target.worktreePath}
          </div>

          <div>
            <label
              className="block mb-1.5 font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              카드 표시 이름 (별칭)
            </label>
            <input
              type="text"
              autoFocus
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={`비워두면 Git 브랜치명(${target.branch || "main"}) 표시`}
              className="jjdr-input w-full px-3.5 py-2 rounded-full"
            />
          </div>

          <div>
            <label
              className="block mb-1.5 font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              간단 메모 (선택)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 결제 API 리팩토링, 핫픽스 확인 중..."
              className="jjdr-input w-full px-3.5 py-2 rounded-full"
            />
          </div>

          {!target.isMain && target.branch && (
            <div
              className="pt-3"
              style={{ borderTop: "1px solid var(--divider)" }}
            >
              <label
                className="flex items-center gap-1.5 mb-1.5 font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                <GitBranch
                  className="w-3.5 h-3.5"
                  style={{ color: "var(--ready-fg)" }}
                />
                <span>실제 Git 브랜치명 변경 (선택)</span>
              </label>
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="jjdr-input w-full px-3.5 py-2 rounded-full font-mono-code"
              />
              <p
                className="mt-1 text-[10.5px]"
                style={{ color: "var(--text-faint)" }}
              >
                브랜치명을 수정하면 로컬 Git 브랜치가{" "}
                <code className="font-mono-code">git branch -m</code>으로
                변경됩니다.
              </p>
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
            onClick={() => setTarget(null)}
            className="px-4 py-1.5 rounded-full text-xs cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="jjdr-primary-btn px-4 py-1.5 rounded-full text-xs font-semibold disabled:opacity-40 cursor-pointer"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
});
