import React, { useEffect, useState } from "react";
import { FileDiff, X } from "lucide-react";
import { useUiStore } from "../../store/useUiStore";
import { fetchWorktreeDiff } from "../../services/tauriBridge";
import type { DiffDetail } from "../../types/domain";

export const DiffPreviewModal = React.memo(function DiffPreviewModal() {
  const target = useUiStore((s) => s.diffTarget);
  const setTarget = useUiStore((s) => s.setDiffTarget);
  const [detail, setDetail] = useState<DiffDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setLoading(true);
    setError(null);
    setDetail(null);
    void fetchWorktreeDiff(target.projectId, target.worktreePath)
      .then((res) => setDetail(res))
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [target]);

  if (!target) return null;

  return (
    <div
      onClick={() => setTarget(null)}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "var(--modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="jjdr-modal w-full max-w-4xl h-[80vh] rounded-[22px] flex flex-col overflow-hidden"
      >
        <div
          className="px-5 py-4 flex items-center justify-between shrink-0"
          style={{ borderBottom: "1px solid var(--divider)" }}
        >
          <div className="flex items-center gap-2.5">
            <FileDiff className="w-4 h-4" style={{ color: "var(--accent)" }} />
            <h3
              className="text-sm font-bold font-mono-code"
              style={{ color: "var(--text-primary)" }}
            >
              Diff — {target.branch}
            </h3>
            {detail && (
              <span
                className="text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                {detail.stat_summary}
              </span>
            )}
          </div>
          <button
            onClick={() => setTarget(null)}
            className="p-1.5 rounded-full hover:bg-black/10 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          className="flex-1 overflow-auto p-4 font-mono-code text-xs leading-5 text-slate-200"
          style={{ background: "var(--term-bg)" }}
        >
          {loading && <div className="text-slate-400">Loading diff...</div>}
          {error && <div className="text-rose-400">{error}</div>}
          {detail && detail.diff_text.trim().length === 0 && (
            <div className="text-slate-400">
              No diff lines found (working tree clean).
            </div>
          )}
          {detail &&
            detail.diff_text.split("\n").map((line, i) => {
              let cls = "text-slate-200";
              if (line.startsWith("+") && !line.startsWith("+++")) {
                cls = "text-emerald-300 bg-emerald-500/15";
              } else if (line.startsWith("-") && !line.startsWith("---")) {
                cls = "text-rose-300 bg-rose-500/15";
              } else if (line.startsWith("@@")) {
                cls = "text-sky-300 bg-sky-500/15";
              } else if (line.startsWith("diff --git")) {
                cls = "text-amber-300 font-bold mt-2";
              }
              return (
                <div key={i} className={`px-2 rounded whitespace-pre ${cls}`}>
                  {line}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
});
