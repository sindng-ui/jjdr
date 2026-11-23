# jjdr 아키텍처 및 구현 계획서

**jjdr** (`jj + herdr`)은 기존 `herdr-app`에서 여러 프로젝트·다수 Git worktree·다수 AI CLI를 병렬로 돌릴 때 발생하는 **인지 부하(정신력 소모)**를 극단적으로 줄이기 위한 초경량 **Tauri v2 (Rust) + React + Vite** 데스크톱 관제탑입니다.

---

## 1. 확정된 핵심 방향 및 환경 검증 결과

현재 PC 환경 검증을 통해 아래 전제 조건이 모두 준비됨을 확인했습니다.
- **런타임 연동**: 외부 설치된 `herdr-core` / `hc 0.1.17`과 공식 프로토콜(`hc connect` 기반 JSON-RPC 2.0 + 바이너리 Framed Stream, OpenRPC 1.3.2 스키마 검증 완료)로 통신
- **개발 툴체인**: `rustc 1.99.1`, `cargo 1.99.1`, `node v24.11.1`, `npm 11.6.2`, `git 2.51.2`
- **상호작용 모델 (방식 C — 하이브리드)**:
  - **평소 관제 (90%)**: 모든 프로젝트·worktree·세션을 DOM에 `xterm.js` 없이 **초경량 상태 카드**(`🔴 Needs You` / `🟢 Ready` / `🟡 Running` / `⚪ Idle`)로 한눈에 파악 + 카드 내 1줄 빠른 후속 지시·승인
  - **집중 조작 (10%)**: 선택한 **단일(또는 분할 최대 2개) worktree**에만 `terminal.attach` Framed Stream으로 `xterm.js`를 즉석 마운트하고, 전환 시 즉시 `CLOSE` 및 언마운트하여 메모리 회수

---

## 2. 핵심 UX 설계 (정신력 소모 최소화)

### 2.1 마우스 클릭 없는 현황 파악 (2가지 뷰 + 단축키 1방 전환)
1. **Attention Queue 뷰 (기본)**: 프로젝트 경계를 넘어 지금 형님의 액션이 필요한 항목을 상태 우선순위로 자동 배치합니다.
   - `🔴 Needs You` (`blocked`: permission / question / auth, `error`, 또는 5분+ 무응답 Stuck 경고)
   - `🟢 Ready` (`done` 또는 미확인 `turn` 증가 — 완료된 작업)
   - `🟡 Running` (`working` — 진행률 `progress`, 한 줄 요약, 경과 시간만 컴팩트 표시)
   - `⚪ Idle` (`idle` / `finished` — 하단 접이식)
2. **Project × Worktree 매트릭스 뷰**: 프로젝트별 가로 레인에 각 worktree가 컴팩트한 **상태 알약(Status Pill)**으로 나열됩니다. 마우스 호버 또는 키보드 이동(`↑/↓/←/→`)만으로 우측 프리뷰 패널에 **마지막 화면 5줄 + `git diff --shortstat` + 변경 파일 목록**이 즉시 표시됩니다.
3. **키보드 퍼스트 네비게이션**:
   - `Alt+N` / `Space`: 다음 액션 필요 항목(`🔴` → `🟢`)으로 즉시 점프
   - `Enter`: 현재 선택 항목에 `xterm.js` 즉석 Attach (우측/하단 드로어)
   - `Esc`: 터미널 Detach(메모리 즉시 회수) 후 관제 보드 복귀
   - `Ctrl+K`: 전역 Command Palette (프로젝트/worktree 3초 생성·삭제·전환)

### 2.2 완료된 작업의 손쉬운 후속 진행
- **인라인 Quick Reply Bar**: 🟢 완료 카드 안에서 터미널을 열지 않고 바로 1줄 프롬프트 입력 → `terminal.send`로 전송 후 자동으로 다음 🟢 카드로 포커스 이동.
- **원클릭 승인/제어**: 🔴 `blocked` 카드에 `[Enter / 승인]`, `[Esc / 중단]`, `[터미널 열기]` 퀵 버튼 (`terminal.keys`, `terminal.interrupt`).
- **원클릭 후속 액션 & 프롬프트 프리셋**: `[Diff 보기]`, `[미리 지정한 검증(test/lint) 실행]`, `[커밋/머지]`, `[Worktree 정리]`, 커스텀 후속 프롬프트 버튼(`1~4`).
- **다음 작업 큐(Next-Task Queue)**: 🟡 작업 중인 카드에 후속 프롬프트를 미리 예약해 두고, `done` 이벤트 수신 시 원클릭 또는 자동 전송.

