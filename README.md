# jjdr (`jj + herdr`)

초경량 **Tauri v2 (Rust) + React + Vite** 멀티 프로젝트 · Git Worktree · AI CLI 관제탑 (`herdr-core` / `hc` 외부 데몬 연동).

## 핵심 기능
- **인지 부하 최소화 (Attention-First Queue)**: `herdr-core` OSC 7501 네이티브 상태를 `🔴 Needs You` / `🟢 Ready` / `🟡 Running` / `⚪ Idle`로 자동 분류.
- **제로 클릭 현황 파악 (Matrix + Hover Preview)**: 프로젝트별 가로 레인에 worktree 상태 알약을 표시하고, 호버/키보드 이동만으로 마지막 출력·Diff 통계·변경 파일 목록 즉시 확인.
- **방식 C (하이브리드 터미널)**: 평소 관제는 DOM에 `xterm.js` 0개 + `React.lazy` 코드 스플리팅으로 메모리 최소화. 필요 시 선택한 단일 세션에만 `terminal.attach` Framed Stream을 즉석 부착하고 `Esc`/전환 시 즉시 `CLOSE` + 메모리 회수.
- **앱 재실행 시 세션 무손실 복원**: `outlive_parent: true`, `no_parent: true`, `keep: true`로 실행하고, 앱 종료 시 `hc connect`만 Detach. 재실행 시 `events.subscribe` 스냅샷 + 라벨 + `cwd` 매칭 + `doc.get("jjdr.*")`로 기존 `claude`/`gemini`/`codex` 세션 자동 복원.
- **초고속 프로젝트 & Worktree CRUD**: `Ctrl+K` Command Palette, 3초 worktree 생성 + 부트스트랩 훅(`.env` 복사/초기 명령) + AI 실행, 미커밋 안전 가드 포함 원클릭 Teardown.

## 주요 단축키
- `Alt+N`: 다음 액션 필요 세션(`🔴` → `🟢`)으로 즉시 점프
- `Ctrl+K`: Command Palette (프로젝트/worktree 생성·전환)
- `Ctrl+M`: Attention Queue ↔ Project × Worktree Matrix 전환
- `J / K` 또는 `↑ / ↓`: 세션 목록 이동
- `Enter`: 선택 세션에 실시간 `xterm.js` 즉석 Attach
- `Esc`: 모달 닫기 / 터미널 Detach (메모리 즉시 회수, AI 세션은 계속 실행)

## 실행 방법
> 사전 조건: `herdr-core` / `hc` CLI가 `PATH`에 설치되어 있어야 합니다.

```bash
npm install
npm run tauri:dev
```

프로덕션 빌드:
```bash
npm run tauri:build
```
