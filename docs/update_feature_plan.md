# jjdr GitHub Releases 자동 업데이트 기능 구현 계획서

> 작성일: 2026-11-26  
> 목표: 앱 실행 시 GitHub Releases(`sindng-ui/jjdr`)에 더 높은 버전이 배포되었는지 비동기로 확인하고, **What's New(Markdown 렌더링) + 업데이트 버튼 + Skip 버튼**을 제공하는 업데이트 팝업과 **자동화·수동 E2E 테스트 체계**를 구축합니다.

---

## 1. 아키텍처 & 동작 흐름

### 1-1. 전체 플로우
1. **비동기 시작 체크 (Zero-blocking)**:
   - 앱 초기 Hydration(`useHerdrSync`) 완료 후 약 **2.5초 지연** 뒤 백그라운드에서 단 1회 `check_for_update(manual: false)` 호출.
   - 네트워크 오프라인 / 타임아웃(8초) / GitHub API Rate Limit(403) 시에는 앱 사용을 방해하지 않고 조용히 무시 (수동 확인 시에만 친절한 토스트 표시).
2. **Rust 백엔드 GitHub Releases 조회 (`src-tauri/src/update/`)**:
   - `GET https://api.github.com/repos/sindng-ui/jjdr/releases/latest` (환경변수 `JJDR_UPDATE_FEED_URL`로 오버라이드 가능 — 테스트용).
   - 현재 버전은 `app.package_info().version` 기준 (환경변수 `JJDR_CURRENT_VERSION_OVERRIDE`로 오버라이드 가능 — 테스트용).
   - `draft: true` 또는 `prerelease: true` 제외.
   - **정확한 SemVer 숫자 비교**(`0.3.0` < `0.10.0`, `v` 접두사 정규화, prerelease 우선순위 포함).
   - Windows 인스톨러 에셋 자동 선별: `-setup.exe` / `.exe` (NSIS) 우선 → `.msi` 차선 → 없을 경우 `html_url` 브라우저 폴백.
3. **Skip 영속화 (`AppSettings.skipped_update_version`)**:
   - 사용자가 **이 버전 건너뛰기(Skip)** 클릭 시 `settings.skipped_update_version = "<latest_version>"`을 기존 `PersistenceStore`(`herdr doc` + 로컬 `%APPDATA%/jjdr/settings.json`)에 저장.
   - 자동 체크 시 `latest_version == skipped_update_version`이면 팝업을 띄우지 않음.
   - 더 높은 신규 버전(`latest > skipped`)이 출시되거나, 사용자가 수동으로 "업데이트 확인"을 누른 경우에는 다시 팝업 표시.
   - 우측 상단 `X` / `Esc` / **나중에(Later)** 클릭 시 이번 실행에서만 닫고 Skip은 저장하지 않음.
4. **업데이트 실행 (인앱 다운로드 + 무손실 AI 세션 유지)**:
   - **[업데이트]** 클릭 시 Rust `download_and_install_update` 커맨드가 `%TEMP%/jjdr-updates/`로 스트리밍 다운로드하면서 `jjdr:update-progress` 이벤트(진행률 `%`, 다운로드/전체 MB)를 실시간 전송.
   - 다운로드 완료 후 인스톨러(`.exe` 또는 `msiexec /i <.msi>`)를 독립 프로세스로 실행하고 `app.exit(0)` 호출.
   - 기존 `RunEvent::Exit` 훅이 `hc connect`만 clean detach하므로 **업데이트 중에도 `herdr-core`의 실행 중인 모든 AI CLI 세션은 종료되지 않고 그대로 유지됨**.
   - 인스톨러 에셋이 없거나 다운로드 실패 시 **[GitHub에서 직접 다운로드]** 폴백 버튼으로 기본 브라우저 열기 지원.

---

## 2. 모듈별 파일 설계 (모든 파일 350줄 이하 유지)

