# jjdr 팀 자동 PR 리뷰 스펙 (PR Auto-Review Orchestration)

> **작성일**: 2026-11-27  
> **상위 비전 문서**: [team_orchestration_ideas_2026-11-27.md](./team_orchestration_ideas_2026-11-27.md)  
> **목표**: `jjdr` 사용자 간 **PR 생성 감지(Track B) → 리뷰어 2명 지정 → Relay 기반 리뷰 요청 → 자동 리뷰 일꾼 배차 → Pre-defined 프롬프트 실행 → Zen Working/Inbox & Markdown 뷰어 열람**까지의 최소·완결 협업 루프 확정.

---

## 1. 전체 End-to-End 시나리오

```text
[작성자 jjdr]                                 [jjdr-relay (Windows 공용 PC)]                 [리뷰어 jjdr (x2)]
1. 일꾼이 터미널에서 PR 생성 (Track B 감지)
2. 리뷰어 2명 선택 (온라인/레포 보유 표시)
   └─ gh pr edit --add-reviewer (GHE 등록)
   └─ Relay로 review_request 발송 ──────────▶ 3. Layer-1 검증 (인증/중복/Pause/레포/TTL)
                                                 └─ SQLite 영속화 & WebSocket 즉시 푸시 ────▶ 4. Layer-2 로컬 Reject 평가
                                                                                                 └─ 통과 시 accepted/queued 회신
6. 작성자 카드 하단 미니 상태바 실시간 갱신 ◀── 5. 상태 이벤트 중계 (queued→reviewing→done) ◀─── 5. 임시 자동 리뷰 일꾼 생성 (상한 내)
   (@A: Reviewing / @B: Posted)                                                                  └─ skip_bootstrap 경량 Worktree (--detach)
                                                                                                 └─ Fresh AI 세션 + Pre-defined 프롬프트 주입
                                                                                                    (한도 초과 시 Fallback AI로 자동 롤백/전환)
                                                                                                 └─ 리뷰어 Zen Working 카드로 자동 편입
                                                                                              6. AI가 GHE PR 코멘트 등록 + `.jjdr-review/pr-<N>.md` 저장
                                                                                              7. 리뷰어 Zen Inbox 상정 → 내장 MarkdownViewerModal 1클릭 열람
                                                                                              8. Ack/완료 후 Worktree 자동 삭제 (디스크 점유 0)
```

---

## 2. 전략적 역할 분담: `jjdr` vs `jjdr-relay`

**"Smart Edge (`jjdr`), Dumb-but-Reliable Hub (`jjdr-relay`)"** 원칙을 따른다.  
공용 PC(`jjdr-relay`)에는 Git/GHE 토큰이나 AI API 키를 절대 두지 않으며, 오직 경량 중계·우체통·상태 동기화만 담당한다.

| 영역 | `jjdr-relay` (Windows 공용 PC 단일 바이너리 + SQLite) | `jjdr` 클라이언트 (각 개발자 PC) |
| :--- | :--- | :--- |
| **핵심 철학** | Zero-Git, Zero-AI, 초경량(~20MB RAM), 무상태에 가까운 우체국 + 전화번호부 | Git, `gh` CLI, Worktree, AI CLI, 로컬 정책의 모든 실행 주권 보유 |
| **디렉토리 / Presence** | 접속 유저(`github_id`, `display_name`, `status: online/paused/offline`, 보유 `repo_url` 해시 목록) 관리 및 브로드캐스트 | 앱 시작 시 로컬 `gh api user`로 본인 사내 GHE ID 확인 후 Relay에 등록, 등록 프로젝트의 정규화 `repo_url` 목록 동기화 |
| **메시지 중계 & 보관** | 리뷰 요청 영속화(SQLite), 온라인 즉시 푸시(WebSocket), 오프라인 Store-and-Forward(TTL 48~72h), `cancel` 시 미배달 큐 즉시 취소 | Track B PR 감지 → 리뷰어 2명 선택 → `gh pr edit` + Relay 발송; 수신 시 로컬 FIFO 큐/배차 실행 |
| **상태 추적** | `(request_id, reviewer_id)`별 상태 머신 저장 및 작성자 실시간 푸시 (`sent` → `delivered` → `queued` → `reviewing` → `completed` / `rejected` / `failed` / `cancelled`) | 작업 단계 변화 시 Relay로 경량 상태 패킷 전송; 작성자 카드 하단 **미니 상태바** 렌더링 |
| **사내 GHE 연동** | **0% (GHE 호출·폴링 전면 금지)** | 필요 시점에만 단발성 `gh` CLI 실행 (`gh pr view` 검증 1회, `gh pr edit --add-reviewer`, AI 프롬프트 내 코멘트 등록) |
| **보안 / 접근제어** | `TEAM_KEY` 검증, 스키마 검증, 스팸 Rate Limit | 신뢰 작성자/팀원 화이트리스트, 로컬 Reject 규칙, AI/토큰 주권 통제 |