### 2.3 프로젝트 & Worktree 초고속 CRUD
- **프로젝트 관리**: 로컬 Git 저장소 등록(폴더 선택/드래그/경로 입력), 색상 태그, 기본 AI 템플릿(`templates.list` 연동), 부트스트랩 훅 설정(`.env` 복사, 심볼릭 링크 대상, 초기 명령), 수정/삭제.
- **Worktree 원스톱 생성**: `Ctrl+K` → 브랜치명 입력 → `git worktree add` → 부트스트랩 훅 자동 실행 → 선택한 AI CLI 템플릿으로 `terminal.run` + 라벨(`jjdr.project`, `jjdr.worktree`, `jjdr.branch`) 자동 태깅.
- **안전한 원클릭 정리 (Safe Teardown)**: 머지 완료 여부(`git branch --merged`) 자동 배지 표시, 미커밋 변경사항 안전 가드 후 `terminal.kill` → `terminal.rm` → `git worktree remove` → 선택적 브랜치 삭제까지 원클릭 처리.

### 2.4 차별화 스마트 기능
- **머지 충돌 사전 경보 (Merge Overlap Radar, 옵션)**: 서로 다른 worktree(독립 디렉토리)라 작업 중 파일 잠금은 없지만, **같은 상대 경로 파일**(예: 두 worktree 모두 `src/App.tsx` 수정)을 각각 변경 중일 때 추후 `main` 머지 시 충돌 위험을 미리 뱃지로 알려줍니다.
- **Stuck(멈춤) 감지**: `working` 상태에서 설정 시간(기본 5분) 이상 `status_ms` 및 파일 변경이 없으면 경고 표시.
- **트레이 카운터 & 피로 방지 알림**: `🔴 Needs You`만 OS 알림(선택), `🟢 Ready`는 조용히 트레이 툴팁/배지 카운터 갱신.

### 2.5 앱 종료·재실행 시 기존 세션 무손실 복원 (Session Persistence & Rehydration)
여러 프로젝트·다수 worktree에서 `claude`, `gemini`, `codex` 등의 AI CLI를 돌리다가 **`jjdr` 앱을 종료 후 재실행해도 기존 세션이 그대로 열리고 이어서 작업**할 수 있어야 합니다.
1. **앱 종료 시 세션 생존 보장**: `terminal.run` 호출 시 항상 `outlive_parent: true` / `no_parent: true`로 실행하고, 앱 종료 시 `hc connect`만 Detach하여 `herdr-core` 데몬 및 실행 중인 터미널은 절대 종료하지 않습니다.
2. **재실행 시 1초 자동 복원**: 재연결 시 `events.subscribe` 초기 스냅샷(`terminals`) + `doc.get("jjdr.projects.v1" / "jjdr.ui_state.v1")`로 프로젝트/뷰/선택 상태를 복원합니다. 1차 `labels`(`jjdr.project`, `jjdr.worktree`), 2차 `terminal.cwd` 경로 매칭으로 외부(`hc` / `herdr-app`)에서 띄운 세션까지 자동 귀속하고, 종료 직전 Attach 중이던 터미널은 자동 `terminal.attach`로 화면까지 그대로 복원합니다.
3. **종료된 세션 빠른 재개**: OS 재부팅 등으로 끝난 세션도 마지막 명령을 기억해 원클릭 재개를 지원합니다.

---

## 3. 프로토콜 & 성능·메모리 아키텍처

