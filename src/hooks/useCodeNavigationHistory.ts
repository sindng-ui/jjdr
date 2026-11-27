import { useCallback, useRef, useState } from "react";

export interface CodeNavLocation {
  absolutePath: string;
  relativePath: string;
  projectName: string;
  rootPath: string;
  projectId?: string;
  repoPath?: string;
  line: number;
  col?: number;
}

const MAX_HISTORY_ENTRIES = 60;

export interface CodeNavHistoryState {
  back: CodeNavLocation[];
  forward: CodeNavLocation[];
}

export function createCodeNavHistoryState(): CodeNavHistoryState {
  return { back: [], forward: [] };
}

export function pushNavLocation(
  state: CodeNavHistoryState,
  current: CodeNavLocation,
  next: CodeNavLocation
): boolean {
  if (current.absolutePath === next.absolutePath && current.line === next.line) {
    return false;
  }
  const top = state.back[state.back.length - 1];
  if (!top || top.absolutePath !== current.absolutePath || top.line !== current.line) {
    state.back.push(current);
    if (state.back.length > MAX_HISTORY_ENTRIES) {
      state.back.splice(0, state.back.length - MAX_HISTORY_ENTRIES);
    }
  }
  state.forward = [];
  return true;
}

export function stepNavBack(
  state: CodeNavHistoryState,
  current: CodeNavLocation
): CodeNavLocation | null {
  const prev = state.back.pop();
  if (!prev) return null;
  state.forward.push(current);
  if (state.forward.length > MAX_HISTORY_ENTRIES) {
    state.forward.splice(0, state.forward.length - MAX_HISTORY_ENTRIES);
  }
  return prev;
}

export function stepNavForward(
  state: CodeNavHistoryState,
  current: CodeNavLocation
): CodeNavLocation | null {
  const next = state.forward.pop();
  if (!next) return null;
  state.back.push(current);
  if (state.back.length > MAX_HISTORY_ENTRIES) {
    state.back.splice(0, state.back.length - MAX_HISTORY_ENTRIES);
  }
  return next;
}

export interface CodeNavigationHistory {
  canBack: boolean;
  canForward: boolean;
  pushLocation: (current: CodeNavLocation, next: CodeNavLocation) => void;
  goBack: (current: CodeNavLocation) => CodeNavLocation | null;
  goForward: (current: CodeNavLocation) => CodeNavLocation | null;
  reset: () => void;
}

export function useCodeNavigationHistory(): CodeNavigationHistory {
  const stateRef = useRef<CodeNavHistoryState>(createCodeNavHistoryState());
  const [, setTick] = useState(0);

  const bump = useCallback(() => setTick((t) => t + 1), []);

  const pushLocation = useCallback(
    (current: CodeNavLocation, next: CodeNavLocation) => {
      if (pushNavLocation(stateRef.current, current, next)) {
        bump();
      }
    },
    [bump]
  );

  const goBack = useCallback(
    (current: CodeNavLocation): CodeNavLocation | null => {
      const prev = stepNavBack(stateRef.current, current);
      if (prev) bump();
      return prev;
    },
    [bump]
  );

  const goForward = useCallback(
    (current: CodeNavLocation): CodeNavLocation | null => {
      const next = stepNavForward(stateRef.current, current);
      if (next) bump();
      return next;
    },
    [bump]
  );

  const reset = useCallback(() => {
    stateRef.current = createCodeNavHistoryState();
    bump();
  }, [bump]);

  return {
    canBack: stateRef.current.back.length > 0,
    canForward: stateRef.current.forward.length > 0,
    pushLocation,
    goBack,
    goForward,
    reset,
  };
}
