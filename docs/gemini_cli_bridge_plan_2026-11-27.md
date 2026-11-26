# jjdr 내장 Gemini CLI 상태 브릿지 (Embedded Bridge) 구현 계획 (2026-11-27)

## 1. 배경 및 목표
- `herdr-core`는 Claude CLI의 상태(`working` / `blocked(permission)` / `done` / `idle` / `error`)를 잘 지원하지만, Gemini CLI는 네이티브 `OSC 7501`을 방출하지 않고 `herdr-core` 내장 파서도 부족해 카드 상태·승인 알림·Ready 전환·Zen Inbox 연동이 정확히 동작하지 않음.
- **목표**: 외부 데몬이나 별도 설치 없이 **`jjdr` 자체에 내장된 2중 하이브리드 Gemini CLI 브릿지**를 구축하여, Gemini CLI 세션도 Claude CLI와 완전히 동일한 수준으로 `Working`, `Needs You (Approve)`, `Ready`, `Idle`, `Error` 및 Zen Inbox/Dispatch/오버레이 HUD에 실시간 연동되도록 함.

---

## 2. 아키텍처: 2-Layer 하이브리드 내장 브릿지

### Layer 1 (주력 · <20ms 실시간): Gemini CLI 공식 Lifecycle Hooks → `jjdr` 로컬 루프백 브릿지
- **원리**:
  1. `herdr-core`는 실행하는 모든 터미널 프로세스에 환경변수 `HC_TERMINAL_ID` (터미널 주소)를 자동 주입함 (`hc schema` 확인 완료).
  2. Gemini CLI는 `~/.gemini/settings.json`의 공식 `hooks` (`SessionStart`, `BeforeAgent`, `BeforeTool`, `AfterTool`, `AfterAgent`, `Notification`, `SessionEnd`)를 지원하며, 훅 스크립트에 이벤트 JSON을 `stdin`으로 전달하고 터미널 환경변수(`HC_TERMINAL_ID`)를 상속함.
  3. `jjdr` Rust 백엔드 시작 시, 추가 크레이트 없이 기존 `tokio::net::TcpListener`로 **로컬 전용 루프백 리스너(`127.0.0.1:<ephemeral_port>`)** 를 기동하고, 포트·세션 토큰을 `%APPDATA%/jjdr/gemini-bridge/endpoint.json`에 기록.
  4. `jjdr`는 초경량 훅 브릿지 스크립트 `%APPDATA%/jjdr/gemini-bridge/hook.mjs` (~50줄, Node.js는 Gemini CLI 자체 런타임이므로 100% 존재)를 자동 동기화함.
  5. Gemini CLI에서 이벤트 발생 → `hook.mjs`가 `stdin` JSON + `HC_TERMINAL_ID` + `cwd`를 읽어 `127.0.0.1:<port>/gemini-hook`으로 전송(타임아웃 250ms, `jjdr` 종료 시에도 5ms 내 무음 종료)하고, Gemini CLI 규약("Silence is Mandatory")에 따라 `stdout`으로 `{}` 출력 후 exit 0.
- **이벤트 → `herdr-core` 호환 `Status` 매핑 (`app: "gemini"`)**:

| Gemini CLI Hook | 조건 / 내용 | `Status` 매핑 | `jjdr` 버킷 & UI |
| :--- | :--- | :--- | :--- |
| `SessionStart` | 세션 시작 | `state: "idle"`, `msg: "Ready for prompt"` | `idle` (Standby) |
| `BeforeAgent` | 프롬프트 제출·생각 시작 | `state: "working"`, `msg: "Thinking..."` | `running` |
| `BeforeTool` | 도구 실행 (`tool_name`) | `state: "working"`, `msg: "Running <tool_name>..."` | `running` |
| `AfterTool` | 도구 완료·후속 추론 | `state: "working"`, `msg: "Processing <tool_name>..."` | `running` |
| `Notification` | `ToolPermission` / 승인·확인 요청 | `state: "blocked"`, `kind: "permission"`, `msg` | **`needs_you` + `Approve` 원클릭 버튼** |
| `Notification` | 일반 질문 / 입력 대기 | `state: "blocked"`, `kind: "question"`, `msg` | **`needs_you`** |
| `AfterAgent` | 에이전트 턴 완료 | `state: "done"`, `msg: "Turn complete"` + **`synthetic_turn += 1`** | **`ready` (Ready 뱃지 & Zen Inbox 자동 상승)** |
| `SessionEnd` | 세션 종료 | `state: "idle"` | `idle` |

