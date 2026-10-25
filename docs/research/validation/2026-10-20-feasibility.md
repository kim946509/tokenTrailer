# Codex 데스크톱·작업표시줄 초기 검증

일자: 2026-10-20 KST. 사용자 승인: 기존 로그인 읽기/원래 도구의 갱신 방식 채택, Codex 데스크톱 검증 및 작업표시줄 진행. Gemini CLI 유지, Antigravity 추후 검토. 실제 제품 구현이나 다른 앱 수정은 수행하지 않았다.

후속: 이 문서는 최초 시험 결과다. 이후 [원인 분석과 후속 검증](2026-10-20-taskbar-followup.md)에서 layered 시험 창은 실제 표시됨을 확인했다. 아래 일반 STATIC 창 미표시 결과를 전체 직접 표시 불가능으로 해석하지 않는다.

## 환경

- Windows 11 Pro 25H2, build 26200.9711, 현재 관측 작업표시줄 DPI 96.
- 설치 패키지 OpenAI.Codex 26.1013.4894.0 x64.
- 관측된 데스크톱 세션 메타데이터: originator `Codex Desktop`, source `vscode`, cli_version `0.163.0-alpha.10.2`. 따라서 source=vscode만으로 VS Code 확장이라고 분류하면 안 된다.
- CODEX_HOME 기본 경로에 auth.json, sessions, archived_sessions 존재. 비밀정보·대화 원문은 보고서에 저장하지 않음.

## 결과

| 항목 | 결과 | 의미와 한계 |
|---|---|---|
| 데스크톱 토큰 기록 | 확인 | 최근 최대 30개 기준 실제 29개 파일. 첫 메타데이터 기준 Codex Desktop 10개 파일, 그 파일에서 token_count 251개 확인 |
| 토큰 필드 | 확인 | input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, total_tokens 존재. 포함 관계와 중복 제거 정확성까지 검증한 것은 아님 |
| 계정 한도 직접 조회 | HTTP 200 | 기존 auth.json의 ChatGPT OAuth로 wham/usage 조회. plan_type 및 primary_window의 숫자 사용률·초기화 epoch·창 길이 확인 |
| secondary_window | 응답에 없음 | 모든 계정에서 두 창이 있다고 가정할 수 없음. 미제공을 0%로 만들면 안 됨 |
| 인증 파일 불변 | 확인 | 조회 전후 SHA-256 비교 일치. TokenTrailer probe의 refresh grant·쓰기 없음 |
| 데스크톱 기록과 인증의 계정 동일성 | 미검증 | 같은 홈의 기록/인증 존재만으로 과거 기록을 현재 계정에 귀속하지 않음 |
| 실제 작업표시줄 부모 연결 | 성공 | FindWindow(Shell_TrayWnd), SetParent, GetParent 동일성 확인 |
| 표시 상태·영역 | API상 성공 | IsWindowVisible=true, 창 영역이 작업표시줄 내부, DPI 96 |
| 실제 숫자 표시 | 미충족 | 화면에서 시험 창 영역만 캡처하여 확인했으나 `TT TEST 123K` 글자가 보이지 않았음. API 성공과 시각적 성공은 다름 |
| 시험 창 제거 | 확인 | finally에서 DestroyWindow, 제거 후 IsWindow=false, 스레드 DPI 문맥 복원 |
| 로그인·Explorer 재시작·절전·모니터 변경 복구 | 미검증 | 실제 셸 강제 재시작/로그아웃/재부팅·환경 변경을 하지 않음. 기본 표시부터 미충족이므로 안정성 완료 판정 불가 |

전체 파일의 token_count 관측 수는 수집 중 기록 증가에 따라 첫 실행 4,836개, 두 번째 4,839개였다. 이는 중복 제거된 소비 이벤트 수가 아닌 원시 레코드 수다. 파일의 첫 session_meta만 출처 분류에 사용했고 파일 내부의 반복 메타데이터는 출처별 파일 수에 중복 가산하지 않았다. malformed JSON은 두 실행 모두 0개였다.

## 실행한 검증 도구