### Backend (`src-tauri/src/`)
| 파일 | 역할 |
| :--- | :--- |
| `src-tauri/Cargo.toml` | `reqwest` (rustls-tls, json, stream) 의존성 추가 |
| `src-tauri/src/update/mod.rs` | 모듈 export |
| `src-tauri/src/update/semver.rs` | 순수 SemVer 파서/비교(`parse_version`, `is_newer_version`) + 단위 테스트 |
| `src-tauri/src/update/github.rs` | GitHub Releases API 파싱, Windows 에셋 선별, HTTP 체크 & 스트리밍 다운로드 + 로컬 Mock HTTP 통합 테스트 |
| `src-tauri/src/commands/update.rs` | Tauri 커맨드: `check_for_update`, `download_and_install_update`, `open_external_url` |
| `src-tauri/src/store/projects.rs` | `AppSettings`에 `skipped_update_version: Option<String>` 필드 추가 (`#[serde(default)]` 하위 호환) |
| `src-tauri/src/lib.rs` | `pub mod update;` 및 신규 커맨드 3종 등록 |

### Frontend (`src/`)
| 파일 | 역할 |
| :--- | :--- |
| `src/types/domain.ts` | `UpdateCheckResult`, `UpdateProgressEvent`, `AppSettings.skipped_update_version` 타입 추가 |
| `src/services/tauriBridge.ts` | `checkForUpdate`, `downloadAndInstallUpdate`, `openExternalUrl`, `listenUpdateProgress` 래퍼 추가 |
| `src/store/useUiStore.ts` | `updateInfo`, `updateModalOpen`, `setUpdateInfo`, `setUpdateModalOpen` 상태 추가 |
| `src/utils/updatePolicy.ts` | 순수 함수: 팝업 표시 여부(`shouldShowUpdatePopup`), 바이트/진행률 포맷, What's New 폴백 텍스트 + Vitest 테스트 |
| `src/hooks/useUpdateChecker.ts` | 앱 시작 2.5초 후 비동기 자동 체크 + 수동 체크/Skip 헬퍼 훅 |
| `src/components/modals/UpdateModal.tsx` | `React.lazy` 업데이트 팝업: 버전 비교 배지(`v0.3.0 → v0.4.0`), 기존 `renderMarkdownToHtml` + `githubMarkdown.css` 기반 What's New 렌더링, 다운로드 진행률 바, **[업데이트] / [이 버전 건너뛰기(Skip)] / [나중에]** 버튼 |
| `src/components/modals/UpdateSettingsSection.tsx` | `SettingsModal.tsx`(현재 454줄) 500줄 초과 방지를 위한 분리 컴포넌트: 현재 버전 표시, 수동 업데이트 확인 버튼, Skip된 버전 표시 및 초기화 |
| `src/components/layout/TopStatusBar.tsx` | 새 버전 감지 시 은은한 업데이트 알림 pill 배지 표시 (클릭 시 팝업 재오픈) |
| `src/components/modals/CommandPalette.tsx` | `Check for Updates` 항목 추가 (+ DEV 모드 전용 `Preview Update Modal (Mock)` 항목) |
| `src/hooks/useGlobalShortcuts.ts` | `Esc` 닫기 및 `Alt+Enter` 가드에 `updateModalOpen` 반영 |
| `src/App.tsx` | `useUpdateChecker()` 호출 및 `Suspense` + `React.lazy(UpdateModal)` 마운트 |

### CI/CD & 테스트 인프라
| 파일 | 역할 |
| :--- | :--- |
| `.github/workflows/release.yml` | (선택) 이전 태그~현재 커밋 로그 기반 What's New 자동 생성 및 `releaseBody` 주입 |
| `scripts/mock-update-server.mjs` | 로컬 E2E 수동 테스트용 Mock GitHub Release API + 가짜 인스톨러 스트리밍 서버 (`npm run test:update-mock`) |
| `docs/update_test_guide.md` | 단위/통합 테스트 실행법 + 로컬 Mock 서버 기반 E2E 수동 테스트 시나리오 가이드 |

---

## 3. 다층 테스트 전략 (Testing Plan)

