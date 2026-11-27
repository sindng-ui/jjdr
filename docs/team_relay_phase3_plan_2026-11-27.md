# Phase 3 구현 계획서: 임시 `자동 리뷰 일꾼` 실행 엔진 + 재부팅 Resume + Zen/MD 뷰어 연동

> **작성일**: 2026-11-27  
> **기반 스펙**: [pr_auto_review_spec_2026-11-27.md](./pr_auto_review_spec_2026-11-27.md)  
> **목표**: Relay에서 `ReviewAssigned`를 수신한 리뷰어 `jjdr`가 **Layer-2 Reject 검사 → 2중 상한(글로벌/프로젝트) + 로컬 FIFO 큐 → `skip_bootstrap` 임시 경량 Worktree 생성(`detached HEAD`) → Fresh AI + Pre-defined 프롬프트 자동 주입 → 한도 초과 Fallback 전환 → `Zen Working` / `Zen Inbox` + `MarkdownViewerModal` 1클릭 열람 → Ack 시 자동 삭제 + PC 재부팅 Resume**까지 완전 자율 루프로 동작하게 만든다.

---

## 1. 백엔드 설계 (`src-tauri/src/team/` + `git/`)

900줄 규칙을 엄격히 지키기 위해 역할을 5개 작은 모듈로 분리한다:

1. **`src-tauri/src/git/worktree.rs` 경량 Detached PR 체크아웃 헬퍼 추가**:
   - `create_detached_pr_worktree(repo_path, pr_number, head_sha, short_id) -> Result<String, String>`:
     - `git fetch origin pull/<N>/head` (또는 fallback `git fetch origin <head_sha>`)
     - 고유 폴더명 `jjdr-rev-pr<N>-<short_id>`로 `git worktree add --detach <dir> FETCH_HEAD` 실행 (`skip_bootstrap: true`, 로컬 브랜치 생성 0개, 충돌 0%).
2. **`src-tauri/src/team/jobs.rs` (영속 로컬 저널 & 2중 캡/FIFO 큐, ~260줄)**:
   - `%APPDATA%/jjdr/auto_review_jobs.json`에 `AutoReviewJob` 목록 영속화:
     - `request_id`, `repo_url`, `project_id`, `project_name`, `pr_number`, `pr_url`, `pr_title`, `base_branch`, `head_branch`, `head_sha`, `author_id`, `worktree_path`, `report_path`, `terminal_address`, `agent_id`, `model`, `phase` (`queued | creating_wt | reviewing | ready_for_ack | cleaning_up | failed`), `fallback_used`, `resume_attempts`, `started_ms`, `updated_ms`.
   - 2중 상한 판정 순수 함수: `can_start_job(jobs, project_id, global_cap, per_project_cap) -> bool` + 다음 FIFO 대기자 선정 `pick_next_queued_job`.
   - 동일 `(repo_url, pr_number)` 구 SHA **Supersede 대상 탐지** 순수 함수.
   - 단위 테스트 포함 (2중 캡, FIFO 순서, Supersede 탐지, 영속화 재로드).
3. **`src-tauri/src/team/reject.rs` (Layer-2 로컬 Reject 판정 & 프롬프트 렌더링, ~240줄)**:
   - `gh pr view <N> --json state,isDraft,labels,baseRefName,headRefName,headRefOid,author` 단발 1회 조회 (사내 `GH_HOST` 자동 주입).
   - 순수 판정 엔진 `evaluate_layer2_reject(settings, project_id, request, pr_meta, queued_count) -> Option<(RejectReason, String)>`:
     - PR `CLOSED` / `MERGED` / `DRAFT`
     - 프로젝트별 비활성 (`reject_disabled_project_ids`)
     - 제외 라벨 (`reject_excluded_labels`, 대소문자 무시)
     - 제외 브랜치 글롭 패턴 (`reject_excluded_branches`, 예: `release/*`)
     - 작성자 화이트리스트/차단 목록 (`reject_allowed_authors` / `reject_blocked_authors`)
     - 로컬 대기열 최대치 초과 (`reject_max_queue_size`)
   - 프롬프트 템플릿 변수 치환 (`render_review_prompt`, `{{pr_number}}`~`{{review_report_path}}`) + 재부팅/Fallback 중복 코멘트 방지 안내 1줄 자동 삽입.
   - AI CLI별 모델 플래그/Resume(`--continue`) `argv` 빌더 (`build_review_agent_argv`).
   - 한도 초과 에러 감지 순수 함수 (`detect_quota_exhausted_in_lines`: `429`, `rate limit`, `quota exceeded`, `usage limit`, `credit balance` 등).
   - 단위 테스트 포함 (모든 Layer-2 Reject 케이스, 글롭 매칭, 프롬프트 치환, `--model`/`--continue` argv, 한도 초과 패턴).