- **터미널 매칭 및 충돌 방지**:
  - 1순위: `HC_TERMINAL_ID`로 `TerminalStateHub.terminals`에서 직접 매칭 (`t12` 등 100% 정확).
  - 2순위: `HC_TERMINAL_ID`가 없거나 포맷이 다를 경우 정규화된 `cwd`로 라이브 `gemini` 터미널과 매칭.
  - **네이티브 우선 원칙**: 향후 `herdr-core`가 Gemini 네이티브 상태를 직접 보내게 되어 `term.status_ms > bridge.status_ms`이면 `herdr-core` 상태를 우선 유지해 충돌 없음.

### Layer 2 (안전망 · Zero-Config): Gemini TUI 화면 분석 Fallback (`src-tauri/src/gemini/screen.rs`)
- 훅이 아직 설치되지 않았거나(또는 사용자가 훅을 끈 경우), 구버전 Gemini CLI가 일부 이벤트를 누락하더라도 동작하도록 기존 `preview.rs`(`terminal.read`) 파이프라인에 **경량 Gemini TUI 화면 파서**를 연동:
  - **승인 프롬프트 감지** → `blocked` (`kind: "permission"`): `"Allow execution"`, `"Do you want to proceed"`, `"Yes, allow once"`, `"Yes, allow always"`, `"Apply this change"`, `"Waiting for user confirmation"` 등 매칭.
  - **작업 중 감지** → `working`: Gemini 하단 스피너/취소 바 (`esc to cancel`, Braille 스피너 `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` + `Thinking`/`Responding`/`Working`).
  - **오류 감지** → `error`: `"API Error"`, `"Quota exceeded"`, `"429 Too Many Requests"`, `"Authentication failed"`.
  - **완료 전환 감지** → `done` + `synthetic_turn += 1`: 직전 상태가 `working`이었다가 스피너가 사라지고 Gemini 입력 프롬프트(`Type your message` 등)로 돌아오면 `done` (`Ready`)으로 자동 전환.
- **성능 보호**: `preview.rs`의 기존 3초 쿨다운 + 3초 타임아웃 안에서만 동작하며, Layer 1 훅 이벤트가 최근 10초 내 수신된 세션은 화면 파싱 오버라이드를 건너뛰어 CPU/IPC 부하 최소화.

### Layer 3 (자동 설치 & 관리 UI): 안전한 `~/.gemini/settings.json` 병합 + Settings 카드
- **비파괴 JSON 병합 (`src-tauri/src/gemini/installer.rs`)**:
  - `~/.gemini/settings.json`을 읽어 기존 테마·MCP·사용자 훅을 100% 보존하면서, `"name": "jjdr-gemini-bridge"` 태그가 붙은 훅 항목만 안전하게 추가/갱신/제거 (임시 파일 기록 후 atomic rename).
  - 앱 기동 시 `hook.mjs` + `endpoint.json` 자동 생성 및 훅 자동 등록(단, 사용자가 명시적으로 제거한 경우 존중하도록 설정 플래그 지원).
- **설정 UI (`src/components/modals/GeminiBridgeSettingsSection.tsx` 신규)**:
  - `SettingsModal.tsx` 내부에 모듈 분리(`UpdateSettingsSection.tsx`와 동일 패턴, 900줄 제한 준수).
  - 표시 정보: 브릿지 상태(`Active · Hook + Screen Fallback` / `Screen Fallback Only`), 로컬 포트, 훅 설치 상태, 최근 수신 이벤트 시각/건수, 원클릭 `Install / Repair Hooks` & `Uninstall Hooks` 버튼.
- **터미널 실행 환경변수 보강 (`src-tauri/src/commands/terminals.rs`)**:
  - `jjdr`에서 `gemini` 세션 실행 시 `params["env"]`에 `JJDR_GEMINI_BRIDGE_PORT`, `JJDR_GEMINI_BRIDGE_TOKEN`도 함께 전달해 `endpoint.json` 읽기 실패 상황에서도 즉시 연결 가능.

---

## 3. 생성 및 수정 파일 목록

