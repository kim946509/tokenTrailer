# CodeBurn 0.9.27 시각화·데스크톱·트레이 분석

조사일 2026-10-19. 공개 태그 소스 `source-v0.9.27`, commit `7ecc87f8adb2719482cf4a382605761102b34870`. 아래 경로/줄은 이 체크아웃 기준이다. 앱을 실행하거나 개인 로그를 읽지 않았다. npm 배포와 공개 태그의 일치 검증은 별도 상위 조사에서 다룬다.

## 핵심 결론

CodeBurn은 하나의 동일한 화면이 아니다. 터미널, 로컬 웹 대시보드, Electron 데스크톱, macOS 네이티브 메뉴바, Windows Tauri 트레이/Capacity Dock에 정보 배치와 일부 기능 차이가 있다. **웹 대시보드에는 비용/토큰 전환, 시간대별 그래프와 장치별 집계가 이미 있다.** 따라서 'CodeBurn은 토큰 시각화가 없다'가 아니라, 어떤 표면에서 어떤 질문을 풀기 어려운지 구분해야 한다.

## 1. 화면 표면과 OS 지원

| 표면 | 구현/근거 | 범위와 제한 |
|---|---|---|
| 터미널 TUI | src/dashboard.tsx:603,628,675 | 비용·모델·프로젝트·일별 활동. Ink 기반 별도 UI |
| 웹 대시보드 | src/web-dashboard.ts:48,102,414,422; dash/src/App.tsx | 로컬 React 대시보드를 127.0.0.1 서버로 제공. 브라우저 UI이며 Electron 페이지와 별개 |
| 데스크톱 | app/electron/main.ts:1,261; app/renderer/components/Sidebar.tsx:8 | Electron BrowserWindow + React. Overview, Sessions, PR, Spend, Models, Optimize, Compare, Periods, Plans, Settings, Plugins |
| macOS 메뉴바 | docs/menubar.md:9,11 | native Swift/SwiftUI. 비용 텍스트 및 팝오버; 기간/통계/요금제 등. 이 조사에서는 Swift 상세 함수 미분석 |
| Windows 트레이 | windows/src-tauri/src/lib.rs:417,604 | 별도 Tauri companion. 불꽃 아이콘과 숫자를 그린 추가 아이콘, 팝오버 |
| Capacity Dock | windows/src-tauri/src/dock.rs:5,1387 | 화면 가장자리의 한도 ring/hover UI. 작업표시줄 내부 임베딩과 다름 |
| Linux | docs/menubar.md:90,100 | GNOME45+ extension 지원; Tauri Linux는 experimental/unreleased라는 태그 문서 설명 |

문서의 광고 표현과 코드가 같은 뜻인지 주의한다. docs/menubar.md:66의 'tray number'는 실제 텍스트 작업표시줄 영역이 아니라 작은 숫자 비트맵 아이콘이다.

## 2. 웹 대시보드: 언제 많이 썼나

- 기본 지표는 cost (`dash/src/App.tsx:475`)이며 cost/tokens 버튼을 제공한다(:647-654).
- 개별 장치 차트는 일별 모델 누적막대 또는 granular timeline을 사용한다(`dash/src/components/UsageChart.tsx:277-285,312-352`). granular 값은 unit에 따라 tokens 또는 cost를 선택한다(:111,136).
- 시간 구간은 <=48시간은 15분, <=8일은 1시간, 그 이상은 1일(`src/granular-history.ts:74-80`). 기간을 늘리면 세부 해상도가 낮아지는 설계다.
- Spend punchcard는 요일 7 × 시간 24 칸이며 비용을 합친다(`dash/src/components/Punchcard.tsx:33-42`). daily bucket이면 시간대가 모두 자정처럼 보이지 않도록 안내만 표시한다(:48-62).
- punchcard는 **비용 전용**이다. 전체 cost/tokens 스위치가 모든 패널의 지표까지 통일하는 것은 아니다.
- legacy daily 토큰 값은 inputTokens + outputTokens(:284-285). 캐시까지 포함한 총계와 같은 의미로 임의 해석하면 안 된다. 상세 수집/계산 정의는 데이터 조사와 결합해야 한다.
- 모델·도구·프로젝트·activity·subagent·workflow 패널이 분리되어 있다(`dash/src/App.tsx:157,160,197,219,226,248,254`).

