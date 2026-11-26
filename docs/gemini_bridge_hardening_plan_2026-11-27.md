# Gemini CLI Bridge Hardening & High-Coverage Test Suite Plan (2026-11-27)

## 1. 사전 감사로 발견된 실전 지뢰 4건 및 수정 계획

| # | 지뢰 (원인) | 실전 증상 | 해결 방안 |
|---|---|---|---|
| 1 | `BeforeTool`/`AfterTool` 미사용 + `recent_hook` 15초 가드 | `Notification(ToolPermission)` → `Approve(Enter)` 승인 후 `AfterAgent`까지 카드가 `blocked`에 고착 | `send_terminal_keys`/`write_terminal_input`에서 Enter 전송 시 Gemini `blocked` → 즉시 `working` 전환 + 화면 파서에서 `blocked→working`은 15초 가드 예외 처리 |
| 2 | 최신 `@google/gemini-cli` 멀티라인 확인 다이얼로그(`Allow once` / `Allow for this session` / `No, suggest changes (esc)`) | Screen-Only 모드에서 최신 Gemini CLI 권한 프롬프트 미감지 | `screen.rs` 멀티라인 매칭 + `waiting for your confirmation` 추가 |
| 3 | 과거 스크롤백에 남은 `Allow once`/`Allow execution` 오탐 | 승인 후 짧은 답변이 끝나 `> Type your message`로 복귀해도 `blocked` 유지 | 최하단 4줄에 활성 입력 프롬프트가 있고 확인 메뉴가 바로 아래에 없으면 `blocked` 오탐 차단 → `done` 전환 |
| 4 | 회사 보안 프로그램(AV/EDR) `pwsh` 콜드스타트 지연 | `timeout: 2000ms`에서 훅 강제 종료 위험 | `timeout: 5000ms`로 상향 (정상 시 0.5~0.8s 완료, AV 스캔 시 안전 마진 확보) |

## 2. 테스트 가능 아키텍처 리팩토링
- `src-tauri/src/gemini/state.rs` (신규, 무조건 컴파일):
  - `TerminalStateHub` 내부에 있던 Gemini 매칭(`HC_TERMINAL_ID` > `JJDR_GEMINI_ADDR` > `cwd`), 오버레이, 15초 훅 우선 규칙, `blocked` 승인 즉시 해제, Screen Fallback 판정, 네이티브 `herdr-core` 양보 규칙을 순수 Rust 엔진(`GeminiStateEngine`)으로 분리.
  - `#[cfg(not(test))]`에 갇히지 않아 모든 상태 전이/엣지케이스를 Rust 단위 테스트로 100% 검증 가능.

## 3. 고커버리지 TC & 가상 시나리오 Suite 계획

### A. Rust Backend Suite (`cargo test --lib`)
1. `gemini::state` (14+ TC):
   - 3단계 매칭 우선순위 & 동일 Worktree 다중 Gemini 충돌 방지
   - Windows 경로 대소문자/역슬래시/후행 슬래시 정규화 매칭
   - 전체 1턴 라이프사이클 (`idle → working → blocked → user approve → working → done`)
   - 멀티턴 연속 사이클 (`turn: 0 → 1 → 2`)
   - 15초 Hook 보호 vs `blocked → working` 즉시 해제 예외
   - Screen-Only (0 Hooks) 전체 라이프사이클
   - 네이티브 `herdr-core` 최신 `status_ms` 우선 양보
   - 비-Gemini(`claude`, `pwsh`) 무간섭 & `finished` 터미널 지연 패킷 무시 & 제거 시 메모리 정리
2. `gemini::screen` (12+ TC):
   - 최신 v0.3x `edit`/`exec`/`sandbox_expansion` 멀티라인 확인 다이얼로그
   - 구버전 `Yes, allow once` 하위 호환
   - 과거 스크롤백 오탐 방지 (`Allow execution` + 하단 `> Type your message` → `done`)
   - ANSI 이스케이프 포함 실제 PTY 텍스트 파싱
   - 스피너/취소 힌트/MCP 초기화/에러 4종/일반 idle `None` 반환
3. `gemini::installer` (5+ TC):
   - 비파괴 병합/재설치/제거 & 3개 이벤트 고정 (`BeforeTool`/`AfterTool` 금지) & `timeout == 5000`
   - 공백·작은따옴표 포함 경로 PowerShell 이스케이프
   - Windows 실제 `pwsh` E2E UDP 발송 (`BeforeAgent`, `Notification`, `AfterAgent`, 1000자 응답 240자 절단, `endpoint.json` 부재 시 무에러 `{}` 종료)
4. `gemini::bridge` (4+ TC):
   - 전 이벤트 매핑, `Notification` 권한/질문 구분, 토큰 검증, 알 수 없는 이벤트 무시

### B. Frontend Virtual Scenario E2E Suite (`src/utils/geminiSimulation.test.ts`)
- `computeDashboard` + `selectZenTopCard` + `buildProjectDispatchDeck` + `selectTopBgOverlayCandidate` + `isPermissionApprovalPending` + `computeRunningProgressVisual` 통합 가상 시나리오 12+ TC:
  - 풀 라이프사이클 (Radar/Queue/Zen Inbox/BG HUD)
  - 멀티턴 결재 재등장 검증
  - 동일 Worktree Gemini x2 + PowerShell x1 공존 우선순위
  - Zen Dispatch 출동 전이
  - Claude vs Gemini 100% 동등성(Parity) 검증
  - Error 상태 시 `Approve` 버튼 비노출 검증

### C. 실제 로컬 `@google/gemini-cli` 리허설
- 설치된 `@google/gemini-cli` 번들의 실제 `HookRegistry` 로직에 `installer.rs`가 생성한 `settings.json`을 주입해 경고 0건·에러 0건·3개 훅 `enabled: true` 로드를 실증.
