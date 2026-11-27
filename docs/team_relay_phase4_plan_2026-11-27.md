# Phase 4 구현 계획서 — Track B PR 생성 감지 · 리뷰어 2명 선택 UI · 작성자 미니 상태바

> **작성일**: 2026-11-27  
> **기준 스펙**: [pr_auto_review_spec_2026-11-27.md](./pr_auto_review_spec_2026-11-27.md)  
> **선행 커밋**: Phase 1 & 1.5 (`e3d2a2a`), Phase 2 (`daba5df`), Phase 3 (`23234f3`)

---

## 1. 목표 및 완료 기준
작성자 측 End-to-End 루프를 완결하여 **PR 생성 감지(Track B) → 리뷰어 2명 선택 → GHE 할당(`gh pr edit`) + Relay 발송 → 작성자 카드 실시간 미니 상태바(교체/취소 포함)**까지 완결합니다.

- 기존 `jjdr` 회귀 0건 (Team Orchestration OFF 시 오버헤드 0%)
- Track B 3단 검증으로 오탐 0% (`author === 내 GHE ID` + `OPEN` + `!isDraft` + `createdAt <= 15m` + 영속 `prompted_pr_keys`)
- Zero-Blur & 전 파일 900줄 미만 준수

## 2. 변경 범위 요약
- **Backend (`src-tauri/`)**:
  - `src-tauri/src/team/author.rs`: `PromptedPrStore`(`prompted_pr_keys.json`, 500건 상한), `fetch_pr_for_author_review`, `evaluate_track_b_candidate`, `normalize_selected_reviewers`, `assign_pr_reviewers_via_gh` + 단위 테스트
  - `src-tauri/src/team/mod.rs`, `src-tauri/src/commands/team.rs`, `src-tauri/src/lib.rs`: `inspect_pr_for_review_request`, `submit_team_review_request`, `dismiss_pr_review_prompt`, `list_authored_team_reviews`, `cancel_authored_team_review` 커맨드 등록
- **Frontend (`src/`)**:
  - `src/utils/teamReviews.ts` + `src/utils/teamReviews.test.ts`: Track B 프리뷰 시그널 감지, 피어 정렬/주석, 작성자 카드 매칭, 상태 칩 포맷, WS 실시간 불변 패치
  - `src/hooks/useTrackBPrDetector.ts`: 비방해 Track B 감지기 (자동 리뷰 임시 Worktree 제외, 중복 방지)
  - `src/components/team/PrReviewPromptBar.tsx`: PR 생성 감지 하단 중앙 퀵 바
  - `src/components/team/ReviewerPickerModal.tsx`: 리뷰어 2명 선택 / 1명 교체 모달
  - `src/components/team/AuthorReviewStatusBar.tsx`: 작성자 카드 미니 상태바 (`[Replace]` / `[Cancel]` 포함)
  - `src/types/domain.ts`, `src/services/tauriBridge.ts`, `src/store/useAppStore.ts`, `src/store/useUiStore.ts`, `src/hooks/useHerdrSync.ts`, `src/components/board/RadarTile.tsx`, `src/components/zen/ZenHeroCard.tsx`, `src/App.tsx`: 최소 침습 연동

## 3. 검증 계획
- Backend Rust 단위 테스트 (Track B 3단 검증 해피/절망/엣지 + 리뷰어 정규화 + `PromptedPrStore` 500건 캡)
- Frontend Vitest 단위 테스트 (Track B 시그널 오탐 방지 + 피어 우선순위 정렬 + 카드 매칭 + WS 패치)
- `npm run test`, `cargo test --offline --lib`, `npx tauri build --no-bundle -- --offline`, `jjdr.exe` 3초 실기동 생존 검증
- `APP_MAP.md` 업데이트 + `docs/test_results_2026-11-27_team_phase4.txt` 리포트 작성
