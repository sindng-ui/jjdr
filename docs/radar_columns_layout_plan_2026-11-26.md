# Radar 모드 세로 컬럼(Kanban) 하이브리드 레이아웃 구현 계획서

> **작성일**: 2026-11-26  
> **대상 워크스페이스**: `k:\Antigravity_Projects\gitbase\jjdr`  
> **목표**: Radar 모드의 기본 레이아웃을 **세로 컬럼(Columns, 칸반 스타일)** 으로 전환하여 우측 터미널 오픈/리사이즈 시 카드 리플로우(4열→2열 섞임)를 원천 차단하고, **`Columns | Rows` 토글(`localStorage` 영속화)** + **밀도별 컬럼 폭·자동 가로 패닝** + **초미니 Zen 몬스터 아바타 연동**을 적용한다.

---

## 1. 핵심 설계 (하이브리드 1 + 2 + 3)

### ① `Columns | Rows` 레이아웃 토글 & 로컬 영속화 (`src/utils/radarLayout.ts`)
- `RadarLayoutMode = "columns" | "rows"` — **기본값 `"columns"`**.
- `localStorage` 키: `"jjdr.radar_layout"` (`readStoredRadarLayout`, `writeStoredRadarLayout`).
- Radar 보드 상단 우측에 초미니 Pill 토글(`Columns` | `Rows`) 배치 (추가 세로 공간 0, 1클릭 전환 & 즉시 저장).
- `Rows` 선택 시 기존 가로 스택 레이아웃과 100% 동일하게 동작(리그레션 제로).

### ② 세로 컬럼(Kanban) 구조 + 밀도 매핑 + 자동 가로 패닝
- **기존 밀도 프리셋 → 컬럼 폭 자동 매핑**:
  - `comfortable`: `308px`
  - `balanced`: `276px` (기본)
  - `compact`: `244px`
- **보드 컨테이너 (`Columns` 모드)**:
  - `flex-1 min-h-0 flex items-stretch gap-3.5 overflow-x-auto overflow-y-hidden`
  - 보드 빈 영역에서 `Shift+Wheel` 또는 세로 스크롤 불가 영역 마우스 휠 시 부드러운 가로 스크롤 지원.
- **프로젝트 컬럼 ([ProjectTray.tsx](../src/components/board/ProjectTray.tsx))**:
  - 고정 폭(`columnWidthPx`) + `h-full flex flex-col min-h-0`
  - **2줄 컴팩트 Sticky 헤더**:
    - 1줄: 프로젝트 컬러 배지 + 이름 + Worktree 개수 + 접기 버튼 + `+` 추가 버튼
    - 2줄: `Action`/`Ready`/`Run` 상태 카운트 뱃지 + 컴팩트 `ROOT` 칩
  - 접힘(`collapsed`) 상태 시 슬림 세로 바(`w-14`)로 축소해 가로 공간 절약.
  - 내부 Worktree 리스트: `flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5` (컬럼별 독립 세로 스크롤, 리플로우 0!).
- **외부 쉘 트레이 ([ExternalShellTray.tsx](../src/components/board/ExternalShellTray.tsx))**:
  - `Columns` 모드에서는 동일한 고정 폭 세로 컬럼으로 맨 우측에 나란히 배치.
- **자동 가로 패닝 & 2D 방향키 탐색 보강**:
  - 카드 클릭·터미널 오픈·키보드 이동 시 `scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })`로 선택 컬럼이 화면 안으로 자동 패닝.
  - [spatialNav.ts](../src/utils/spatialNav.ts): 수직(`↑↓`) 이동 시 수평 겹침(같은 컬럼) 우선 점수를 보강해 컬럼 끝에서 옆 컬럼으로 오점프 방지; 수평(`←→`) 이동은 인접 컬럼의 가장 가까운 높이 카드로 자연스럽게 이동.

### ③ Radar 타일 초미니 Zen 몬스터 아이콘 연동 & 영문 UI 통일
- [RadarTile.tsx](../src/components/board/RadarTile.tsx)의 Worktree 제목 좌측에 `getWorkerPersona(normWtPath)` 기반 **20×20 Zero-Blur `<WorkerMonsterAvatar />`** 표시 (`alert` / `working` / `ready` / `sleeping` 상태 표정 동기화 + 툴팁에 몬스터 이름 병기).
- Zen 모드와 Radar 모드 간 동일 일꾼(`Mochi`, `Boba` 등) 즉시 시각 연계.
- 수정 대상 Radar 컴포넌트(`RadarBoardView`, `ProjectTray`, `RadarTile`, `ExternalShellTray`)의 잔여 한글 UI 문구 영문화.

---

## 2. 변경 파일 목록

| 구분 | 파일 | 역할 |
| :--- | :--- | :--- |
| **신규** | `src/utils/radarLayout.ts` | `RadarLayoutMode`, `localStorage` 읽기/쓰기(기본 `"columns"`), 밀도별 컬럼 폭 매핑 |
| **신규** | `src/utils/radarLayout.test.ts` | 기본값·영속화·밀도별 폭 단위 테스트 |
| **수정** | `src/components/board/RadarBoardView.tsx` | 상단 `Columns \| Rows` 토글, `Columns` 가로 컨테이너 + 휠 가로 패닝 + 선택 카드 자동 가로 패닝 |
| **수정** | `src/components/board/ProjectTray.tsx` | `layout` prop 지원, 컬럼 모드 2줄 Sticky 헤더 + 슬림 접힘 바 + 독립 세로 스크롤 |
| **수정** | `src/components/board/ExternalShellTray.tsx` | `layout` prop 지원 (컬럼 모드 세로 배치) |
| **수정** | `src/components/board/RadarTile.tsx` | 초미니 20px `WorkerMonsterAvatar` + 툴팁 몬스터명 + 클릭 시 `inline: "nearest"` 패닝 + 영문 UI |
| **수정** | `src/utils/spatialNav.ts` & `spatialNav.test.ts` | 세로 컬럼 `↑↓` 같은 컬럼 우선 및 `←→` 인접 컬럼 이동 정교화 + 테스트 추가 |
| **수정** | `src/utils/shortcutActions.ts` | `scrollIntoView`에 `inline: "nearest"` 추가 |
| **수정** | `APP_MAP.md` | 신규/수정 모듈 인터페이스 반영 |

---

## 3. 성능 & 검증 체크리스트
- [ ] **Zero-Blur 원칙**: 신규/수정 UI에 blur 일체 미사용.
- [ ] **메모이제이션**: `WorkerMonsterAvatar` (`React.memo`), `getWorkerPersona` (`useMemo`), Atomic Boolean Selector 유지.
- [ ] **900줄 제한**: 모든 파일 900줄 미만 유지.
- [ ] **검증**: `npm run test` 전체 통과 + `npm run build` 무오류 + `docs/test_results_2026-11-26.txt` 기록.