4. **`src-tauri/src/team/orchestrator.rs` (`AutoReviewOrchestrator`, ~480줄)**:
   - `TeamRelayRuntime`의 `ReviewAssigned` 및 `ReviewCancelled` 내부 훅과 직결:
     - **수신 파이프라인 (`handle_incoming_review`)**:
       1. 로컬 프로젝트 `origin` URL 매칭 실패 시 `Rejected(RepoNotRegistered)` 회신.
       2. Layer-2 Reject 평가 → 거절 시 `rest_report_status(Rejected)` 회신.
       3. 동일 `(repo_url, pr_number)` 구 SHA가 `queued/reviewing`이면 **Supersede 중단**(`kill_terminal` + `remove_worktree`).
       4. `auto_review_paused`이거나 2중 캡 도달 시 `queued` 저장 + Relay에 `Queued` 보고.
       5. 여유 있으면 즉시 `launch_job()`:
          - `create_detached_pr_worktree` → `worktreeMeta`에 `{ mission_kind: "review", pr_number, pr_url, display_name: "PR #<N> · <제목>", note: "Auto-Review · by @<author>" }` 저장 → `jjdr:worktree-meta-updated` 발행 → `Zen Working` 즉시 합류!
          - Fresh AI 세션 기동(`herdr` `terminal.run` + `jjdr.role: "auto_review"`, `jjdr.request_id` 라벨 + `initial_prompt` 또는 준비 대기 후 주입).
          - Relay에 `Reviewing(worker_agent)` 보고.
     - **백그라운드 감시 루프 (2초 주기, 활성 Job 존재 시만 동작 — 0 job 시 CPU 0%)**:
       - `TerminalStateHub` 스냅샷으로 실행 중인 `auto_review` 세션 상태/프리뷰 감시:
         - **한도 초과 감지 시**: `fallback_used == false && !fallback_agent.is_empty()`이면 현재 세션 종료 → Worktree `git checkout -- .` → **2순위 Fallback AI로 1회 자동 롤백/재기동**! 폴백도 실패/미설정 시 `Failed(QuotaExhausted)` 보고.
         - **`working → done` 전환 감지 시**: 터미널 끝줄 치명적 `gh` 인증 오류 체크 → 정상이면 `phase: ready_for_ack`, Relay에 `Completed` 보고 (`ack_teardown_mode == "immediate"`면 즉시 정리, 기본 `"on_ack"`면 Zen Inbox에서 Ack 대기) → 대기 중인 다음 FIFO 큐 자동 출동!
     - **Ack / 수동 취소 / 자동 삭제 (`ack_review_job`, `cancel_local_job`)**:
       - 리뷰어가 Zen Inbox에서 도장(`Ack`) 찍으면 `phase: cleaning_up` → AI 세션 종료 + 기존 비동기 `remove_worktree`(O(1) Rename-then-Prune) 삭제 → `auto_review_jobs.json`에서 제거 → 다음 FIFO 큐 자동 출동!
     - **PC 재부팅 Resume & 고아 청소기 (`reconcile_on_startup`, 부팅 8초 웜업 후 1회 실행)**:
       - `auto_review_jobs.json` + Relay `rest_sync_active` + `herdr-core` 라이브 세션 3자 대조:
         - Case 1 (세션 생존): Re-attach 유지
         - Case 2 (`.jjdr-review/pr-<N>.md` 이미 유효): AI 재실행 없이 즉시 `ready_for_ack` + `Completed` 보고
         - Case 3 (`reviewing` 중단 + `should_abort == false` + `resume_attempts < 2`): `claude/agy`는 `--continue` + 이어하기 프롬프트, `gemini/codex`는 Fresh + 중복 코멘트 확인 문구로 자동 Resume + Relay에 `Reviewing (resumed after reboot)` 보고
         - Case 4 (`creating_wt` / 폴더 손상): 정리 후 경량 Worktree 재생성
         - Case 5 (`ready_for_ack`): 절대 삭제 금지, Zen Inbox 복원
         - Case 6 (`cleaning_up` / Relay `should_abort == true` / 저널·Relay 없는 진짜 미아 `jjdr-rev-pr*` 폴더): 백그라운드 자동 삭제!
