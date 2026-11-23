# jjdr UI/GUI 2차 리디자인 구현 계획 (Aurora Dusk 기본 + 4종 원클릭 테마 스위처)

## 1. 목표
- 기존 Obsidian 테마의 **직선 칸막이(`border-r`, `border-b`)**, **네모난 박스 + 좌측 3px 직선 막대**, **우울한 무채색 암흑 톤**을 완전히 해소한다.
- **Arc / Craft / Things 3 / Claude** 감성의 **Floating Rounded Canvas + Squircle(18px) & Pill(999px)** 조형 언어로 개편한다.
- **Zero-Blur** 원칙(`backdrop-filter: blur()`, `filter: blur()` 0건)을 철저히 지켜 데스크톱 렌더링 성능을 최상으로 유지한다.
- 기본 테마를 **Aurora Dusk (청량한 미드나잇 인디고 다크)**로 설정하고, 설정 모달에서 **4종 테마(Aurora Dusk / Warm Lounge / Nordic Mist / Botanical Slate)**를 원클릭 실시간 전환 & 영구 저장할 수 있게 한다.

## 2. 4종 내장 테마 프리셋 (`data-theme`)
1. `aurora` (**Aurora Dusk**, 기본값): 미드나잇 인디고 쉘 + 은은한 오로라 라디얼 캔버스 + 민트/코랄/스카이 포인트
2. `lounge` (**Warm Lounge**): 따뜻한 에스프레소 차콜 + 크림 아이보리 + 테라코타 앰버 포인트
3. `nordic` (**Nordic Mist**): 눈부심 없는 웜 아이보리·포슬린 라이트 + 소프트 그림자 + 파스텔 포인트 (터미널만 딥 슬레이트 유지)
4. `botanical` (**Botanical Slate**): 저피로 유칼립투스 딥 틸 + 민트 크림 + 살구 골드 포인트

## 3. 단계별 작업 범위
1. **테마 토큰 & 영속화**:
   - `src/utils/themes.ts` (4종 메타데이터 + xterm 팔레트 + DOM 적용 유틸)
   - `src/types/domain.ts`, `src-tauri/src/store/projects.rs` (`AppSettings.theme`, 기본 `"aurora"`)
   - `index.html` (초기 깜빡임 방지 스크립트), `src/index.css` (4종 CSS 변수 + Zero-Blur 유틸리티 클래스), `src-tauri/tauri.conf.json` (`backgroundColor: "#101526"`)
2. **프레임 & 내비게이션 해체**:
   - `src/App.tsx` (외곽 그라데이션 쉘 + 내부 22px 플로팅 라운드 캔버스 + 캡슐 토스트)
   - `src/components/layout/TopStatusBar.tsx` (무경계 통합 타이틀바, `jj` 그라데이션 스퀴클 배지, 캡슐 상태바/검색/세그먼트, 둥근 윈도우 컨트롤)
   - `src/components/layout/SidebarProjects.tsx` (칸막이 선 없는 쉘 사이드바, 캡슐 프로젝트 행, 둥근 단축키 카드)
3. **보드·타일·터미널 스퀴클화**:
   - `src/components/shared/StatusBadge.tsx`, `src/components/shared/HerdrHealthBanner.tsx`
   - `src/components/board/RadarBoardView.tsx`, `src/components/board/RadarTile.tsx` (18px 스퀴클, 소프트 그라데이션 상태 틴트, 점선 대기 카드, 리프트 호버)
   - `src/components/attention/AttentionBoard.tsx`, `src/components/attention/SessionCard.tsx`
   - `src/components/terminal/AttachedTerminalDrawer.tsx` (플로팅 18px 터미널 카드 + 실시간 xterm 테마 동기화)
4. **설정 4종 원클릭 스위처 & 전체 모달 테마 통일**:
   - `src/components/modals/SettingsModal.tsx` (2×2 시각적 미니 프리뷰 테마 카드, 클릭 즉시 실시간 반영 + 저장)
   - `CommandPalette.tsx`, `ProjectModal.tsx`, `CreateWorktreeModal.tsx`, `LaunchSessionModal.tsx`, `TeardownModal.tsx`, `DiffPreviewModal.tsx` (전부 CSS 변수 기반, 라이트/다크 4종 완벽 대응)
5. **검증 & 문서화**:
   - `npm run test`, `npm run build`, `cargo check --offline`
   - 900줄 제한 및 Zero-Blur 확인, `docs/test_results.txt` 및 `APP_MAP.md` 업데이트