## 3. 데스크톱: 어떤 작업에서 많이 썼나

데스크톱 Overview는 비용 중심이다. DailyChart의 세로 높이와 peak 선택은 day.cost 기준(`app/renderer/sections/Overview.tsx:783-828`). ActivityHeatmap 역시 비용의 상대 강도(:별도 components/ActivityHeatmap.tsx:53-55,86-91)다. 토큰은 금액에 hover/focus할 때 나타나는 popover가 공통 구현(`components/Usd.tsx:61-107`)이며 입력/출력/cache read/cache write/calls를 분리한다. 금액 우선 탐색과 토큰 우선 탐색의 거리가 존재한다.

드릴다운은 실질적으로 구현되어 있다.

- 일별 막대 → 해당 날짜 활성 세션.
- 비싼 세션 → 바로 상세 drawer.
- 모델·작업 범주·프로젝트·PR → 필터된 세션.
- 같은 차원 선택은 union, 다른 차원은 intersection (`docs/drill-through.md:9-23`).
- 선택 기여 비용과 해당 세션 전체 비용을 분리한다(:27-35). 전체 세션 비용을 선택 부분 비용으로 과대 표시하지 않는 중요한 설계다.
- 원본 세부 정보가 없어서 기여를 계산할 수 없는 세션은 제외 수를 표시하고 0으로 만들지 않는다(:43-46).
- drawer는 모델, 범주, branch, day, PR 분해와 토큰 요약을 제공한다(`components/SessionDrawer.tsx:97,145-173`).
- 프로젝트 확장 → View sessions는 checkout별 canonical ID를 사용한다(`sections/Spend.tsx:219-251`). Spend에는 Sankey도 존재(:196-202).
- 작업 범주는 사용자 확정 작업명과 동일하지 않다. classifier는 도구 패턴과 메시지 키워드, earliest-match heuristic을 사용한다(`src/classifier.ts:61,97-137`). 분류 결과는 추정임을 요구사항에서 분리할 가치가 있다.

## 4. 현재 PC와 여러 PC

웹은 개별 장치와 All devices 뷰를 제공한다(`dash/src/App.tsx:714-727,827-829`). 전체 차트는 장치별 stacked bars(`components/UsageChart.tsx:357-389`)다. 원격 장치는 project/session detail이 제거된 요약으로 표시한다(`dash/src/App.tsx:76-77,226-229`). 주기적으로 다른 장치를 다시 당겨오는 경로(:491-494)가 있고, 응답 payload가 있는 장치만 본문에 넣는다(:521-525).

이것은 '연결해 수집한 장치들의 합계'이며, 같은 계정의 모든 PC나 웹 사용량을 보장하는 분모가 아니다. 장치별 숫자/그래프와 계정 전체 대비 개인 기여 %는 다른 요구사항이다. 동일 계정/기간/토큰 정의와 누락 장치를 확인하지 않고 공유 계정 점유율로 바꾸면 안 된다.

## 5. Windows 작업표시줄·트레이의 실제 구현

AICap의 SetParent 작업표시줄 호스트와 다르다.

1. Tauri TrayIconBuilder로 보조 숫자 아이콘을 등록한다(`windows/src-tauri/src/lib.rs:417`).
2. 짧은 비용 문자열을 현재 작은 아이콘 크기와 taskbar theme에 맞춰 비트맵으로 그린다(:604-617).
3. Windows에서 보이는 아이콘만 수정 가능하므로 set_visible(true) 다음 set_icon을 호출한다(:618-621).
4. 두 아이콘의 tooltip을 함께 갱신한다(:590-596).
5. 마지막 상태를 저장해서 초기 CLI 갱신 전에 복원한다(:777-794). 오래된 상태를 무조건 재사용하지 않는 mtime 검사 코드와 테스트가 존재(`tray_status.rs:114-128,375-376`).

