import { describe, expect, it } from "vitest";
import { hasBlockingModalOpen, type BlockingModalState } from "./modalGuard";

function emptyState(): BlockingModalState {
  return {
    settingsOpen: false,
    commandPaletteOpen: false,
    quickFileOpen: false,
    workspaceSearchOpen: false,
    projectModalProject: null,
    createWorktreeProjectId: null,
    editWorktreeTarget: null,
    launchTarget: null,
    teardownTarget: null,
    diffTarget: null,
    markdownViewerTarget: null,
    codeViewerTarget: null,
    reviewPickerTarget: null,
    manualReviewModalOpen: false,
    updateModalOpen: false,
    contextMenu: null,
  };
}

describe("hasBlockingModalOpen", () => {
  it("returns false when no modal or context menu is open", () => {
    expect(hasBlockingModalOpen(emptyState())).toBe(false);
  });

  it("returns true when updateModalOpen is true", () => {
    expect(
      hasBlockingModalOpen({
        ...emptyState(),
        updateModalOpen: true,
      })
    ).toBe(true);
  });

  it("returns true when any blocking modal or context menu is active", () => {
    const cases: Array<Partial<BlockingModalState>> = [
      { settingsOpen: true },
      { commandPaletteOpen: true },
      { quickFileOpen: true },
      { workspaceSearchOpen: true },
      { manualReviewModalOpen: true },
      { projectModalProject: "new" },
      { createWorktreeProjectId: "p1" },
      {
        editWorktreeTarget: {
          projectId: "p1",
          worktreePath: "/repo",
          branch: "main",
          isMain: true,
        },
      },
      { launchTarget: { cwd: "/repo" } },
      {
        teardownTarget: {
          projectId: "p1",
          worktreePath: "/repo/wt",
          branch: "feat",
          isMerged: false,
          dirtyCount: 0,
          terminalAddresses: [],
        },
      },
      { diffTarget: { projectId: "p1", worktreePath: "/repo", branch: "main" } },
      {
        markdownViewerTarget: {
          absolutePath: "/repo/README.md",
          relativePath: "README.md",
          projectName: "demo",
          rootPath: "/repo",
        },
      },
      {
        codeViewerTarget: {
          absolutePath: "/repo/a.ts",
          relativePath: "a.ts",
          projectName: "demo",
          rootPath: "/repo",
        },
      },
      {
        reviewPickerTarget: {
          candidate: {
            project_id: "p1",
            project_name: "demo",
            repo_url: "github.com/org/demo",
            worktree_path: "/repo",
            pr_number: 1,
            pr_title: "Test PR",
            pr_url: "https://github.com/org/demo/pull/1",
            head_branch: "feat",
            base_branch: "main",
            head_sha: "abc123",
            author_id: "me",
            is_draft: false,
            created_at_ms: Date.now(),
            already_requested_reviewers: [],
            eligible_for_auto_prompt: true,
            skip_reason: null,
          },
        },
      },
    ];

    for (const patch of cases) {
      expect(hasBlockingModalOpen({ ...emptyState(), ...patch })).toBe(true);
    }
  });
});