### Windows 공용 PC 배포 형태 & 레포지토리 구조
- **모노레포 독립 서브프로젝트 구조** (기존 `src-tauri` 빌드·CI 100% 무충돌):
  - `crates/relay-protocol/`: `src-tauri`와 `relay`가 `path` 의존성으로 공유하는 순수 `serde` 프로토콜·정규화 크레이트.
  - `relay/`: 독립 Rust 바이너리 프로젝트 (`cargo build --release --manifest-path relay/Cargo.toml` → `jjdr-relay.exe`).
- **단일 실행 파일**: `jjdr-relay.exe` (Rust `axum` + `tokio` + `rusqlite(bundled)` — Windows 공용 PC에 별도 런타임/DLL 설치 불필요).
- **데이터 저장**: 실행 폴더 옆 `jjdr-relay.db` (SQLite WAL + `synchronous = FULL`, 정전 시 커밋 무손실 보장) 1파일.
- **전달 신뢰성 (At-Least-Once & 다중 기기 방어)**:
  - **서버 주도 WS Heartbeat**: 30초 Ping / 60초 미응답 시 Half-Open(절전) 좀비 소켓 자동 강제 종료 및 `Offline` 전환.
  - **명시적 수신 ACK (`AckDelivery`)**: 온라인 전송 시 `Dispatched`로 기록하고, 리뷰어 `jjdr`가 실제 수신 ACK를 회신할 때 `Delivered` 확정. 미ACK 상태로 끊기면 재접속 시 자동 재전달.
  - **다중 기기 이중 실행 차단 (`device_id`)**: `ReviewAssigned`는 동일 유저의 최신 Primary 소켓 1개에만 전송하고, DB `claimed_by_device_id`로 원자적 선점(타 기기 중복 보고 시 `409 Conflict`).
  - **오프라인 취소 동기화 (`sync-active`)**: 재접속/Resume 시 로컬 활성 `request_id` 목록을 Relay와 1회 대조해 오프라인 중 취소·만료된 작업을 즉시 중단.
- **클라이언트 네트워크/내구성**:
  - Relay 클라이언트는 사내 프록시 간섭 방지를 위해 **`no_proxy()` 기본 적용**.
  - 리뷰어 로컬에도 영속 **`relay_outbox.json`**을 두어, Relay 일시 다운 중 발생한 `Completed / Rejected / Failed` 보고를 재연결 즉시 재전송(`404/409`는 영구 폐기).
- **운영 편의**: Windows 작업 스케줄러(로그온 시 자동 시작) 또는 Windows Service로 백그라운드 상주, 포트 1개만 사내 방화벽 인바운드 허용.
- **장애 격리**: Relay가 일시 다운되어도 `jjdr`의 기존 로컬 기능과 `gh pr edit`은 100% 정상 동작하며, 전송 실패 건은 로컬 아웃박스에서 재시도 가능.

---

## 3. 리뷰 요청 Reject 전략 (2계층 하이브리드)

Reject 판단을 한쪽에 몰지 않고, **속도·네트워크 효율이 좋은 1차 컷은 Relay**, **로컬 Git·개인 정책 판단은 리뷰어 `jjdr`**로 분리한다.

