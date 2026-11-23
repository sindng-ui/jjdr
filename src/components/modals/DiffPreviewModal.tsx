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
      className="fixed inset-0 z-50 bg-[#05070a]/80 flex items-center justify-center p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl h-[80vh] rounded-xl bg-[#111318] border border-[#252932] flex flex-col overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-[#1c1f26] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <FileDiff className="w-4 h-4 text-[#58a6ff]" />
            <h3 className="text-sm font-bold text-[#e6edf3] font-mono-code">
              Diff — {target.branch}
            </h3>
            {detail && (
              <span className="text-xs text-[#8b949e]">{detail.stat_summary}</span>
            )}
          </div>
          <button
            onClick={() => setTarget(null)}
            className="text-[#8b949e] hover:text-[#e6edf3] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3 bg-[#0b0c0e] font-mono-code text-xs leading-5">
          {loading && <div className="text-[#8b949e]">Loading diff...</div>}
          {error && <div className="text-[#ff7b72]">{error}</div>}
          {detail && detail.diff_text.trim().length === 0 && (
            <div className="text-[#8b949e]">No diff lines found (working tree clean).</div>
          )}
          {detail &&
            detail.diff_text.split("\n").map((line, i) => {
              let cls = "text-[#c9d1d9]";
              if (line.startsWith("+") && !line.startsWith("+++")) {
                cls = "text-[#56d364] bg-[#12261a]";
              } else if (line.startsWith("-") && !line.startsWith("---")) {
                cls = "text-[#ff7b72] bg-[#2a1518]";
              } else if (line.startsWith("@@")) {
                cls = "text-[#79c0ff] bg-[#152033]";
              } else if (line.startsWith("diff --git")) {
                cls = "text-[#e3b341] font-bold mt-2";
              }
              return (
                <div key={i} className={`px-2 whitespace-pre ${cls}`}>
                  {line}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
});
