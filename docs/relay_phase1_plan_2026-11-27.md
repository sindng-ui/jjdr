# Phase 1 구현 계획서: `crates/relay-protocol` + `relay/` (`jjdr-relay`)

> **작성일**: 2026-11-27  
> **기반 스펙**: [pr_auto_review_spec_2026-11-27.md](./pr_auto_review_spec_2026-11-27.md)  
> **목표**: Windows 공용 PC에 단일 파일(`jjdr-relay.exe`)로 배포 가능한 초경량 팀 Relay 서버와, `jjdr` 백엔드(`src-tauri`)가 추후 컴파일 타임에 그대로 공유할 공용 프로토콜 크레이트(`crates/relay-protocol`)를 구축하고, 통합 테스트까지 100% 검증한다.

---

## 1. 아키텍처 & 폴더 구조

기존 `src-tauri` 빌드 및 `.github/workflows/release.yml` Rust 캐시(`./src-tauri -> target`)를 전혀 건드리지 않도록, 독립 Cargo 프로젝트 구조를 채택한다.

```text
jjdr/
├── crates/
│   └── relay-protocol/              # 공용 serde 타입 & 정규화 순수 크레이트 (Zero I/O)
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs               # PROTOCOL_VERSION 및 공용 re-export
│           ├── types.rs             # 도메인 모델 (PeerInfo, ReviewRequestPayload, Status, RejectReason)
│           ├── messages.rs          # WS / REST 요청·응답 봉투 타입
│           └── normalize.rs         # repo_url / github_id 정규화 순수 함수 + 단위 테스트
└── relay/                           # Windows 공용 PC용 단일 바이너리 서버 (jjdr-relay.exe)
    ├── Cargo.toml                   # axum(ws), tokio, rusqlite(bundled), tracing, relay-protocol
    ├── README.md                    # Windows 실행·방화벽·작업 스케줄러 자동 시작 가이드
    ├── src/
    │   ├── main.rs                  # CLI/환경변수 로드, 서버 기동, Ctrl+C Graceful Shutdown
    │   ├── config.rs                # RelayConfig (bind_addr, db_path, team_key, ttl_hours, rate_limit)
    │   ├── auth.rs                  # TEAM_KEY 상수시간 검증 + 유저별 Sliding-Window Rate Limiter
    │   ├── db.rs                    # SQLite WAL 스키마, 인덱스, 비동기 안전(spawn_blocking) CRUD
    │   ├── hub.rs                   # 인메모리 WebSocket 연결 허브, Presence 브로드캐스트, TTL 워커
    │   ├── service.rs               # 비즈니스 로직 & Layer-1 Reject 판정 + Store-and-Forward
    │   └── routes.rs                # REST API (/api/v1/*) + WebSocket (/ws) + /health 라우터
    └── tests/
        └── integration_tests.rs     # 실제 로컬 TCP 포트 + 임시 SQLite 기반 E2E 통합 테스트
```

---

## 2. 공용 프로토콜 설계 (`crates/relay-protocol`)

### 핵심 정규화 규칙 (`normalize.rs`)
- **`normalize_repo_url(raw)`**: 사내 GHE의 다양한 clone 포맷을 단일 키로 정규화
  - `https://github.corp.com/Org/Repo.git` → `github.corp.com/org/repo`
  - `git@github.corp.com:Org/Repo.git` → `github.corp.com/org/repo`
  - `ssh://git@github.corp.com/Org/Repo/` → `github.corp.com/org/repo`
- **`normalize_github_id(raw)`**: 앞의 `@` 제거 + 트림 + 소문자 통일 (`@MinSu` → `minsu`).