### Layer 1 · Relay 서버 사전 컷 (Fast-Fail & 선택창 사전 안내)
서버가 이미 들고 있는 경량 메타데이터만으로 불필요한 전송 자체를 막는다.

| 조건 코드 | 판정 기준 | 동작 |
| :--- | :--- | :--- |
| `duplicate_sha` | 동일한 `(repo_url, pr_number, head_sha, reviewer_id)` 요청이 이미 `queued`/`reviewing`/`completed` | 중복 생성 차단 및 기존 상태 반환 |
| `reviewer_paused` | 리뷰어가 `Auto-Review`를 `PAUSED` 또는 `DND`로 설정해 Relay에 동기화됨 | 작성자 선택창에 `⏸ 일시정지` 표시; 강제 발송 시 즉시 `rejected(paused)` |
| `repo_not_registered` | 리뷰어 클라이언트가 해당 정규화 `repo_url`을 등록 프로젝트에 미보유 | 작성자 선택창에서 해당 레포 보유 팀원 우선 정렬; 미보유자 지정 시 경고/즉시 거절 |
| `expired_ttl` | 오프라인 보관 시간(기본 48시간) 초과 | 리뷰어 재접속 시 낡은 PR 실행 없이 자동 만료 처리 |

### Layer 2 · 리뷰어 `jjdr` 로컬 Reject (최종 주권)
리뷰어 PC가 요청을 수신한 뒤 Settings의 Reject 조건과 실시간 상태를 평가해, 거절 시 `rejected(reason_code, detail)`를 Relay에 즉시 회신한다(작성자 미니 상태바에 사유 표시).

| 설정 가능한 Reject 조건 | 설명 | 기본값 |
| :--- | :--- | :--- |
| **PR 무효 상태** (`pr_closed` / `pr_merged` / `pr_draft`) | 실행 직전 `gh pr view` 1회 조회 시 Closed / Merged / Draft 상태 | **항상 ON** |
| **제외 라벨 필터** (`excluded_labels`) | PR에 지정 라벨 포함 시 자동 리뷰 거절 (예: `wip`, `no-ai-review`, `chore`) | `wip, no-ai-review` |
| **제외 브랜치 패턴** (`excluded_branches`) | `head_branch` 또는 `base_branch`가 제외 패턴 매칭 시 거절 | 비어 있음 |
| **특정 프로젝트 자동 리뷰 비활성** | 리뷰어 로컬에서 특정 프로젝트만 자동 리뷰 수신 OFF | 프로젝트별 ON |
| **작성자 화이트리스트/차단 목록** | 신뢰 팀원 외 외부 작성자 또는 특정 발신자 거절 | 동일 GHE Org/팀원 허용 |
| **로컬 대기열 상한 초과** (`queue_full`) | 대기열 최대치(예: 5건) 초과 시 추가 요청 거절 | 최대 5건 초과 시 Reject |
| **환경/인증 불가** (`gh_auth_error` / `quota_exhausted`) | `gh` 인증 만료, 레포 접근 불가, 1순위+Fallback AI 모두 한도 초과 | 자동 Reject + 로컬 알림 |
| **수동 거절** (`user_declined`) | 리뷰어가 대기열 또는 Zen Working에서 직접 거절/취소 클릭 | 수동 액션 |

---

## 4. `자동 리뷰 일꾼` 타입 & 단일 임시 슬롯(Ephemeral) 경제성 모델

일반 개발 일꾼(`dev`) 및 `ROOT`와 완전히 분리된 전용 타입 **`자동 리뷰 일꾼` (`worker_role: "auto_review"`, `ephemeral: true`)**을 **100% 임시 슬롯으로 일원화**한다.  
팀원에게 *"미리 리뷰 일꾼 만들어 두세요"* 같은 사전 세팅 약속이 전혀 필요 없으며, 생성→리뷰→삭제 단일 라이프사이클로 오염과 증식을 원천 차단한다.

