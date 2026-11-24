# 놈팽이 모드 (`Chill` / `Zen` Mode) 구현 계획서

> **작성일**: 2026-11-25  
> **대상 워크스페이스**: `k:\Antigravity_Projects\gitbase\jjdr`

## 1. 철학 & 3대 뷰 모드
- **Radar (`Ctrl+1`)**: 2D 공간 조감도
- **Queue (`Ctrl+2`)**: 1D 우선순위 리스트
- **Chill / 놈팽이 모드 (`Ctrl+3`)**: 0D(Z-축 최상단) 단일 초점 스택 뷰 — 왼쪽에 가장 우선순위 높은 화려하고 큼직한 히어로 카드 1장 + 오른쪽에 해당 카드의 터미널 1개. 유저는 아래에 뭐가 쌓였는지 몰라도 되며, 하나를 처리하면 다음 우선순위 1장으로 부드럽게 전환.

## 2. 핵심 UX 메커니즘
1. **Top-of-Stack 1장 선정**: `byBucket.needs_you` → `byBucket.ready` 최상단 1장(Worktree 중복 제거 기반).
2. **Sticky Lock**: 현재 작업 중인 카드가 여전히 actionable하면 뒤의 변화로 화면이 튀지 않도록 고정.
3. **컨베이어 자동 전환 + Undo 안전망**:
   - 우측 터미널에서 프롬프트 전송/승인 등으로 현재 카드가 `running` 또는 `idle`이 되면 0.6초 완료 피드백 후 다음 최상단 카드로 자동 이동 + 우측 터미널 자동 Attach & 프롬프트 포커스 (`자동 넘김 ON/OFF` 토글 및 `되돌리기` 토스트 제공).
   - 수동 **`✓ 확인 완료 · 다음으로`** (`acknowledgeTurn`) 및 **`→ 나중에 보기 (Skip)`** 지원.
4. **All Clear GUI 브리핑 (처리할 카드 0건)**:
   - Zero-Blur SVG 그래픽 + 진행 중(`running`) 세션 미니 브리핑 바(클릭 시 잠깐 엿보기) + 전체 Idle 현황 요약 + 오늘 클리어 건수 + 새 작업 발생 시 자동 깨어남(Auto-Wakeup).
5. **Distraction-Free**: 놈팽이 모드 진입 시 왼쪽 사이드바 자동 임시 숨김(다른 모드 복귀 시 원복, `Ctrl+B`로 언제든 토글 가능).

## 3. 모듈 설계
- 신규:
  - `src/utils/chillQueue.ts` + `src/utils/chillQueue.test.ts`
  - `src/components/chill/ChillModeView.tsx`
  - `src/components/chill/ChillHeroCard.tsx`
  - `src/components/chill/ChillEmptyBriefing.tsx`
- 수정:
  - `src/store/useUiStore.ts`, `src/components/layout/TopStatusBar.tsx`, `src/hooks/useGlobalShortcuts.ts`, `src/hooks/useHerdrSync.ts`, `src/App.tsx`, `src/components/layout/SidebarProjects.tsx`, `APP_MAP.md`

## 4. 검증 계획
- `npm run test` (`chillQueue.test.ts` 포함 전체 통과)
- `npm run build` (`tsc && vite build` 무오류)
- Zero-Blur / 900줄 제한 / 성능 최종 체크 및 `docs/test_results_2026-11-25_v2.txt` 저장