### 핵심 도메인 타입 (`types.rs` / `messages.rs`)
- **`PresenceStatus`**: `Online` | `Paused` | `Offline`
- **`PeerInfo`**: `{ github_id, display_name, status, repo_urls: Vec<String>, last_seen_ms }`
- **`ReviewAssignmentStatus`**:
  - `PendingOffline` (오프라인 보관 중)
  - `Delivered` (리뷰어 `jjdr` 수신 완료)
  - `Queued` (리뷰어 로컬 FIFO 큐 대기 중)
  - `Reviewing` (임시 자동 리뷰 일꾼 실행 중)
  - `Completed` (리뷰 완료)
  - `Rejected` (Layer-1 또는 Layer-2 거절)
  - `Failed` (실행/한도 실패)
  - `Cancelled` (작성자 취소)
  - `Expired` (TTL 만료)
- **`RejectReason`**:
  - Layer-1 (Relay): `DuplicateSha`, `ReviewerPaused`, `RepoNotRegistered`, `ExpiredTtl`
  - Layer-2 (리뷰어 `jjdr`): `PrClosed`, `PrMerged`, `PrDraft`, `ExcludedLabel`, `ExcludedBranch`, `ProjectDisabled`, `AuthorNotAllowed`, `QueueFull`, `GhAuthError`, `QuotaExhausted`, `UserDeclined`, `Custom`
- **WebSocket 양방향 메시지**:
  - Client → Server (`ClientMessage`): `Hello { github_id, display_name, status, repo_urls, client_version }`, `UpdatePresence { status, repo_urls }`, `ReportStatus { request_id, status, reject_reason, detail, worker_agent }`, `Ping`
  - Server → Client (`ServerMessage`): `Welcome { server_version, protocol_version, peers }`, `PeersUpdated { peers }`, `ReviewAssigned { request, assignment }`, `AssignmentStatusChanged { request_id, pr_number, repo_url, reviewer_id, status, reject_reason, detail, updated_ms }`, `ReviewCancelled { request_id, pr_number, repo_url, reason }`, `Pong`, `Error { code, message }`

---

## 3. Relay 서버 핵심 설계 (`relay/`)

### ① 성능 & 동시성 (Zero-Blocking & 경량)
- **SQLite WAL 모드 (`PRAGMA journal_mode=WAL; synchronous=NORMAL; busy_timeout=5000`)**: 읽기/쓰기 경합 최소화, 별도 DB 프로세스 없이 단일 파일(`jjdr-relay.db`) 영속화.
- **Tokio 워커 비차단**: 모든 SQLite I/O는 `tokio::task::spawn_blocking`을 통해 전용 블로킹 풀에서 실행하여 WebSocket 이벤트 루프 지연 0ms 유지.
- **인메모리 허브 (`hub.rs`)**: `RwLock<HashMap<String, Vec<ConnHandle>>>` 구조로 동일 유저의 재접속 과도기(이전 소켓 끊기기 전 새 소켓 진입)에도 메시지 유실이나 오프라인 오판 방지.
- **스팸 방어 (`auth.rs`)**: `TEAM_KEY` 상수시간 비교 + 유저별 인메모리 슬라이딩 윈도우 Rate Limiter(기본 분당 30회).

### ② SQLite 스키마 (`db.rs`)
1. **`peers`**: `github_id (PK)`, `display_name`, `presence_status`, `repo_urls_json`, `last_seen_ms`
2. **`review_requests`**: `request_id (PK)`, `repo_url`, `pr_number`, `pr_url`, `pr_title`, `base_branch`, `head_branch`, `head_sha`, `author_id`, `created_ms`
3. **`review_assignments`**: `(request_id, reviewer_id) PK`, `status`, `reject_reason`, `detail`, `worker_agent`, `created_ms`, `updated_ms`, `expires_ms`
   - 인덱스: `(repo_url, pr_number, head_sha, reviewer_id)` (Layer-1 `duplicate_sha` O(log N) 조회), `(reviewer_id, status)` (오프라인 우체통 O(log N) 배달), `(status, expires_ms)` (TTL 만료 스캔).