### 핵심 원칙
1. **Zero-Setup 일원화**: 사전 고정 슬롯 개념을 두지 않는다. 리뷰 요청이 오면 `skip_bootstrap: true` 경량 Worktree를 즉시 생성한다.
2. **절대 증식 금지 (2중 하드 캡 + Auto-Teardown)**:
   - **글로벌 동시 상한(`global_max_auto_review_workers`, 기본 `2`)** + **프로젝트별 상한(`per_project_max`, 기본 `1`, 최대 `3`)** 2중 캡을 강제한다.
   - 상한 도달 시 신규 생성을 금지하고 **로컬 FIFO 큐**에서 대기시켰다가, 기존 리뷰가 끝나고 삭제되면 즉시 다음 PR을 생성·실행한다.
   - `PAUSE` 전환 시 신규 수신 차단 + 로컬 큐 출동 일시정지, 이미 실행 중인 리뷰는 토큰 낭비 방지를 위해 완료까지 유지한다.
3. **세션·파일 오염 0% & 경로 충돌 방지**: 매 PR마다 고유 폴더명(`jjdr-rev-pr<N>-<short_id>`)으로 새 경량 Worktree(`git fetch` → `checkout --detach FETCH_HEAD`) + **Fresh AI 세션**으로 실행한다.
4. **동일 PR 구 커밋 Supersede**: 동일 `(repo_url, pr_number)`에 더 최신 `head_sha` 요청이 도착하면, 구 SHA 대기/실행 건은 자동 중단(`kill`) 후 최신 SHA로 교체한다.
5. **일반 일꾼 완벽 격리**: 일반 `dev` Worktree 및 `ROOT` Worktree는 자동 리뷰에 **절대 건드리지 않는다**.

### 단일 라이프사이클 (Create → Review → Teardown)

```text
[요청 수신 & Reject 통과]
   └─ 글로벌/프로젝트 동시 상한 여유 있음?
        ├─ NO  → 로컬 FIFO 큐 대기 (Relay 상태: queued)
        └─ YES → 1. 경량 Worktree 즉시 생성 (skip_bootstrap: true, detached HEAD, jjdr-rev-pr<N>-<short_id>)
                 2. 로컬 저널(auto_review_jobs.json)에 체크포인트 기록 (phase: reviewing)
                 3. Fresh AI 세션 기동 (리뷰어 지정 AI/모델) + Pre-defined 프롬프트 주입 (Relay 상태: reviewing)
                 4. 리뷰어 Zen Working 카드 편입 → 완료 시 Zen Inbox 상정 (phase: ready_for_ack, Relay 상태: completed)
                 5. 리뷰어가 Zen에서 MD 열람 & Ack(도장) 완료 (phase: cleaning_up)
                    └─ AI 세션 종료 + 기존 비동기 teardown_worktree로 백그라운드 자동 삭제 (디스크 점유 0)
```

### PC 재부팅 Resume & 안전한 고아 청소 (Crash Recovery)
리뷰 도중 PC 재부팅·강제 종료가 발생해도 작업이 유실되거나 좀비로 남지 않도록, 부팅 후 **8초 웜업 딜레이** 뒤 `auto_review_jobs.json` + Relay `sync-active`/`inbox` + `herdr-core` 라이브 세션을 **3자 대조(Reconcile)**한다:
1. **`herdr-core`에 세션 생존** (`jjdr` 앱만 재실행): 재기동 없이 기존 세션에 Re-attach (`Zen Working` 복원).
2. **재부팅 직전 이미 완료됨** (`.jjdr-review/pr-<N>.md` 유효): AI 재실행 금지 → 즉시 `Zen Inbox` 상정 + Relay `Completed` 보고.
3. **리뷰 도중 PC 재부팅으로 중단됨 (`phase === "reviewing"`, Worktree 생존)**:
   - Relay `sync-active`로 취소 여부 + `gh pr view`로 `OPEN` 여부 + `resume_attempts < 2` 확인.
   - `claude` / `agy`: 동일 Worktree에서 `--continue`로 맥락 유지 재기동 + 중복 코멘트 방지 이어하기 프롬프트 주입.
   - `gemini` / `codex` (또는 `--continue` 실패 시): 동일 Worktree에서 Fresh 재기동 + 중복 코멘트 사전 확인 문구 1줄 추가.
   - Relay에 `Reviewing (resumed after reboot)` 재보고 → 작성자 미니 상태바 실시간 갱신.
