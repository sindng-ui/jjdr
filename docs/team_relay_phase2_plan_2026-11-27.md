# Phase 2 구현 계획서: `jjdr` Settings 확장 (`Team Orchestration`) & Relay 클라이언트 연동

> **작성일**: 2026-11-27  
> **기반 스펙**: [pr_auto_review_spec_2026-11-27.md](./pr_auto_review_spec_2026-11-27.md)  
> **목표**:  
> 1. 좁고 808줄까지 커진 `SettingsModal`을 **넓은 2컬럼 탭 모달(`max-w-[940px]`)**로 개편하고 `Team Orchestration` 탭을 신설한다.  
> 2. `src-tauri`에 `crates/relay-protocol`을 연결하고, `no_proxy()` 기본 적용·영구 `device_id`·영속 `relay_outbox.json`·WebSocket 자동 재연결 & 명시적 `AckDelivery`를 갖춘 `TeamRelayRuntime`을 구축한다.

---

## 1. 백엔드 설계 (`src-tauri/`)

### A. 의존성 추가 (`src-tauri/Cargo.toml`)
- `relay-protocol = { path = "../crates/relay-protocol" }`
- `tokio-tungstenite = "0.26"`
- `futures-util = "0.3"`

### B. 설정 모델 분리 (`src-tauri/src/store/team_settings.rs`)
`AppSettings`에 `#[serde(default)] pub team: TeamOrchestrationSettings` 필드를 추가해 기존 `settings.json`과 100% 하위 호환을 유지한다.

- **연결 & 정체성**: `enabled`, `relay_url`, `team_key`, `bypass_proxy` (기본 `true`), `github_id_override`, `display_name`
- **수신 제어**: `auto_review_paused` (전역 ON/PAUSE)
- **AI & 모델 / 한도 초과 Fallback**: `primary_agent`, `primary_model`, `fallback_agent`, `fallback_model`
- **임시 일꾼 동시성 & 정리**: `global_max_auto_review_workers` (기본 `2`), `per_project_max_workers` (기본 `1`), `ack_teardown_mode` (`"on_ack"` 기본 | `"immediate"`)
- **Pre-defined 리뷰 프롬프트**: `review_prompt_template` (기본 템플릿에 GHE PR 코멘트 등록 + `{{review_report_path}}` 저장 지침 포함)
- **Layer-2 Reject 조건**: `reject_excluded_labels` (기본 `["wip", "no-ai-review"]`), `reject_excluded_branches`, `reject_disabled_project_ids`, `reject_allowed_authors`, `reject_blocked_authors`, `reject_max_queue_size` (기본 `5`)

### C. Team Relay 클라이언트 모듈 (`src-tauri/src/team/`)
900줄 규칙과 책임 분리를 위해 4개 모듈로 나눈다:
1. `src-tauri/src/team/mod.rs`: `TeamConnectionSnapshot`, `RelayTestResult`, `TeamStateEvent`, `TeamReviewAssignedEvent`, `TeamStatusChangedEvent`, `TeamReviewCancelledEvent` 도메인 타입.
2. `src-tauri/src/team/identity.rs`:
   - `%APPDATA%/jjdr/device_id.txt` 영구 기기 UUID 생성/로드.
   - `gh api user --jq .login` 비동기 단발 실행으로 사내 GHE ID 자동 감지(로컬 프로젝트들의 `git remote get-url origin`에서 GHE 호스트 자동 추출해 `GH_HOST` 대응!).
   - 등록 프로젝트들의 `origin` 원격 URL을 수집해 `relay_protocol::normalize_repo_list`로 정규화.
3. `src-tauri/src/team/outbox.rs`:
   - 영속 `%APPDATA%/jjdr/relay_outbox.json` 큐(리뷰어 상태 보고 `Completed/Rejected/Failed` 및 작성자 요청 재전송용).
   - 재연결 시 최우선 Flush; `400/404/409` 영구 에러 또는 TTL(12h) 초과는 폐기, 일시 네트워크/5xx 장애는 보존 후 다음 재연결에 재시도.
4. `src-tauri/src/team/client.rs`:
   - `TeamRelayRuntime`: `reqwest::Client` (`bypass_proxy: true` 시 `.no_proxy()` 적용!).
   - 백그라운드 Tokio Supervisor (`spawn_relay_supervisor`):
     - `watch` 채널로 설정/프로젝트 변경을 즉시 감지해 재연결·Presence 동기화(`UpdatePresence`) 수행.
     - 지수 백오프(`1s → 2s → 5s → 10s → 30s`) 자동 재접속, `Hello` 시 `github_id` + `device_id` + `Online/Paused` + 정규화 `repo_urls` 등록.
     - `Welcome` 직후 `relay_outbox.json` 자동 Flush!
     - `ReviewAssigned` 수신 즉시 `AckDelivery` 회신 + `jjdr:team-review-assigned` Tauri 이벤트 발행(Phase 3 연결 훅).
     - `PeersUpdated` / `AssignmentStatusChanged` / `ReviewCancelled` / 연결 상태 변화를 `emit_to("main", ...)`으로 발행.
