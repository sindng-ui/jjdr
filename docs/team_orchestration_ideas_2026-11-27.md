# jjdr 2.0 비전: 팀 협업 이벤트 기반 자율 오케스트레이션 아이디어

> **작성일**: 2026-11-27  
> **배경**: 개인 단위 AI 작업 큐·일꾼 배차(`Zen Dispatch`) 및 단일 세션 집중(`Zen Inbox`) 구조가 완성됨에 따라, **팀원·PR·CI·이슈 흐름과 유기적으로 맞물려 돌아가는 팀 협업형 `jjdr`** 방향성과 핵심 아이디어를 정리한 문서.

---

## 1. 비전 요약: 개인 관제탑(1.0) → 팀 자율 오케스트레이터(2.0)

- **현재 (`jjdr 1.0`)**: 사용자가 직접 일꾼(Worktree + AI CLI)에게 일을 시키고(Manual Push), 완료되면 `Zen Inbox`에서 1장씩 결재하는 **개인 중심 루프**.
- **목표 (`jjdr 2.0`)**: 팀의 움직임(리뷰 요청, PR 코멘트, CI 실패, 이슈 할당, 머지 등)을 로컬에서 자동 감지해 놀고 있는 적임자 일꾼을 자동 배차·실행하고, **사용자는 다 차려진 결과물만 `Zen`에서 도장 쾅 찍어 팀에 반영하는 이벤트 기반 루프**.

---

## 2. 핵심 설계 철학: "자율 실행 + Zen 결재 게이트"

팀 협업이 엮이면 AI가 외부(GitHub, 팀원 PR, 메인 브랜치 등)에 잘못된 리뷰를 남기거나 미검증 코드를 푸시하는 사고를 막아야 한다. 따라서 `jjdr`의 기존 **Zen 결재함 철학**을 유지한 **3단계 자율도(Autonomy Level)** 모델을 채택한다.

```text
[팀 이벤트 감지] ──▶ [일꾼 자동 매칭] ──▶ [AI 자율 실행] ──▶ [Zen 결재함 (Human Gate)] ──▶ [팀에 반영]
 (PR/리뷰/CI/이슈)   (Affinity / Pool)    (스킬/프롬프트)      (검토 후 도장 쾅!)          (Push/Comment)
```

| 자율도 레벨 | 동작 방식 | 적합한 용도 |
| :--- | :--- | :--- |
| **Level 1 · `Triage Only`** | 이벤트 감지 → Zen에 *"신규 팀 미션"* 카드만 꽂음 → 사용자가 `Dispatch` 승인 시 일꾼 투입 | 중요도가 높거나 판단이 필요한 신규 태스크 |
| **Level 2 · `Auto-Draft`** *(기본 권장)* | 이벤트 감지 → 일꾼 자동 배차 + 스킬/프롬프트 실행 → **로컬에서 리뷰 초안·코드 수정·테스트까지 완료 후 외부 전송 직전에 Zen 결재함에 상정** | PR 리뷰 초안, 리뷰 지적 수정(`fix-pr`), CI 실패 분석, 이슈 정찰 |
| **Level 3 · `Full Auto`** | 외부 영향이 없는 무해한 집안일만 사람 개입 없이 완료 | 머지 완료 Worktree 정리 제안, `main` 최신화, 로컬 정찰 리포트 기록 |

---

## 3. 핵심 라우팅 엔진: 역할 풀(Pool) + 컨텍스트 친화도(Affinity)

단순히 아무 Idle 일꾼이나 잡는 것이 아니라, **역할 분리**와 **맥락 보존**을 우선한다.

1. **일꾼 역할 풀 (`Worker Role Pool`)**
   - Worktree(일꾼)별 역할 태그 부여: `Review` / `Dev` / `Scout(조사)` / `General`.
   - **`Review` 일꾼**: 코드 수정이나 위험한 쉘 실행 없이 읽기·분석 위주 프로필로 1~2개 상시 대기시켜, PR 브랜치만 `git fetch && checkout --detach`로 빠르게 바꿔가며 다수 PR을 리뷰.
2. **컨텍스트 친화도 (`Context Affinity`)**
   - **1순위 (원담당 일꾼)**: 예컨대 내 PR `#412`에 리뷰 지적이 오면 `pr_number === 412` 또는 해당 브랜치를 보유한 **원래 그 PR을 짰던 일꾼**을 최우선 소환 (이미 AI 세션 내에 설계 의도와 대화 맥락이 남아 있어 수정 품질과 속도가 높음).
   - **2순위 (Clean Idle 대체 일꾼)**: 원담당 일꾼이 이미 정리되었거나 바쁘면, 동일 프로젝트의 Clean Idle `Dev` 일꾼을 배차해 해당 브랜치를 받아와 투입.
   - **3순위 (대기열/자동 고용)**: 전원이 작업 중이면 대기열에 큐잉했다가 Idle 전환 시 바통터치하거나, 설정에 따라 새 Worktree 자동 고용.

---

## 4. 팀 협업 유기적 시나리오 9선