### ③ Layer-1 Reject & Store-and-Forward 로직 (`service.rs`)
- **리뷰 요청 접수 (`POST /api/v1/reviews`)**:
  - 작성자가 지정한 리뷰어 목록(최대 5명, 기본 2명; 자기 자신/중복 자동 제거)을 순회하며 각각 Layer-1 검증:
    1. 동일 `(repo_url, pr_number, head_sha, reviewer_id)`의 활성/완료 건 존재 → `Rejected(DuplicateSha)`
    2. 등록된 리뷰어 상태가 `Paused` → `Rejected(ReviewerPaused)`
    3. 등록된 리뷰어이고 `repo_urls`가 비어있지 않은데 해당 `repo_url` 미보유 → `Rejected(RepoNotRegistered)` *(아직 한 번도 접속 안 한 미등록 유저에게 보내는 경우엔 오프라인 우체통 보관 또는 설정에 따라 처리 — 기본은 `PendingOffline`으로 보관하고 응답에 `known_peer: false` 안내)*
  - 통과 시 SQLite 저장 후:
    - 리뷰어 온라인 → 즉시 WS `ReviewAssigned` 푸시 + 상태 `Delivered`
    - 리뷰어 오프라인 → 상태 `PendingOffline` 보관 → 추후 리뷰어 `Hello` 접속 시 미배달 건 일괄 푸시 후 `Delivered` 전환!
- **백그라운드 TTL 청소 워커**: 5분 주기 타이머로 `expires_ms < now`인 `PendingOffline` 건을 `Expired(ExpiredTtl)` 전환하고, 작성자가 온라인이면 실시간 `AssignmentStatusChanged` 푸시.

### ④ HTTP API & WebSocket 엔드포인트 (`routes.rs`)
- `GET /health` — 무인증 상태 확인 (`status`, `version`, `online_peers`, `uptime_secs`)
- `GET /ws` — 실시간 양방향 채널 (`X-Team-Key` 헤더 또는 `?team_key=` 쿼리 인증)
- `GET /api/v1/peers` — 팀원 디렉토리 + 상태 + 보유 레포 목록
- `POST /api/v1/reviews` — 리뷰 요청 발송 & 리뷰어별 즉시 결과 반환
- `POST /api/v1/reviews/{request_id}/status` — 리뷰어 상태 보고 (WS 폴백용)
- `POST /api/v1/reviews/{request_id}/cancel` — 작성자 취소 (전체 또는 특정 리뷰어)
- `GET /api/v1/reviews/authored/{github_id}` — 작성자 미니 상태바 복원용 최근 요청 목록
- `GET /api/v1/reviews/inbox/{github_id}` — 리뷰어 미처리 요청 목록

---

## 4. 검증 계획

1. **단위 테스트 (`cargo test --manifest-path crates/relay-protocol/Cargo.toml`)**:
   - HTTPS/SSH/트레일링 슬래시/`.git`/대소문자 포함 사내 GHE URL 정규화 테스트
   - GitHub ID 정규화 및 프로토콜 직렬화/역직렬화 왕복 테스트
2. **통합 테스트 (`cargo test --manifest-path relay/Cargo.toml`)**:
   - 인증 실패(401) 및 `/health` 정상 응답
   - 온라인 2명 리뷰어 지정 → 실시간 WS 수신 → 상태 전환(`Queued → Reviewing → Completed`) → 작성자 WS 실시간 수신
   - 오프라인 리뷰어 Store-and-Forward 보관 → 재접속(`Hello`) 시 자동 배달
   - Layer-1 Reject 4종(`DuplicateSha`, `ReviewerPaused`, `RepoNotRegistered`, `ExpiredTtl`) 검증
   - 리뷰 취소(`Cancel`) → 리뷰어 WS `ReviewCancelled` 수신 및 상태 반영
   - Rate Limit 초과 시 `429 Too Many Requests` 반환
3. **Windows 릴리즈 바이너리 빌드 & 기존 앱 회귀 체크**:
   - `cargo build --release --manifest-path relay/Cargo.toml`로 `relay/target/release/jjdr-relay.exe` 생성 확인
   - 기존 `jjdr` 빌드 무영향 확인 (`cargo check --manifest-path src-tauri/Cargo.toml`)
4. **테스트 결과 기록**: `docs/test_results_2026-11-27_relay_phase1.txt` 저장 및 `APP_MAP.md` 업데이트.
