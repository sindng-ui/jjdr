import { useEffect, useRef } from "react";
import { useAppStore } from "../store/useAppStore";
import { useUiStore } from "../store/useUiStore";
import { warmProjectFileIndex } from "../services/tauriBridge";
import { normalizePath } from "../workers/dashboardLogic";

/**
 * Quietly warms the Rust backend's shared Base + Delta file index ONLY for
 * projects/worktrees the user has actually focused, debounced so rapid
 * keyboard navigation never wastes CPU or touches the UI thread.
 */
export function useFileIndexWarmup() {
  const selectedCardKey = useUiStore((s) => s.selectedCardKey);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const hydrated = useAppStore((s) => s.hydrated);
  const lastWarmedRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!hydrated) return;

    let projectId: string | null = null;
    let worktreePath: string | null = null;

    if (selectedCardKey && selectedCardKey.startsWith("wt::")) {
      const rest = selectedCardKey.slice(4);
      const sepIdx = rest.indexOf("::");
      if (sepIdx > 0) {
        projectId = rest.slice(0, sepIdx);
        const normPath = rest.slice(sepIdx + 2);
        const wts = useAppStore.getState().worktreesByProject[projectId] ?? [];
        const match = wts.find((w) => normalizePath(w.path) === normPath);
        worktreePath = match?.path ?? null;
      }
    } else if (selectedProjectId) {
      projectId = selectedProjectId;
    }

    if (!projectId) return;

    const dedupeKey = `${projectId}::${worktreePath ? normalizePath(worktreePath) : "base"}`;
    const prevMs = lastWarmedRef.current.get(dedupeKey) ?? 0;
    if (Date.now() - prevMs < 20_000) {
      return;
    }

    const timer = setTimeout(() => {
      lastWarmedRef.current.set(dedupeKey, Date.now());
      void warmProjectFileIndex(projectId!, worktreePath).catch(() => {});
    }, 450);

    return () => clearTimeout(timer);
  }, [hydrated, selectedCardKey, selectedProjectId]);
}