### A. PR & 리뷰 핑퐁 가속 (코어 루프)

1. **리뷰어 지정 감지 → `Pre-Review` 자동 초안**
   - 팀원이 나를 리뷰어로 지정하거나 `@멘션` → `Review` 풀의 Idle 일꾼 자동 배차 → PR 브랜치 체크아웃 후 지정 리뷰 스킬/프롬프트 실행.
   - AI가 **변경 요약 + 위험도 등급(단순 수정 3초 컷 vs 로직 변경 정밀 검토) + 파일별 리뷰 코멘트 초안**을 작성 → Zen에 `[Review Ready · PR #412]` 카드 상정 → 사용자가 검토·취사선택 후 `Approve & Post` 원클릭 게시.
2. **내 PR 리뷰 지적 감지 → 원담당 일꾼 소환 & `fix-pr` 루프**
   - 내 PR에 `Changes Requested` 또는 미해결 코멘트 스레드 감지 → 원담당 일꾼 자동 특정 → `$fix-pr` 등 지정 수정 프롬프트 + 코멘트 원문 자동 주입.
   - AI가 코드 수정 + 로컬 테스트 + **코멘트 답변 초안**까지 작성 후 Zen 결재 요청 → 사용자가 Diff 확인 후 도장 찍으면 `git push` + 스레드 Reply.
3. **재리뷰(Re-review) 델타 검증**
   - 내가 어제 리뷰에서 지적한 PR에 팀원이 수정 커밋 후 Re-request Review 요청 시, **어제 그 PR을 리뷰했던 동일 리뷰 일꾼**을 다시 깨워 *"이전 지적 사항이 이번 커밋에서 해결되었는지 델타만 검증"*하도록 투입.

### B. 팀 충돌 예방 & 자동 소방 (멀티플레이어 레이더)

4. **팀 단위 Merge Overlap Radar**
   - 기존 로컬 Worktree 간 파일 충돌 감지(`compute_merge_overlaps`)를 **열려 있는 팀원 PR들**까지 확장.
   - *"팀원의 PR #419가 현재 작업 중인 `feat/auth` Worktree의 동일 파일을 수정 중"*임을 사전 경고하고, `main` 머지로 내 PR에 Conflict 발생 시 원담당 일꾼이 `fetch + rebase` 해소 초안을 미리 준비.
5. **CI / 빌드 실패 자동 소방수 (`Auto-Healer`)**
   - 내 PR의 GitHub Actions / GitLab CI / Jenkins 체크 실패(`failure`) 감지 즉시 실패 로그를 수집해 원담당 일꾼에게 자동 투입 → Zen에 `[CI 실패 원인 분석 & 수정안]` 카드 상정.

### C. 티켓·이슈·메신저 선제 정찰

6. **이슈/티켓 할당 → 사전 정찰병(`Scout`) 자동 파견**
   - Jira / GitHub Issues / Linear 티켓이 내게 할당되면, 성급히 코드를 고치기 전에 조사 전용 프롬프트(*관련 파일 위치, 추정 원인, 영향 범위, 구현 계획 초안*)만 자동 실행.
   - 사용자가 티켓을 확인할 때쯤 Zen에 분석 리포트가 준비되어 있으며, `[이 계획으로 개발 투입]` 버튼 한 번으로 개발 전환.
7. **팀원 `@멘션` 질문 답변 초안기**
   - PR 코멘트나 이슈에서 팀원이 특정 로직 의도를 물어보며 태그할 경우, 정찰 일꾼이 코드 + `git blame`/히스토리를 조회해 근거 파일/라인이 포함된 답변 초안을 Zen 카드에 준비.

### D. 일꾼 생명주기 & 동료 연계

8. **PR 머지 감지 → 자동 정리 & Stacked PR 릴레이**
   - 내 PR이 `Merged` 되면 Daily Recap(`zenRecap`)에 성과 기록 후 Worktree 정리(또는 `main` 리셋 후 Idle 풀 복귀) 제안. 후속 Stacked PR 일꾼이 있다면 자동으로 `rebase main` 수행.
9. **동료 간 일꾼 컨텍스트 `Handoff`**
   - 디버깅하던 이슈를 다른 팀원에게 인계할 때, 브랜치·핵심 변경점·AI가 정리한 가설/맥락을 경량 스냅샷(JSON 또는 PR 코멘트 블록)으로 내보내어, 동료의 `jjdr` 일꾼이 1초 만에 맥락을 이어받아 작업 재개.

---

## 5. 확장 가능한 자동화 플레이북(Playbook) 구조

시나리오를 개별 하드코딩하지 않고, 팀 문화·사내 스킬명·브랜치 규칙에 맞춰 조합할 수 있는 **룰 엔진** 형태를 지향한다.