5. `src-tauri/src/commands/team.rs`:
   - `get_team_status`, `test_team_relay_connection`, `detect_team_github_id`, `reconnect_team_relay`, `sync_team_presence`, `list_team_peers`, `flush_team_outbox`.
   - `save_settings` 및 프로젝트 추가/삭제 시 `TeamRelayRuntime::notify_config_changed()` 자동 호출.

---

## 2. 프론트엔드 설계 (`src/`)

### A. `SettingsModal` 폭 확장 & 좌측 탭 리팩토링 (808줄 → ~200줄 쉘)
- 기존 `max-w-xl` (576px) → **`w-[94vw] max-w-[940px]`** + 고정 높이 `h-[min(82vh,760px)]` 2컬럼 레이아웃 (좌측 200px 탭 네비게이션 + 우측 독립 스크롤 본문, **Zero-Blur 100% 준수**).
- 컴포넌트 분리 (모든 파일 350줄 이하 유지):
  - `src/components/modals/SettingsModal.tsx` — 경량 쉘 + 4개 탭 전환 + 저장/닫기 푸터
  - `src/components/modals/settings/AppearanceSettingsTab.tsx` — 테마 4종, 레이더 밀도 & Columns 너비 슬라이더, ROOT 카드 모드
  - `src/components/modals/settings/GeneralSettingsTab.tsx` — 백그라운드 HUD, Stuck/알림/Overlap, 원클릭 프롬프트 프리셋
  - `src/components/modals/settings/TeamOrchestrationSettingsTab.tsx` — 신규!
    - **연결 카드**: Enable 토글, Relay URL, Team Key(마스킹 토글), `Bypass System Proxy (사내 IP 권장)` 체크, GHE ID 자동 감지(`Detect` 버튼 + 수동 오버라이드), Display Name, **`[Test Connection]`** 버튼 + 실시간 연결 상태/온라인 피어 수/아웃박스 대기 건수 배지
    - **수신 & 일꾼 제어**: 글로벌 `Auto-Review ON / PAUSE` 토글, 1순위 AI CLI + 모델, 2순위 Fallback AI CLI + 모델(한도 초과 시 자동 전환), 글로벌 동시 상한(`1~5`) & 프로젝트별 상한(`1~3`), Ack 시 자동 삭제 정책
    - **Pre-defined 리뷰 프롬프트**: 멀티라인 에디터 + 클릭 삽입 변수 칩(`{{pr_number}}`, `{{pr_url}}`, `{{review_report_path}}` 등) + 기본값 복원 버튼
    - **Layer-2 Reject 조건**: 제외 라벨/제외 브랜치/허용 작성자/차단 작성자(콤마 구분 입력), 로컬 대기열 최대치, 프로젝트별 자동 리뷰 ON/OFF 체크리스트
  - `src/components/modals/settings/IntegrationsSettingsTab.tsx` — `GeminiBridgeSettingsSection` + `UpdateSettingsSection`
- 유틸 분리: `src/utils/teamSettings.ts` (기본값 생성, 콤마 리스트 파싱/포맷, 설정 유효성 검사 순수 함수 + Vitest 단위 테스트).

### B. 상태 스토어 & 브릿지
- `src/types/domain.ts`: `TeamOrchestrationSettings`, `TeamConnectionSnapshot`, `TeamPeerInfo`, `RelayTestResult` 추가.
- `src/services/tauriBridge.ts`: Phase 2 커맨드 래퍼 및 `listenTeamStateChanged` 추가.
- `src/store/useAppStore.ts`: `teamSnapshot` 상태 추가.
- `src/hooks/useHerdrSync.ts`: 초기 로드 시 `getTeamStatus()` + `listenTeamStateChanged` 구독.

---

## 3. 검증 계획
1. **Rust 단위 테스트 (`cargo test --lib --manifest-path src-tauri/Cargo.toml`)**:
   - 구버전 `settings.json`(team 필드 미포함) 하위 호환 역직렬화 테스트
   - `team::outbox` 영속화·재로드·영구 에러(404/409) 폐기·TTL 만료·일시 장애 보존 테스트
   - `team::identity` `device_id` 영속성 및 GHE URL 호스트 추출 테스트
2. **프론트엔드 단위 테스트 (`npm run test`)**:
   - `teamSettings.ts` 기본값 병합·콤마 파싱·유효성 검증 테스트
3. **타입체크 & 빌드 (`npm run build` + `cargo check --manifest-path src-tauri/Cargo.toml`)**
4. **기존 Relay 테스트 회귀 확인 (`cargo test --offline --manifest-path relay/Cargo.toml`)**
5. **테스트 결과 저장(`docs/test_results_2026-11-27_team_phase2.txt`) 및 `APP_MAP.md` 업데이트**