Capacity Dock은 장식 없는 투명 always-on-top 창이며 skip_taskbar=true(`dock.rs:1387-1399`). 모니터 work area와 scale을 계산(:814-840)하고 taskbar 이동/숨김에 따른 레이아웃 변화를 고려하는 코드(:1264)가 있다. 작업표시줄 내부에 붙이는 창이 아니므로 Explorer 자식창 구조에 대한 직접 의존이 줄어드는 설계로 해석할 수 있다. 실제로 더 안정적이라는 비교 실험은 하지 않았다.

자동 시작은 HKCU Run 등록이다(`autostart.rs:11-46`). is_enabled는 reg query 성공 여부를 반환하며, StartupApproved 상태·실제 로그인 실행까지 입증하지 않는다. 숫자 아이콘이 숨김 영역으로 이동하는 문제나 Explorer 재시작 복구의 최종 동작은 이 조사에서 검증하지 않았다.

새로고침은 백그라운드 CLI spawn 비용을 고려한다. 실제 코드 기본값은 열린 팝오버30초, AC idle120초, battery150초, 절전300초(`refresh.rs:11-14,31-57`). docs/menubar.md:66에는 열림60초라고 되어 있어 **문서와 코드 차이**가 있다. 코드 기준으로 보고해야 한다. 잠금/화면 꺼짐 및 원본 변경 없음일 때 fetch를 skip하는 경로도 있다(:108-124). 관련 테스트는 존재하나 이번 조사에서는 실행하지 않았다.

## 6. 어렵게 느껴질 수 있는 구체적 이유 — 해석

사용자 경험 보고를 코드와 비교한 설계 해석이며 사용성 실험 결과가 아니다.

- 비용 질문 중심의 기본 화면: 토큰을 보려면 웹 unit을 바꾸거나 데스크톱 금액 popover를 열어야 한다.
- 표면별 비일관성: 웹은 시간대·장치별 그래프, 데스크톱은 세션 드릴다운·비용 분석이 두드러진다. 기능이 있어도 찾는 경로가 달라진다.
- 많은 분석 축: 비용/토큰/한도, 모델/도구/프로젝트/작업 범주/PR/세션, 기간과 필터 기여량까지 학습해야 한다.
- 기간에 따라 15분→시간→일로 바뀌며 punchcard는 비용 전용이다. 그래프가 답하는 질문과 집계 단위를 이해해야 한다.
- '작업'이 자동 분류 범주, 세션, 프로젝트, PR로 나뉜다. 사용자에게는 한 가지 작업인데 서로 다른 축에 흩어질 수 있다.

## 7. TokenTrailer 요구사항 후보 — 미확정

- 기본 화면에서 '언제' 그래프와 '무슨 작업' 목록을 나란히 두고 선택한 구간이 목록을 필터링하게 한다.
- 토큰 수/요금제 사용률/비용을 분리하고 선택 지표가 적용되는 패널을 명확히 한다. cache 포함 범위도 표시한다.
- 날짜/시간 클릭 → 프로젝트 → 세션으로 일관되게 이동하고, 선택 기여량과 세션 총량을 구분한다.
- 자동 분류 작업명은 추정으로 표시하고 원래 프로젝트·세션 식별자를 잃지 않는다.
- 현재 PC와 수집된 PC 합계를 먼저 정확히 구분한다. 계정 전체 분모가 확보된 경우에만 점유율을 제공한다.
- Windows 기본 트레이 숫자 비트맵과 작업표시줄 내장 위젯은 다른 옵션임을 명시한다. 자동 시작 등록/실제 프로세스/표면 표시/데이터 최신 상태를 구분해 진단 가능하게 한다.

이 후보들은 요구사항 문서를 승인 없이 변경하거나 구현하도록 확정한 내용이 아니다.

## 미검증

실제 앱 렌더링·접근성·차트 가독성·Explorer 재시작·부팅·DPI·다중 모니터·수면 복귀 테스트는 하지 않았다. 공개 태그 소스 분석이며 사용자가 체험한 버전/표면과 일치하는지는 별도 확인이 필요하다.
