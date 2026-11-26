# jjdr 업데이트 기능 테스트 가이드

이 문서는 실제 GitHub에 테스트 릴리즈를 발행하지 않고도 업데이트 기능의 **버전 비교 · What's New 팝업 · Skip 영속화 · 스트리밍 다운로드 · 오류 폴백**을 빠르고 안전하게 검증하는 3단계 테스트 방법을 안내합니다.

---

## 1. 자동화 테스트 (CI / 로컬 단위 + Mock HTTP 통합 테스트)

### Rust 백엔드 테스트 (SemVer + GitHub JSON 파싱 + 로컬 `TcpListener` HTTP 스트리밍)
```bash
cd src-tauri && cargo test update::
```
검증 항목:
- `v` 접두사 / 숫자 대소 비교 (`0.3.0 < 0.10.0`) / prerelease / 잘못된 버전 문자열 방어
- Windows 에셋 선별 (`.exe` 우선 → `.msi` 차선, `.sig` 제외) 및 `draft`/`prerelease` 무시
- Path Traversal 파일명 sanitize
- 로컬 Mock HTTP 서버로 `200 OK`(업데이트 있음/최신), `404` 에러, 청크 스트리밍 다운로드(0% → 100%) 검증

### Frontend 단위 테스트 (Vitest)
```bash
npm run test
```
검증 항목 (`src/utils/updatePolicy.test.ts`):
- `has_update: false`일 때 팝업 미표시
- `skipped_update_version`이 최신 버전과 같으면 자동 체크 시 미표시, 수동 체크 시 표시
- Skip 이후 더 높은 버전(`0.5.0`) 출시 시 자동 팝업 재표시
- 바이트/날짜 포맷 및 빈 릴리즈 노트 폴백

---

## 2. 로컬 Mock 서버 기반 실제 앱 E2E 테스트 (권장)

실제 Tauri 데스크톱 앱에서 **앱 시작 자동 감지 → 팝업 → What's New 렌더링 → Skip 영속화 → 인앱 다운로드 진행률** 전체 경로를 100% 동일하게 테스트합니다.

### 터미널 1: 로컬 Mock 릴리즈 서버 실행
```bash
npm run test:update-mock
```
기본으로 `http://127.0.0.1:18420/latest`에서 `v9.9.9` + 샘플 What's New 마크다운 + 3MB 가짜 인스톨러 스트리밍을 제공합니다.

### 터미널 2: 환경변수를 지정해 `jjdr` 실행 (PowerShell)
```powershell
$env:JJDR_UPDATE_FEED_URL="http://127.0.0.1:18420/latest"
$env:JJDR_UPDATE_DRY_RUN="1"
npm run tauri:dev
```
> **환경변수 설명**
> - `JJDR_UPDATE_FEED_URL`: GitHub API 대신 조회할 테스트 피드 URL
> - `JJDR_UPDATE_DRY_RUN=1`: 다운로드 완료(100%)까지만 검증하고 가짜 인스톨러 실행 및 앱 종료는 생략 (안전 테스트용)
> - `JJDR_CURRENT_VERSION_OVERRIDE`: 현재 앱 버전을 임의로 덮어써서 실제 GitHub 릴리즈(`v0.3.0` 등)를 상대로 테스트하고 싶을 때 사용 (예: `$env:JJDR_CURRENT_VERSION_OVERRIDE="0.0.1"`)

### E2E 시나리오 체크리스트
1. **자동 팝업 확인**: 앱 실행 약 2.5초 후 `v0.3.0 → v9.9.9` 업데이트 팝업과 What's New 마크다운이 자동 표시되는지 확인.
2. **다운로드 진행률 확인**: **[업데이트]** 클릭 → 진행률 바가 `0% → 100%`로 부드럽게 올라가고 `%TEMP%\jjdr-updates\jjdr_9.9.9_x64-setup.exe` 경로와 함께 Dry-run 완료 표시 확인.
3. **Skip 영속화 확인**: **[이 버전 건너뛰기 (Skip)]** 클릭 → 앱 종료 후 재실행 → 팝업이 다시 뜨지 않는지 확인.
4. **수동 확인 & Skip 해제**: Settings → `앱 업데이트` 섹션에서 `건너뛴 버전: v9.9.9` 표시 확인 → **[지금 업데이트 확인]**(Skip 무시하고 팝업 재표시) 및 **[Skip 해제]** 동작 확인.
5. **실패 폴백 테스트**: Mock 서버를 아래 옵션으로 재실행 후 **[업데이트]** 클릭 → 에러 메시지와 **[GitHub에서 직접 다운로드]** 폴백 버튼 확인:
   ```bash
   node scripts/mock-update-server.mjs --fail-download
   ```
6. **최신 버전 테스트**: Mock 서버를 `--version=0.3.0`으로 실행 후 Settings에서 **[지금 업데이트 확인]** → `"최신 버전을 사용 중입니다"` 토스트 확인.

---

## 3. DEV 모드 원클릭 UI 미리보기 (서버 실행 불필요)

1. `npm run tauri:dev` 실행
2. `Ctrl + K` (Command Palette) → `Preview Update Modal (DEV Mock)` 선택, 또는 Settings → `Mock 미리보기` 클릭
3. 4종 테마(`Aurora`, `Lounge`, `Nordic`, `Botanical`)에서 What's New 마크다운과 버튼 레이아웃 즉시 확인 (프로덕션 빌드에서는 자동 제거됨)

---

## 4. 실제 GitHub 릴리즈 대상 실전 테스트

이미 GitHub에 `v0.3.0` 등 릴리즈가 올라가 있다면 Mock 서버 없이 현재 버전만 낮춰서 실제 GitHub API 응답을 검증할 수 있습니다:
```powershell
$env:JJDR_CURRENT_VERSION_OVERRIDE="0.0.1"
$env:JJDR_UPDATE_DRY_RUN="1"
npm run tauri:dev
```