5. **`src-tauri/src/commands/team.rs` 커맨드 확장**:
   - `list_auto_review_jobs`, `ack_auto_review_job`, `cancel_auto_review_job`, `retry_auto_review_job`.

---

## 2. 프론트엔드 연동 (`src/`)

- **`src/types/domain.ts` & `src/services/tauriBridge.ts`**: `AutoReviewJob` 타입, `listAutoReviewJobs`, `ackAutoReviewJob`, `cancelAutoReviewJob`, `listenAutoReviewJobsChanged` 추가.
- **`src/store/useAppStore.ts` & `src/hooks/useHerdrSync.ts`**:
  - `autoReviewJobsByWorktree: Record<string, AutoReviewJob>` 추가 (Atomic selector, Worktree 경로 기준 O(1) 조회!).
  - `jjdr:auto-review-jobs-changed` 이벤트 구독 + 백엔드가 새 리뷰 Worktree를 생성/삭제할 때 `worktreesByProject` 및 `worktreeMeta` 자동 리프레시!
- **`ZenHeroCard.tsx` & `ZenModeView.tsx` & `ZenRunningMissionCard.tsx`**:
  - **Zen Working (`ZenRunningMissionCard`)**: 자동 리뷰 일꾼에 `AUTO-REVIEW` 칩 표시 + `Cancel` 단축 액션(선택).
  - **Zen Inbox (`ZenHeroCard`)**: 해당 Worktree에 연결된 `AutoReviewJob`이 있으면:
    - **`[Review MD]` 1클릭 버튼** 노출 → 클릭 시 기존 내장 **`MarkdownViewerModal`** (`useUiStore.getState().openCodeViewer({ path: job.report_path, title: ... })`)로 `.jjdr-review/pr-<N>.md` 즉시 열람! (파일 미생성 시 토스트 안내 + 터미널에서 바로 확인)
    - 기존 `PR #N` 배지 클릭으로 사내 GHE PR 페이지 즉시 열기!
  - **Zen 도장(`Ack`) 연동 (`ZenModeView.tsx`)**: 리뷰어가 Zen Inbox에서 자동 리뷰 카드를 Ack(도장 쾅)하면 백엔드 `ackAutoReviewJob(request_id)` 호출 → 임시 Worktree 백그라운드 자동 삭제!

---

## 3. 검증 계획 (Happy + 절망/재부팅/Fallback 패스)
1. **Rust 단위 테스트 (`cargo test --offline --lib --manifest-path src-tauri/Cargo.toml`)**:
   - `team::jobs`: 2중 하드 캡(글로벌/프로젝트), FIFO 큐 순서, 동일 PR 구 SHA Supersede 탐지, 저널 영속화 재로드
   - `team::reject`: Layer-2 Reject 전 케이스(`CLOSED/MERGED/DRAFT`, 라벨, 브랜치 글롭, 작성자 화이트/블랙리스트, 프로젝트 비활성, 대기열 초과), 프롬프트 변수 치환, `--model`/`--continue` CLI argv 빌드, 429/한도 초과 감지 패턴
2. **프론트엔드 테스트 & 빌드 (`npm run test` + `npm run build`)**
3. **정식 Tauri 번들 빌드 & 실행 생존 검증 (`npx tauri build --no-bundle -- --offline`)**
4. **결과 저장 (`docs/test_results_2026-11-27_team_phase3.txt`) 및 `APP_MAP.md` 업데이트**
