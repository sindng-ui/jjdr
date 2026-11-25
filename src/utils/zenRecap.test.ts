import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDailyRecapMarkdown,
  pickDailyMvp,
  readAllDailyRecaps,
  recordZenRecapEvent,
} from "./zenRecap";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (idx: number) => Array.from(store.keys())[idx] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };
}

describe("zenRecap", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: createMemoryStorage() },
      configurable: true,
      writable: true,
    });
  });

  it("accumulates cleared & dispatched events per worker and picks MVP", () => {
    const day = new Date(2026, 10, 25, 14, 0, 0);
    recordZenRecapEvent({
      kind: "dispatched",
      cardKey: "wt::p1::c:/repos/p1-a",
      worktreePath: "C:/repos/p1-a",
      projectId: "p1",
      projectName: "jjdr",
      projectColor: "#38bdf8",
      branch: "feat/zen-dispatch",
      summary: "Started dispatch flow",
      now: day,
    });
    recordZenRecapEvent({
      kind: "cleared",
      cardKey: "wt::p1::c:/repos/p1-a",
      worktreePath: "C:/repos/p1-a",
      projectId: "p1",
      projectName: "jjdr",
      projectColor: "#38bdf8",
      branch: "feat/zen-dispatch",
      addedLines: 120,
      deletedLines: 30,
      isMerged: true,
      summary: "All tests passed!",
      now: day,
    });
    const log = recordZenRecapEvent({
      kind: "cleared",
      cardKey: "wt::p1::c:/repos/p1-b",
      worktreePath: "C:/repos/p1-b",
      projectId: "p1",
      projectName: "jjdr",
      projectColor: "#38bdf8",
      branch: "fix/trust",
      now: day,
    });

    expect(log.dateKey).toBe("2026-11-25");
    expect(log.totalCleared).toBe(2);
    expect(log.totalDispatched).toBe(1);
    const entries = Object.values(log.entries);
    expect(entries).toHaveLength(2);

    const mvp = pickDailyMvp(entries);
    expect(mvp?.branch).toBe("feat/zen-dispatch");

    const standupMd = buildDailyRecapMarkdown(
      log.dateKey,
      entries,
      { cleared: log.totalCleared, dispatched: log.totalDispatched },
      "standup"
    );
    expect(standupMd).toContain("## Daily Recap — 2026-11-25 (2 cleared · 1 dispatched)");
    expect(standupMd).toContain("### jjdr");
    expect(standupMd).toContain("MERGED");
    expect(standupMd).toContain("All tests passed!");

    const compactMd = buildDailyRecapMarkdown(
      log.dateKey,
      entries,
      { cleared: log.totalCleared, dispatched: log.totalDispatched },
      "compact"
    );
    expect(compactMd).toContain("[2026-11-25] 2 cleared, 1 dispatched across 1 project");
    expect(compactMd).toContain("jjdr / feat/zen-dispatch (+120/-30) [MERGED]");
  });

  it("prunes stored logs to the latest 7 days", () => {
    for (let day = 1; day <= 10; day++) {
      recordZenRecapEvent({
        kind: "cleared",
        cardKey: `wt::p1::c:/repos/p1-${day}`,
        worktreePath: `C:/repos/p1-${day}`,
        projectId: "p1",
        projectName: "jjdr",
        projectColor: "#38bdf8",
        branch: `feat/day-${day}`,
        now: new Date(2026, 10, day, 12, 0, 0),
      });
    }
    const all = readAllDailyRecaps();
    expect(Object.keys(all)).toHaveLength(7);
    expect(all["2026-11-10"]).toBeDefined();
    expect(all["2026-11-01"]).toBeUndefined();
  });
});