- **`WHEN` (트리거)**: `PR Review Requested` / `My PR Commented` / `My PR CI Failed` / `Issue Assigned` / `PR Merged`
- **`FILTER` (조건)**: 대상 프로젝트, Draft PR 제외, 특정 라벨 제외, **신뢰된 팀원/Org 작성자 필터**
- **`POOL` (일꾼 매칭)**: `원담당 일꾼(Affinity)` → `역할 풀 Idle` → `대기열 보류` 또는 `새 Worktree 고용`
- **`PREPARE` (사전 Git 작업)**: `git fetch && checkout` *(단, `dirty_count > 0`인 일꾼은 덮어쓰기 절대 금지)*
- **`PROMPT` (실행 지시)**: 템플릿 변수(`{pr_url}`, `{pr_number}`, `{comments}`, `{ci_log}`) 치환 후 자동 주입
- **`GATE` (결재 방식)**: `Auto-Draft` (완료 후 Zen 카드) vs `Card Only` (투입 전 확인 카드)

---

## 6. 실전 투입 시 필수 안전장치 & 현실 제약

회사 환경(Windows + 사내 프록시 + 보안 프로그램 AV/EDR)을 고려한 4대 원칙:

1. **Zero-Server 로컬 센서 (`TeamSensor`)**:
   - 사내망에서 외부 Webhook을 로컬 PC로 받는 것은 불가능하므로, Rust 백엔드 폴링 워커에서 **`gh` / `glab` CLI 우선 활용**(사내 SSO·Enterprise 인증·프록시 자동 상속) + 필요 시 `win_http.rs` 기반 `ETag(304)` 경량 캐싱 폴링.
2. **프롬프트 인젝션 & 권한 격리**:
   - 외부/미확인 작성자의 PR 본문·코멘트 내 악성 지시(예: 비밀키 유출 시도) 방지를 위해 **동일 Org/팀 멤버 화이트리스트** 적용.
   - `Review` 일꾼은 읽기 전용/비-YOLO 프로필 분리 및 입력 데이터와 실행 지시의 명확한 경계(`<<<UNTRUSTED_CONTENT>>>`) 적용.
3. **폭주 & 무한 핑퐁 방지 (Guardrails)**:
   - 동시 자동 출동 상한선(`Max Auto-Workers`, 예: 2개)으로 PC 자원·토큰 폭주 방지.
   - **Idempotency Key**(`pr_number + head_sha` / `comment_id`)로 동일 이벤트 중복 실행 차단.
   - `dirty_count > 0` Worktree 보호 및 전역 원클릭 비상 스위치(**`Autopilot ON / PAUSE`**).
4. **Zen UX의 차분함(Calm) 유지**:
   - 자동 출동 자체는 `Time to chill` 진행 중 미션 카드에 조용히 합류하고, **AI 작업이 끝나 결재가 필요할 때만** 기존처럼 `Zen Inbox`에 1장씩 올려 인지 부하를 최소화.

---

## 7. 기존 `jjdr` 자산과의 연계 포인트

현재 코드베이스에 이미 구현된 아래 모듈들을 재사용·확장할 수 있다:

- **PR & 미션 메타데이터**: `src-tauri/src/store/projects.rs` (`WorktreeCardMeta`: `mission_kind`, `pr_number`, `pr_url`), `src/utils/missionDetector.ts`
- **배차 및 세션 제어**: `src/utils/zenDispatch.ts`, `src-tauri/src/commands/terminals.rs` (`send_terminal_text`, `launch_session`), `src-tauri/src/commands/worktrees.rs`
- **충돌 레이더**: `src-tauri/src/git/worktree.rs` (`compute_merge_overlaps`)
- **사내 프록시/네트워크 대응**: `src-tauri/src/update/win_http.rs`
- **결과물·성과 집계**: `src/utils/zenRecap.ts`, `src/components/overlay/BgOverlayToast.tsx`

---

## 8. 추천 진화 로드맵

1. **Phase 1 — Core Team Loop MVP**
   - `gh` CLI 기반 로컬 팀 센서 + 2대 핵심 자동화(`리뷰어 지정 → 자동 리뷰 초안`, `내 PR 지적 → 원담당 일꾼 fix-pr`).
   - 일꾼 Role 태그(`Review` / `Dev`), `Auto-Draft` vs `Card Only` 설정, `Autopilot ON/OFF` 토글.
2. **Phase 2 — Zen 1-Click 팀 반영 & 충돌/CI 레이더**
   - Zen 카드 내 `코멘트 게시` / `Push & Reply` 1클릭 액션, `CI 실패 자동 소방수`, 팀원 PR 포함 `Team Merge Overlap Radar`.
3. **Phase 3 — 티켓/메신저 & 동료 Handoff**
   - Jira/GitHub Issues 정찰병(`Scout`), 메신저(Slack/Teams) 연동, 동료 간 `Handoff` 스냅샷.

---

## 9. 다음 설계 착수 전 확인 사항

- [ ] 팀에서 사용 중인 Git 호스트 / 이슈 트래커 / 메신저 스택 확정 (GitHub/GHE, GitLab, Jira 등)
- [ ] 선호하는 기본 자율도 (`Auto-Draft` vs `Card Only` vs 트리거별 차등)
- [ ] 1차 MVP로 가장 먼저 투입할 1~2개 시나리오 선정