### 3.1 `herdr-core` 외부 연동 전략 (`HerdrClient`)
- **전송 계층**: Rust 백엔드가 `hc connect` 프로세스를 spawn하고 `stdin`/`stdout`으로 공식 바이너리 Framed 프로토콜(`[channel u32 LE][kind u8][len u32 LE][payload]`)을 직접 멀티플렉싱합니다.
  - 시작 시 `hc server status` 확인 → 꺼져 있으면 `hc server start` 자동 기동(또는 안내) → `hello(framed: true)` 핸드셰이크로 버전 및 지원 메서드 검증.
  - 연결 끊김 시 지수 백오프로 자동 재연결 + `events.subscribe` 스냅샷 재동기화.
- **메타데이터 저장**: `herdr-core`의 `doc.get` / `doc.set` (`jjdr.projects.v1`, `jjdr.settings.v1` 네임스페이스)에 원자적 저장 + 로컬 백업 캐시 유지.
- **저비용 프리뷰 수집**: `events.subscribe`에서 `status`/`turn`/`finished` 변화가 발생할 때만 Rust 비동기 태스크가 `terminal.read(lines: 0)`으로 화면 스냅샷을 1회 취득 (폴링 금지).

### 3.2 성능 & 코드 품질 가드레일
- **UI 메인 스레드 보호**: Rust Tokio 워커 + Frontend Web Worker(`dashboardWorker.ts`) + React Zustand atomic selector / `React.memo` / `@tanstack/react-virtual`.
- **Zero-Blur 고성능 UI**: `backdrop-filter: blur()` 및 무거운 shadow/filter 전면 금지.
- **모듈화 원칙**: 모든 소스 파일 900줄 이하 유지.
- **문서화**: 파일/UI/로직 변경 시마다 루트 `APP_MAP.md` 즉시 동기화.

---

## 4. 단계별 마일스톤

### Phase 1: 프로젝트 골격 & `herdr-core` 실시간 연결 (Foundation)
1. Tauri v2 + React + Vite + TypeScript + Tailwind(Zero-Blur 테마) 프로젝트 초기화
2. Rust `herdr/` 모듈 구현: `hc connect` Framed 프로토콜 코덱, `hello` 핸드셰이크, `events.subscribe` 실시간 구독, `terminal.list` / `terminal.read` / `templates.list` 연동, 30ms 이벤트 배치 emitter
3. 앱 상단 `herdr-core` 연결 상태 배너 + 현재 실행 중인 실제 `hc` 터미널 실시간 목록/OSC 7501 상태 표시 검증

### Phase 2: 프로젝트 & Worktree 초고속 CRUD + Git 워커
1. Rust `git/` 모듈: `worktree list/add/remove`, `diff --shortstat`, 수정 파일 목록, `merged` 판별, 부트스트랩 훅 실행
2. `doc.get/set` (`jjdr.projects.v1`) 기반 프로젝트/설정 영속화
3. `CommandPalette (Ctrl+K)` + 프로젝트 CRUD 모달 + Worktree 3초 생성(브랜치+부트스트랩+AI 실행) & 안전한 원클릭 정리

### Phase 3: 인지 부하 제로 관제 보드 & 후속 작업 UX
1. `dashboardWorker.ts` (Web Worker): Attention 우선순위 정렬(`🔴`/`🟢`/`🟡`/`⚪`), Stuck 감지, 파일 충돌 레이더, Fuzzy 검색
2. **Attention Queue 뷰** + **Project × Worktree 매트릭스 뷰** + 제로클릭 호버/키보드 프리뷰
3. 카드 내 **Quick Reply Bar** (`terminal.send`), 원클릭 승인/중단(`terminal.keys`/`interrupt`), 프롬프트 프리셋, **Next-Task Queue**

### Phase 4: 방식 C 즉석 단일 터미널 Attach & 마무리 최적화
1. `terminal.attach` 바이너리 채널 ↔ Rust ↔ `xterm.js` (Canvas/WebGL + FitAddon) 실시간 스트리밍 + `RESIZE`/`CREDIT`/`CLOSE` 흐름 제어
2. 전환 시 즉시 Detach/메모리 회수 + 외부 터미널 팝아웃(`hc attach`) + 시스템 트레이 상태 카운터
3. **성능·메모리 검증**: 다중 세션 스트레스 테스트, `APP_MAP.md` 최종 검증, `docs/test_results_*.txt` 기록
