# jjdr GUI / UI 리디자인 계획서 — "Calm Precision"

현재 UI가 "네모네모하고 알록달록한 웹페이지"처럼 보이는 원인을 뿌리부터 걷어내고, **Linear · Zed · Raycast** 같은 하이엔드 네이티브 데스크톱 툴의 **"Calm Precision (고요한 정밀함)"** 디자인 시스템으로 전면 탈바꿈합니다.

## 1. 핵심 디자인 원칙
1. **보더리스(Borderless) 섹션 그룹핑**: 프로젝트 외곽 박스와 사이드바 중첩 박스를 없애고 여백(Whitespace)과 타이포그래피 위계로만 구분.
2. **95% 모노크롬 + 5% 시맨틱 시그널**: 타일 배경 전체를 초록/빨강/파랑으로 칠하던 방식을 폐기. 모든 타일은 통일된 다크 그라파이트 서피스(`#14171d`)를 유지하고, **좌측 3px 액센트 바 & 마이크로 LED 도트**로만 상태 표현.
3. **Recessed Idle**: 대기/미실행 타일은 `opacity-65`로 차분히 가라앉히고, `🔴 Action`과 `🟢 Ready`만 선명하게 부각.
4. **메타데이터 다이어트**: `main`, `mrg`, `agy`, 상단 카운터의 알록달록한 네모 박스를 제거하고 `tabular-nums` 모노스페이스 텍스트와 일체형 캡슐(Segmented Pill)로 정돈.
5. **Zero-Blur 고성능 유지**: `backdrop-filter: blur()` 없이 정교한 1px 헤어라인(`rgba(255,255,255,0.06)`)과 명도 레이어링만으로 고급감 구현.

## 2. 대상 파일
- `src/index.css`: Calm Precision 컬러 변수 및 `tabular-nums` 타이포그래피 유틸
- `src/components/shared/StatusBadge.tsx`: 미니멀 LED 도트 + 정제된 상태 필
- `src/components/layout/TopStatusBar.tsx`: 일체형 상태 캡슐 + 슬림 툴바
- `src/components/layout/SidebarProjects.tsx`: 중첩 박스 없는 네이티브 플랫 리스트
- `src/components/board/RadarBoardView.tsx` & `RadarTile.tsx`: 보더리스 섹션 + 좌측 액센트 바 타일 + Recessed Idle
- `src/components/attention/AttentionBoard.tsx` & `SessionCard.tsx`: 동일한 서피스/액센트 디자인 통일
- `src/components/terminal/AttachedTerminalDrawer.tsx`: 일체형 미니멀 헤더 + 라운드 프리셋 필
- `src/components/modals/*.tsx`: 모노크롬 그라파이트 모달 테마 통일
