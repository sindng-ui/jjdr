# Zen 모드 Daily Work Recap & Standup Markdown 복사 구현 계획서

> **작성일**: 2026-11-25  
> **대상 워크스페이스**: `k:\Antigravity_Projects\gitbase\jjdr`

## 1. 목표
- 평소 Zen 화면의 시각적 노이즈를 0으로 유지하면서, 기존 `{N} Cleared Today` 뱃지 및 All Clear `Cleared Today` 타일 클릭 시 **오늘/어제(최근 7일) 작업 리캡 모달**을 제공한다.
- 각 몬스터 일꾼(Worktree)별로 클리어 횟수, 출동 횟수, Diff, 병합 상태, 마지막 요약을 자동 누적하고, **1클릭 Markdown 복사 (`Standup` / `Compact` 2종 포맷)** 를 지원한다.

## 2. 모듈 설계
- 신규:
  - `src/utils/zenRecap.ts`: `localStorage` 7일 롤링 저장소, 이벤트 기록(`recordZenRecapEvent`), 라이브 워크트리 통계 병합(`enrichRecapEntries`), MVP 계산(`pickDailyMvp`), Markdown 포맷터(`buildDailyRecapMarkdown`).
  - `src/utils/zenRecap.test.ts`: 기록 누적, 7일 프루닝, MVP 선정, Standup/Compact Markdown 생성 Vitest 단위 테스트.
  - `src/components/zen/ZenRecapModal.tsx`: 100% 영문 Zero-Blur 모달 (`Today`/`Yesterday`/최근 날짜 전환, 요약 메트릭 + MVP 몬스터, 프로젝트별 작업 리스트, `Standup`/`Compact` 포맷 전환 + 1클릭 `Copy Markdown`, `Esc` 닫기).
- 수정:
  - `src/components/zen/ZenModeView.tsx`: 결재/자동 해결 시 리캡 이벤트 기록, `{N} Cleared Today` 버튼화 및 `ZenRecapModal` 마운트.
  - `src/components/zen/ZenDispatchView.tsx`: 출동 완료 시 `dispatched` 리캡 이벤트 기록.
  - `src/components/zen/ZenEmptyBriefing.tsx`: `Cleared Today` 타일 클릭으로 리캡 열기 연결.
  - `APP_MAP.md`: 신규/수정 인터페이스 반영.