- [codex-readonly-probe.mjs](codex-readonly-probe.mjs): 로컬 JSONL에서 메타데이터/usage 필드만 출력. `--quota`를 명시해야 인증 읽기 및 고정 HTTPS usage endpoint 요청 실행. 리다이렉트 차단, 20초 제한, 인증/원문/전체 응답 미출력. 별도 서버/모델 호출 없음.
- [taskbar-attachment-probe.ps1](taskbar-attachment-probe.ps1): 기본 STATIC 시험 창을 실제 작업표시줄에 잠시 연결. 실제 사용량 아닌 합성 문자열만 사용. 시스템 설정·Explorer 창 스타일·자동 시작 등록을 변경하지 않음. 캡처는 시험 영역 160×24만 수행.
- 시각 증거: 실행 시 `%TEMP%/tokentrailer-taskbar-probe.png`에 저장 후 직접 확인. 임시 파일이며 영구 증거 보존을 보장하지 않음.

이 도구들은 일회성 검증용이며 앱의 파서/표시 구현이 아니다. taskbar probe는 공간 확보·기존 아이콘 회피·장기 복구를 구현하지 않았다. 무인 실행/반복 자동화를 위한 도구로 사용하지 않는다.

## 작업표시줄 판단

단순 SetParent 방식만으로 직접 수치 표시를 충족하지 못했다. 현재 증거로는 가림·합성·좌표/렌더링 등 정확한 원인을 확정할 수 없다. AICap의 별도 레이아웃·클리핑 코드가 존재한다는 [기존 분석](../aicap/FOCUSED_NATIVE_ANALYSIS.md)은 참고 근거지만 이번 실패의 원인 증명은 아니다.

후속은 자식 창 자체의 그리기 결과와 화면 합성 결과를 비교하고, 작업표시줄 하위 창과 점유 공간을 읽기 전용으로 조사하는 것이다. 문제 수정·표시 방식 변경은 근거와 구현안을 검토한 후 진행한다. Explorer 재시작으로 일시적으로 보이게 만드는 것을 제품 복구 검증으로 대체하지 않는다.

공식 참고: [Microsoft Taskbar](https://learn.microsoft.com/en-us/windows/win32/shell/taskbar)는 셸 재생성 알림을 설명하며, [DPI awareness](https://learn.microsoft.com/en-us/windows/win32/hidpi/setting-the-default-dpi-awareness-for-a-process)는 DPI 문맥 설정을 설명한다. 이 API 문서가 임의 작업표시줄 자식 창 삽입의 안정성을 보장하지는 않는다.

## 제품 지원 범위와 시험 환경

사용자 개인 요금제를 제품의 지원 기준으로 삼지 않는다. 다음 행렬은 시험의 출발점이며 지원 완료 목록이 아니다.

| 대상 | 검증 조합 | 현재 상태 |
|---|---|---|
| Claude Code | 구독 OAuth의 계정/요금제별 창·권한·만료, API key 구분 | 코드 선례만 확인, 이번 실조회 미실시 |
| Codex | ChatGPT OAuth·계정/워크스페이스·창 구성·저장소 | 현재 PC 한 출처 API 성공. 다른 조합 및 CLI/데스크톱 계정 매핑은 미검증 |
| Gemini CLI | 실제 제공되는 OAuth 유형·요금제, API key/Vertex 구분 | 지원 목표 유지. 사용자가 미사용하므로 이 PC 실계정 증거 없음. 별도 시험 환경 필요 |

Gemini 미검증을 해소하기 위해 사용자에게 개인 가입을 요구하지 않는다. 공개 스키마/비식별 fixture 검증을 진행할 수 있으나 실제 한도 조회 출시 조건을 대신하지 못한다. 지원 불가능한 유형은 근거를 남기고 제품 지원 행렬 검토 대상으로 삼는다. Antigravity나 웹의 수치를 Gemini CLI 수치로 대체하지 않는다.

## 다음 단계에 미치는 영향

- Codex 로컬 토큰 수집과 기존 인증 기반 한도 조회는 구현을 설계할 실환경 근거를 확보했다.
- 직접 작업표시줄 표시는 여전히 기술 검증 과제이며, 트레이 대체나 완료 판정은 하지 않는다.
- D-10은 승인 반영, D-04~D-08·D-11 기본값은 이번 답변으로 일괄 승인된 것으로 처리하지 않는다.
- 인증/환경/원본 앱을 수정하지 않았고, 커밋·설치·배포는 하지 않았다.
