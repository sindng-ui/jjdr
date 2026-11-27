import { describe, expect, it } from "vitest";
import {
  mergeAutoMission,
  parseMissionFromBranch,
  parseMissionFromText,
  resolveEffectiveMission,
} from "./missionDetector";

describe("parseMissionFromText", () => {
  it("extracts review kind and PR number from Korean prompt", () => {
    expect(parseMissionFromText("pr 114 리뷰해줘")).toEqual({
      kind: "review",
      prNumber: 114,
      prUrl: null,
    });
    expect(parseMissionFromText("114번 PR 코드리뷰 부탁해")).toEqual({
      kind: "review",
      prNumber: 114,
      prUrl: null,
    });
  });

  it("extracts PR URL and number from GitHub and GitLab links", () => {
    const gh = parseMissionFromText(
      "https://github.com/sindng-ui/jjdr/pull/245 리뷰해줘"
    );
    expect(gh.kind).toBe("review");
    expect(gh.prNumber).toBe(245);
    expect(gh.prUrl).toBe("https://github.com/sindng-ui/jjdr/pull/245");

    const gl = parseMissionFromText(
      "Check https://gitlab.corp.local/team/app/-/merge_requests/88"
    );
    expect(gl.prNumber).toBe(88);
    expect(gl.prUrl).toBe(
      "https://gitlab.corp.local/team/app/-/merge_requests/88"
    );
  });

  it("extracts PR number from gh CLI commands in AI terminal output", () => {
    expect(parseMissionFromText("Running: gh pr view 114 --comments")).toEqual({
      kind: "review",
      prNumber: 114,
      prUrl: null,
    });
    expect(parseMissionFromText("$ gh pr diff #302")).toEqual({
      kind: "review",
      prNumber: 302,
      prUrl: null,
    });
  });

  it("classifies fix, dev, refactor prompts accurately and prefers review over fix", () => {
    expect(parseMissionFromText("로그인 크래시 버그 수정해줘").kind).toBe("fix");
    expect(parseMissionFromText("결제 API 신규 기능 구현해줘").kind).toBe("dev");
    expect(parseMissionFromText("워커 구조 리팩토링 및 최적화").kind).toBe(
      "refactor"
    );
    expect(parseMissionFromText("PR #51 버그 수정 내용 리뷰해줘")).toEqual({
      kind: "review",
      prNumber: 51,
      prUrl: null,
    });
  });

  it("avoids false positives on plain hex colors or numbered lists without PR context", () => {
    expect(parseMissionFromText("배경색 #123456 으로 바꿔줘").prNumber).toBeNull();
    expect(parseMissionFromText("#1 버튼 위치만 조금 올려줘").prNumber).toBeNull();
  });
});

describe("parseMissionFromBranch", () => {
  it("infers kind and PR number from common branch names", () => {
    expect(parseMissionFromBranch("fix/login-crash")).toEqual({
      kind: "fix",
      prNumber: null,
      prUrl: null,
    });
    expect(parseMissionFromBranch("feat/oauth")).toEqual({
      kind: "dev",
      prNumber: null,
      prUrl: null,
    });
    expect(parseMissionFromBranch("review/pr-114")).toEqual({
      kind: "review",
      prNumber: 114,
      prUrl: null,
    });
  });
});

describe("mergeAutoMission & resolveEffectiveMission", () => {
  it("enriches prompt mission with PR URL discovered later in AI preview output", () => {
    const afterPrompt = mergeAutoMission(
      undefined,
      parseMissionFromText("올라온 PR 리뷰해줘"),
      "prompt",
      1000
    );
    expect(afterPrompt?.kind).toBe("review");
    expect(afterPrompt?.prNumber).toBeNull();

    const afterPreview = mergeAutoMission(
      afterPrompt ?? undefined,
      parseMissionFromText("Fetching https://github.com/acme/repo/pull/114"),
      "preview",
      2000
    );
    expect(afterPreview?.kind).toBe("review");
    expect(afterPreview?.prNumber).toBe(114);
    expect(afterPreview?.prUrl).toBe("https://github.com/acme/repo/pull/114");
  });

  it("clears stale PR number when a brand-new unrelated prompt is submitted", () => {
    const prev = {
      kind: "review" as const,
      prNumber: 114,
      prUrl: "https://github.com/acme/repo/pull/114",
      source: "prompt" as const,
      updatedAt: 1000,
    };
    const next = mergeAutoMission(
      prev,
      parseMissionFromText("새 다크모드 기능 구현해줘"),
      "prompt",
      3000
    );
    expect(next?.kind).toBe("dev");
    expect(next?.prNumber).toBeNull();
    expect(next?.prUrl).toBeNull();
  });

  it("prioritizes manual override over auto detection while keeping auto fallback for unset fields", () => {
    const autoInfo = {
      kind: "dev" as const,
      prNumber: 114,
      prUrl: "https://github.com/acme/repo/pull/114",
      source: "prompt" as const,
      updatedAt: 1000,
    };
    const resolved = resolveEffectiveMission(
      { mission_kind: "review" },
      autoInfo,
      { branch: "feat/something" }
    );
    expect(resolved.kind).toBe("review");
    expect(resolved.isAutoKind).toBe(false);
    expect(resolved.prNumber).toBe(114);
    expect(resolved.isAutoPr).toBe(true);
    expect(resolved.prUrl).toBe("https://github.com/acme/repo/pull/114");
  });
});