### Layer 1 — Rust 단위 & 로컬 Mock HTTP 통합 테스트 (`cargo test`)
- **SemVer 비교 테스트**: `0.3.0 < 0.3.1`, `0.3.0 < 0.10.0`, `v0.4.0 > 0.3.9`, `0.4.0-rc.1 < 0.4.0`, 동일/구버전 `false`, 잘못된 문자열 안전 처리.
- **GitHub JSON 파싱 & 에셋 선별 테스트**: `.exe` + `.msi` 동시 존재 시 `.exe` 우선, `.msi`만 존재 시 `.msi` 선택, `draft`/`prerelease` 무시.
- **로컬 `tokio::net::TcpListener` Mock HTTP 통합 테스트**:
  - `200 OK` (새 버전 존재) → `has_update == true`, What's New / asset URL 정상 추출 검증.
  - `200 OK` (동일/구버전) → `has_update == false`.
  - `404` / `500` / 잘못된 JSON → 안전한 `Err` 반환 (패닉 없음).
  - 가짜 바이너리 스트리밍 다운로드 → 청크 진행률 콜백 및 임시 파일 크기·무결성 검증.

### Layer 2 — Frontend 단위 테스트 (`npm run test` / Vitest)
- `src/utils/updatePolicy.test.ts`:
  - `has_update: false` → 팝업 미표시.
  - `has_update: true`, `skipped_update_version === latest_version` → 자동 체크 시 미표시, 수동 체크 시 표시.
  - `has_update: true`, `latest_version > skipped_update_version` → 자동 체크 시 다시 표시.
  - 빈 `release_notes` 폴백 및 바이트/진행률 포맷 검증.

### Layer 3 — 실제 앱 E2E 수동 테스트 (Mock 서버 + DEV 프리뷰)
1. **로컬 Mock 서버 E2E 테스트 (네트워크/실제 GitHub 릴리즈 없이 100% 실제 경로 검증)**:
   - 터미널 1: `npm run test:update-mock` (포트 `18420`에서 `v9.9.9` + 리치 마크다운 What's New + 2MB 가짜 `.exe` 스트리밍 서빙)
   - 터미널 2: `JJDR_UPDATE_FEED_URL=http://127.0.0.1:18420/latest npm run tauri:dev`
   - 검증 항목:
     - 앱 실행 2.5초 후 업데이트 팝업 자동 표시 및 What's New 마크다운 렌더링 확인
     - **Skip** 클릭 → 앱 재실행 시 팝업 미표시 확인 → Settings에서 Skip 초기화 후 수동 체크 시 재표시 확인
     - **업데이트** 클릭 → 진행률 바(0% → 100%) 실시간 상승 확인 (`--dry-run` 또는 가짜 배치 파일로 실제 설치 없이 실행 직전까지 안전 검증 가능)
2. **DEV 모드 원클릭 UI 미리보기**:
   - `npm run tauri:dev` 실행 후 `Ctrl+K` → `Preview Update Modal (Mock)` 선택으로 4종 테마별 팝업 UI/스크롤/버튼을 즉시 점검.

---

## 4. 성능 & 리그레션 체크리스트
- [ ] `UpdateModal`은 `React.lazy`로 분리하여 평소 번들/DOM 오버헤드 0 유지
- [ ] 앱 시작 체크는 2.5초 지연 + 별도 Tokio 비동기 태스크로 초기 렌더 및 `herdr-core` 연결 블로킹 0
- [ ] `SettingsModal.tsx`는 `UpdateSettingsSection.tsx` 분리로 500줄 이하 유지
- [ ] 기존 `renderMarkdownToHtml` + `githubMarkdown.css` 재사용으로 추가 마크다운 의존성 0
- [ ] `AppSettings` 신규 필드는 `#[serde(default)]`로 기존 `settings.json` / `herdr doc`와 100% 하위 호환
- [ ] 완료 후 `cargo test`, `npm run test`, `npm run build` 전체 통과 및 `APP_MAP.md` 업데이트