### Rust Backend (`src-tauri/src/`)
1. `src-tauri/src/gemini/mod.rs` — (신규) Gemini 브릿지 모듈 엔트리 & 공용 타입(`GeminiBridgeEvent`, `GeminiBridgeStatus`, `is_gemini_terminal`).
2. `src-tauri/src/gemini/bridge.rs` — (신규) `127.0.0.1` 루프백 HTTP 수신 서버, 토큰 검증, `hook.mjs` 임베드 추출 및 `endpoint.json` 갱신, `TerminalStateHub` 상태 주입.
3. `src-tauri/src/gemini/screen.rs` — (신규) Zero-Config Gemini TUI 화면 상태 파서 (`working`/`blocked(permission)`/`done`/`error`) + 단위 테스트.
4. `src-tauri/src/gemini/installer.rs` — (신규) `~/.gemini/settings.json` 비파괴 훅 병합 설치/제거/상태 점검 + 단위 테스트.
5. `src-tauri/src/commands/gemini_bridge.rs` — (신규) Tauri 커맨드 (`get_gemini_bridge_status`, `install_gemini_bridge_hooks`, `uninstall_gemini_bridge_hooks`).
6. `src-tauri/src/herdr/events.rs` — `TerminalStateHub`에 `gemini_overrides` 상태 병합(`apply_gemini_override`, `overlay_gemini_state`) 및 미후킹 live Gemini 세션 프리뷰 주기 보강.
7. `src-tauri/src/herdr/preview.rs` — `read_res.text` 수집 시 Layer 2 `gemini::screen::analyze_gemini_screen` 폴백 연동.
8. `src-tauri/src/commands/terminals.rs` — `gemini` 실행 시 `env`에 브릿지 포트/토큰 주입.
9. `src-tauri/src/lib.rs` & `src-tauri/src/commands/mod.rs` — `AppState`에 `GeminiBridgeRuntime` 등록, 앱 시작 시 브릿지 기동 & 커맨드 등록.

### Frontend (`src/`)
10. `src/types/domain.ts` — `GeminiBridgeStatus` 타입 추가.
11. `src/services/tauriBridge.ts` — `getGeminiBridgeStatus`, `installGeminiBridgeHooks`, `uninstallGeminiBridgeHooks` 래퍼 추가.
12. `src/components/modals/GeminiBridgeSettingsSection.tsx` — (신규, `React.memo`, Zero-Blur, 영문 UI) 브릿지 상태 표시 및 1클릭 훅 설치/복구/제거 카드.
13. `src/components/modals/SettingsModal.tsx` — `<GeminiBridgeSettingsSection />` 마운트.
14. `APP_MAP.md` — 신규 모듈 및 인터페이스 반영.

---

## 4. 성능 · 안전성 · 검증 계획
- **성능**:
  - 루프백 HTTP 요청은 이벤트 발생 시에만 1회(수 KB 미만) 처리, 폴링 0; Screen Fallback은 기존 `preview.rs` 3초 쿨다운 재사용.
  - `hook.mjs`는 `jjdr` 미실행 시에도 250ms 이내 무음 종료(`{}`)하여 Gemini CLI 단독 실행에 영향 0.
- **보안**:
  - `127.0.0.1` 로컬 루프백 바인딩 + 앱 기동마다 생성되는 랜덤 32바이트 `X-JJDR-Token` 헤더 검증(외부 네트워크 노출 0).
- **검증**:
  - Rust 단위 테스트 (`cargo test --manifest-path src-tauri/Cargo.toml --lib`):
    - `gemini::bridge`: HTTP 이벤트 수신 → `Status` 매핑(`BeforeTool`/`Notification(ToolPermission)`/`AfterAgent` 턴 증가) & 토큰 거부 검증.
    - `gemini::screen`: Gemini 승인/스피너/오류/완료 전환 TUI 텍스트 파싱 테스트.
    - `gemini::installer`: 기존 `~/.gemini/settings.json` 보존 병합, 멱등 재설치, 깔끔한 제거 테스트.
  - Frontend 테스트 & 빌드 (`npm run test && npm run build`): 0 에러 확인.
  - Zero-Blur & 파일 900줄 이하 점검 + `docs/test_results_2026-11-27_gemini_bridge.txt` 기록.