4. **Worktree 생성 중 끊김 (`phase === "creating_wt"` 또는 폴더 손상)**: 잔여 폴더 정리 후 깨끗한 경량 Worktree 재생성.
5. **Ack 대기 중 재부팅 (`phase === "ready_for_ack"`)**: **절대 삭제하지 않고 `Zen Inbox` 복원**.
6. **진짜 고아만 자동 삭제**: `phase === "cleaning_up"`, Relay에서 `Cancelled/Expired` 확인, 또는 저널·Relay 양쪽 모두에 없는 임시 리뷰 Worktree만 백그라운드 자동 삭제.

---

## 5. AI / 모델 선택 & 한도 초과 감지·폴백(Fallback)

- **리뷰어 전용 AI/모델 설정**: 평소 개발용 `project.default_agent`와 독립적으로, 자동 리뷰 일꾼이 사용할 **1순위 AI CLI + 모델**(`agy` / `claude` / `gemini` / `codex` + 선택적 `--model` 플래그)을 리뷰어 Settings에서 지정한다. (미지정 시 `project.default_agent` 상속)
- **한도 초과 감지 & 자동 폴백 (유일한 토큰 가드레일)**:
  - 실행 중인 자동 리뷰 일꾼의 터미널 출력/상태에서 Rate Limit / Quota Exhausted 패턴(`429`, `rate limit`, `quota exceeded`, `usage limit`, `credit balance` 등)을 감지한다.
  - **폴백 AI가 설정된 경우**: 현재 AI 세션을 안전 종료(롤백)하고 Worktree `git checkout -- .` 1회 정리 후, **2순위 Fallback AI/모델로 Fresh 세션을 즉시 재기동**해 *"이전 세션 한도 초과 복구이므로 중복 코멘트 확인 후 진행"* 1줄을 붙여 1회 재시도한다. (무한 루프 방지를 위해 폴백은 최대 1회)
  - **폴백 AI 미설정 또는 폴백도 한도 초과 시**: 재시도를 멈추고 `failed(quota_exhausted)`로 종료, 리뷰어 Zen 알림 + 작성자 미니 상태바에 `"AI 한도 초과"` 표시.

---

## 6. Pre-defined 프롬프트, 코멘트 등록 & 결과 열람 UX

### 프롬프트 & 코멘트 등록
- **코멘트 등록은 AI 프롬프트에 위임**: `jjdr`가 별도로 `gh pr comment`를 호출하지 않는다. Pre-defined 프롬프트(또는 리뷰어가 지정한 리뷰 스킬, 예: `$pr-review`)가 리뷰 수행과 GHE PR 코멘트 등록까지 완결한다.
- **지원 템플릿 변수**:
  - `{{pr_number}}`, `{{pr_url}}`, `{{pr_title}}`, `{{repo_name}}`, `{{base_branch}}`, `{{head_branch}}`, `{{head_sha}}`, `{{author}}`, `{{review_report_path}}`
- **내장 `MarkdownViewerModal` 연계**:
  - 기본 Pre-defined 프롬프트에 *"최종 리뷰 전문을 `{{review_report_path}}` (`.jjdr-review/pr-<N>.md`)에도 저장하라"* 지침을 포함.
  - 리뷰 완료 후 리뷰어 `Zen Inbox` 카드(`ZenHeroCard`) 및 완료 카드에 **`[View Review MD]` 1클릭 버튼**을 노출해, 이미 구현된 `MarkdownViewerModal`로 깔끔하게 리뷰 결과를 열람할 수 있다. (파일이 미생성된 커스텀 스킬의 경우 터미널 보기 폴백)
