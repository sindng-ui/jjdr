import { useEffect, useRef } from "react";
import { useUiStore, type ZenDispatchStep } from "../store/useUiStore";
import type { ZenDispatchProjectSummary } from "../utils/zenDispatch";

interface UseZenDispatchShortcutsParams {
  step: ZenDispatchStep;
  hasHiringState: boolean;
  isAwaitingHireConfirm: boolean;
  projectSummaries: ZenDispatchProjectSummary[];
  selectedSummary: ZenDispatchProjectSummary | null;
  zenSkipNonce: number;
  zenPrevNonce: number;
  zenApproveNonce: number;
  onSelectProject: (projectId: string) => void;
  onHireProject: (projectId: string) => void;
  onEnterBrowse: () => void;
  onConfirmHire: () => void;
  onStepWorker: (delta: number) => void;
  onWakeDormantAi: () => void;
}

/**
 * Keyboard & global-nonce bindings dedicated to Zen Worker Dispatch:
 * - Step 1: 1-9 picks a project
 * - Step 2: 1 hires a new worker, 2/Enter opens existing worker deck
 * - Solo hire reveal: Enter / Ctrl+Enter stamps HIRED! and opens terminal
 * - Step 3: Ctrl+N / Ctrl+Right (next), Ctrl+Left (prev), Ctrl+Enter (wake dormant AI)
 */
export function useZenDispatchShortcuts({
  step,
  hasHiringState,
  isAwaitingHireConfirm,
  projectSummaries,
  selectedSummary,
  zenSkipNonce,
  zenPrevNonce,
  zenApproveNonce,
  onSelectProject,
  onHireProject,
  onEnterBrowse,
  onConfirmHire,
  onStepWorker,
  onWakeDormantAi,
}: UseZenDispatchShortcutsParams) {
  const prevSkipNonceRef = useRef(zenSkipNonce);
  const prevPrevNonceRef = useRef(zenPrevNonce);
  const prevApproveNonceRef = useRef(zenApproveNonce);

  // Step 1 & Step 2 shortcuts (1-9 for project, 1/2/Enter for action)
  useEffect(() => {
    if (step === "browse_worker" || hasHiringState) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const ui = useUiStore.getState();
      if (
        ui.createWorktreeProjectId ||
        ui.projectModalProject ||
        ui.commandPaletteOpen ||
        ui.quickFileOpen ||
        ui.settingsOpen
      ) {
        return;
      }

      if (step === "pick_project") {
        const num = Number(e.key);
        if (num >= 1 && num <= 9 && num <= projectSummaries.length) {
          e.preventDefault();
          onSelectProject(projectSummaries[num - 1].project.id);
        }
        return;
      }

      if (step === "pick_action" && selectedSummary) {
        if (e.key === "1") {
          e.preventDefault();
          onHireProject(selectedSummary.project.id);
        } else if (
          (e.key === "2" || e.key === "Enter") &&
          selectedSummary.totalAvailableCount > 0
        ) {
          e.preventDefault();
          onEnterBrowse();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    step,
    hasHiringState,
    projectSummaries,
    selectedSummary,
    onSelectProject,
    onHireProject,
    onEnterBrowse,
  ]);

  // Enter key confirms HIRED! during solo reveal
  useEffect(() => {
    if (!isAwaitingHireConfirm) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      onConfirmHire();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAwaitingHireConfirm, onConfirmHire]);

  // React to global Ctrl+N / Ctrl+Right (next), Ctrl+Left (prev), Ctrl+Enter (confirm hire or wake AI)
  useEffect(() => {
    if (zenSkipNonce !== prevSkipNonceRef.current) {
      prevSkipNonceRef.current = zenSkipNonce;
      onStepWorker(1);
    }
  }, [zenSkipNonce, onStepWorker]);

  useEffect(() => {
    if (zenPrevNonce !== prevPrevNonceRef.current) {
      prevPrevNonceRef.current = zenPrevNonce;
      onStepWorker(-1);
    }
  }, [zenPrevNonce, onStepWorker]);

  useEffect(() => {
    if (zenApproveNonce !== prevApproveNonceRef.current) {
      prevApproveNonceRef.current = zenApproveNonce;
      if (isAwaitingHireConfirm) {
        onConfirmHire();
      } else if (step === "browse_worker") {
        onWakeDormantAi();
      }
    }
  }, [
    zenApproveNonce,
    isAwaitingHireConfirm,
    step,
    onConfirmHire,
    onWakeDormantAi,
  ]);
}
