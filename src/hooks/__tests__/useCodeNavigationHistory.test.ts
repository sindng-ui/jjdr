import { describe, expect, it } from "vitest";
import {
  createCodeNavHistoryState,
  pushNavLocation,
  stepNavBack,
  stepNavForward,
  type CodeNavLocation,
} from "../useCodeNavigationHistory";

function loc(file: string, line: number): CodeNavLocation {
  return {
    absolutePath: `/repo/${file}`,
    relativePath: file,
    projectName: "demo",
    rootPath: "/repo",
    line,
  };
}

describe("useCodeNavigationHistory state machine", () => {
  it("pushes jumps and navigates back and forward accurately", () => {
    const state = createCodeNavHistoryState();
    expect(state.back.length).toBe(0);
    expect(state.forward.length).toBe(0);

    expect(pushNavLocation(state, loc("A.cs", 10), loc("B.cs", 42))).toBe(true);
    expect(state.back.length).toBe(1);
    expect(state.forward.length).toBe(0);

    const backTarget = stepNavBack(state, loc("B.cs", 42));
    expect(backTarget).toEqual(loc("A.cs", 10));
    expect(state.back.length).toBe(0);
    expect(state.forward.length).toBe(1);

    const fwdTarget = stepNavForward(state, loc("A.cs", 10));
    expect(fwdTarget).toEqual(loc("B.cs", 42));
    expect(state.back.length).toBe(1);
    expect(state.forward.length).toBe(0);
  });

  it("clears forward stack when pushing a new branch jump", () => {
    const state = createCodeNavHistoryState();
    pushNavLocation(state, loc("A.cs", 1), loc("B.cs", 2));
    stepNavBack(state, loc("B.cs", 2));
    expect(state.forward.length).toBe(1);

    pushNavLocation(state, loc("A.cs", 1), loc("C.cs", 99));
    expect(state.forward.length).toBe(0);
    expect(state.back.length).toBe(1);
  });

  it("ignores no-op jumps to the same file and line", () => {
    const state = createCodeNavHistoryState();
    expect(pushNavLocation(state, loc("A.cs", 12), loc("A.cs", 12))).toBe(false);
    expect(state.back.length).toBe(0);
  });
});