- **안전한 프롬프트 주입**:
  - AI CLI 기동 후 `isTrustOrSetupPrompt`([zenDispatch.ts](file:///k:/Antigravity_Projects/gitbase/jjdr/src/utils/zenDispatch.ts)) 및 `herdr-core` `idle` 준비 상태를 확인한 직후 프롬프트를 주입해 부팅 중 입력 유실을 방지한다.

### Zen Working / Inbox & 작성자 미니 상태바
- **리뷰어 측**:
  - 자동 리뷰 시작 즉시 해당 `auto_review` 일꾼의 메타에 `mission_kind: "review"`, `pr_number`, `pr_url`, `display_name: "PR #412 · <제목>"`, `note: "by @작성자"`를 자동 주입 → **즉시 `Zen Working` (`ZenRunningMissionCard`)**에 합류.
  - 완료 시 기존 `Zen Inbox` 흐름으로 자연스럽게 상정 → 리뷰어가 `MarkdownViewerModal`로 결과 확인 후 도장(`Ack`) 찍으면 임시 리뷰 Worktree 자동 삭제 트리거.
- **작성자 측**:
  - PR을 생성한 Worktree 카드 및 Zen 카드 하단에 리뷰어 2명의 **미니 상태바** 표시:
    - 예: `@minsu ● Reviewing` | `@younghee ✓ Posted` (또는 `⏸ Paused` / `✕ Rejected: wip` / `○ Offline(Queued)`)
  - 오프라인·거절된 리뷰어 슬롯에는 원클릭 **`[교체]` / `[취소]`** 액션 제공.

---

## 7. Track B (PR 생성 감지) 정밀 조건

남의 PR을 조회(`gh pr view`)할 때 오탐이 발생하지 않도록 아래 3단 검증을 통과할 때만 **"리뷰어 2명 지정"** 퀵 바를 띄운다:
1. 터미널 출력/입력에서 `gh pr create` 완료 및 사내 GHE PR URL 패턴 감지.
2. `gh pr view <N> --json author,isDraft,state,createdAt,headRefOid,title,baseRefName,headRefName` 단발 1회 조회:
   - `author === 내 GHE ID`
   - `state === "OPEN"`
   - `isDraft === false` (Draft면 자동 팝업 생략, 카드에 수동 `[Request Review]` 버튼만 표시)
   - `createdAt`이 **최근 15분 이내** (재실행 시 터미널 스크롤백의 과거 PR URL 오탐 차단)
3. 아직 영속 `prompted_pr_keys` 및 해당 `(repo, pr_number, head_sha)`로 리뷰 요청을 발송하지 않은 상태.

---

## 8. Settings UI 개선 & `Team Orchestration` 신설

현재 [SettingsModal.tsx](file:///k:/Antigravity_Projects/gitbase/jjdr/src/components/modals/SettingsModal.tsx)는 이미 **808줄**로 900줄 상한에 근접해 있으며 단일 세로 스크롤 폭이 좁아 신규 팀 설정을 수용하기 어렵다.

### UI/구조 개선 계획
1. **모달 폭 확장 & 좌측 카테고리 탭 전환**:
   - 모달 최대 폭을 넓게 확장 (예: `max-w-4xl` / `880~920px`, 반응형 `w-[92vw]`).
   - 좌측 슬림 사이드바 탭 도입: `General` / `Appearance` / `Prompts & Bridges` / **`Team Orchestration`** / `Updates`.
2. **컴포넌트 모듈 분리 (900줄 방지)**:
   - 신규 섹션을 `src/components/modals/TeamOrchestrationSettingsSection.tsx` (필요 시 하위 서브 컴포넌트 분리)로 독립 작성.
3. **`Team Orchestration` 설정 항목**:
   - **Relay 연결**: 공용 PC Relay URL (`ws://` / `http://`), `TEAM_KEY`, 내 GHE ID 자동 인식 결과, 실시간 연결 상태 배지 + `[Test Connection]`.
   - **자동 리뷰 수신 제어**: 글로벌 스위치(`Auto-Review ON / PAUSE`), 프로젝트별 수신 ON/OFF.
   - **AI & 모델 / 폴백**: 1순위 리뷰 AI CLI + 모델, 2순위 Fallback AI CLI + 모델(한도 초과 시 자동 전환).
   - **자동 리뷰 일꾼 정책**: 프로젝트당 최대 동시 자동 리뷰 일꾼 수(`1~3`), 완료 후 Ack 시 자동 삭제(기본 ON) / 즉시 삭제 옵션.
   - **Pre-defined 리뷰 프롬프트**: 기본 프롬프트 에디터(변수 치트시트 포함) + 커스텀 리뷰 스킬 호출 모드.
   - **Reject 조건 설정**: 제외 라벨, 제외 브랜치 패턴, 대기열 최대치, 작성자 화이트리스트/차단 목록.

---

## 9. 실전 예외상황 체크리스트

| 분류 | 예외 상황 | 대응 정책 |
| :--- | :--- | :--- |
| **Git / PR** | 리뷰 시작 전 PR이 Merged/Closed/Draft 전환 | 실행 전 `gh pr view` 1회 체크로 즉시 스킵 + 작성자에 `rejected(pr_closed)` 회신 |
| **Git / PR** | 리뷰 도중 작성자 추가 Push / Force-Push | 진행 중인 리뷰는 완료 처리(SHA 기준), 작성자가 재요청 시 새 `head_sha`로 신규 큐잉 |
| **Worktree** | Windows 파일 락(AV/VSCode)으로 자동 삭제 실패 | 기존 `remove_worktree` O(1) Rename-then-Prune + 백그라운드 지수 백오프 삭제 재활용 (실패 시 다음 부팅 고아 청소기가 정리) |
| **Worktree** | 무거운 프로젝트 부트스트랩(`npm install` 등) 지연 | 리뷰 Worktree는 `skip_bootstrap: true` 고정 적용(코드 읽기 전용 경량 체크아웃) |
| **AI 런타임** | Folder Trust / 권한 프롬프트에서 정지 | `isTrustOrSetupPrompt` 감지 후 30초 초과 시 Zen `Needs You`로 올려 1클릭 해제 |
| **AI 런타임** | 1순위 AI Rate Limit / Quota Exhausted | 감지 즉시 세션 종료 → 2순위 Fallback AI 1회 자동 재시도 → 실패 시 `failed(quota)` |
| **통신** | 리뷰어 오프라인 / 휴가 | Relay에 48h TTL 보관, 작성자 미니 상태바에 `Offline(Queued)` 표시 → 즉시 교체/취소 가능 |
| **통신** | 공용 PC Relay 일시 중단 | 기존 `jjdr` 및 `gh pr edit` 무영향, 로컬 아웃박스 재전송 및 연결 복구 시 자동 재접속 |
| **동시성** | 한 리뷰어에게 PR 3~5개 동시 집중 | `max_auto_review_workers` 하드 캡 준수, 초과분은 FIFO 큐 대기 → 앞 리뷰 삭제 완료 즉시 순차 실행 |

---

## 10. 다음 단계 (구현 착수 시 권장 분할 Phase)

1. **Phase 1 — Windows 공용 PC `jjdr-relay` 서버** (단일 바이너리 + SQLite + WebSocket/REST + 디렉토리/우체통/상태 중계 + Layer-1 Reject) — *완료*
2. **Phase 1.5 — Relay 카오스 하드닝** (WS 30s/60s Heartbeat Reaper, 명시적 `AckDelivery`/At-Least-Once `Dispatched` 상태, `device_id` 단일 Primary 배정 & 원자적 선점, `sync-active` 취소 동기화, SQLite `synchronous = FULL`, 카오스 E2E 테스트 5종)
3. **Phase 2 — `jjdr` Settings 확장 (`Team Orchestration` + 모달 폭 개선) & Relay 클라이언트 (`no_proxy`, `relay_outbox.json`, `device_id`) 연동**
4. **Phase 3 — 임시 `자동 리뷰 일꾼` 생성→리뷰→삭제 + 재부팅 Resume 엔진 (`skip_bootstrap`, 2중 하드 캡/FIFO 큐, Supersede, `auto_review_jobs.json`, 고아 청소기) + Layer-2 Reject + 한도 초과 Fallback + Zen Working/MarkdownViewerModal 연동**
5. **Phase 4 — Track B PR 생성 감지 (`createdAt <= 15m` + `prompted_pr_keys`) + 리뷰어 2명 선택 UI + 작성자 미니 상태바**
