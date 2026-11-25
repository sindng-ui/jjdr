import { describe, expect, it } from "vitest";
import { getWorkerPersona } from "./workerPersona";

describe("workerPersona", () => {
  it("produces deterministic monster persona for the same worktree seed", () => {
    const a = getWorkerPersona("c:/repos/happytext-wt-333");
    const b = getWorkerPersona("C:/Repos/happytext-wt-333 ");
    expect(a).toEqual(b);
    expect(a.name.length).toBeGreaterThan(0);
    expect(a.role.length).toBeGreaterThan(0);
  });

  it("assigns distinct personas across different worktrees", () => {
    const seeds = [
      "c:/repos/app-wt-1",
      "c:/repos/app-wt-2",
      "c:/repos/app-wt-3",
      "c:/repos/app-wt-4",
      "c:/repos/app-wt-5",
    ];
    const names = new Set(seeds.map((s) => getWorkerPersona(s).name));
    expect(names.size).toBeGreaterThanOrEqual(4);
  });
});
