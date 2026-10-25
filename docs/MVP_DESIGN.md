# 로컬 MVP 설계와 작업 계획

2026-10-20 사용자가 테스트하며 MVP까지 계속 구현하도록 승인했다. 이전 문서의 단계별 검토 대기는 이 구현 범위에 다시 적용하지 않는다. 커밋·배포·타 앱 수정은 범위 밖이다.

## 기술 선택

Electron 44.9.0, 기본 HTML/CSS/JavaScript, Node 파일/HTTP API, Windows PowerShell에서 로드하는 C# Win32 보조 모듈. 기존 Gemini Node 모듈을 재사용하고 Rust/.NET SDK 설치 없이 현재 환경에서 검증한다. Tauri/Rust는 앞선 제안에서 이번 MVP 선택으로 변경한다. 외부 서비스·프런트엔드 프레임워크·차트 라이브러리는 추가하지 않는다.

Electron main은 인증·수집·저장·스케줄링을 맡는다. sandbox/contextIsolation을 켠 renderer에는 제한된 IPC로 정규화된 데이터와 설정만 전달한다. 외부 탐색/새 창은 차단하고 CSP는 로컬 파일만 허용한다. 인증·대화 원문은 DB, renderer, 오류 로그에 저장하지 않는다.

데이터는 앱 userData 아래 원자적 JSON 교체로 저장한다. 최초 전체 수집, 이후 파일 크기·수정 시각이 변경된 파일만 재해석한다. 이벤트 키 upsert로 재수입·복사 중복을 막는다. 삭제는 이벤트와 함께 제외 키를 저장하며 명시적 재수입에서만 제외를 해제한다. 원본이 사라져도 이벤트는 유지한다. 손상 저장소를 빈 파일로 덮어쓰지 않는다.

기본값: 로컬 30초, 계정별 300초(5/15/30/60/300 선택), 오늘/이번 주/이번 달·PC 시간대·월요일 시작. 창 닫기는 상주 유지, 자동 시작은 기본 꺼짐, 위젯 표시/항상 위/위치 저장. 토큰과 한도는 별도 범위로 표시한다.

## 구현 순서와 검증 연결

1. UC: Claude 메시지 usage, Codex 누적 차분, Gemini JSON/JSONL 파서. 불완전/분기 불명확 기록은 상태에 남긴다. 합성 데이터로 중복·누적·손상 시험.
2. UC/UA: 원자적 메타데이터 보존·삭제·재수입, 기간/시간 구간/프로젝트/세션 분석. 재시작과 경계 시각 시험.
3. AQ: Claude/Codex/Gemini 한도, 출처 동의, 갱신 주기·429 대기·연결 변경 시 응답 폐기. 네트워크 없는 fixture 시험과 승인된 실제 조회.
4. UA/DP: 대시보드·위젯·트레이, 설정·자동 시작·명시적 종료. Electron 실제 렌더링 및 IPC 시험.
5. DP: layered child로 주 작업표시줄 직접 표시, UI Automation을 이용한 빈 공간 탐색, 공간 부족 시 실패 표시, 셸 재탐색. 실제 화면 확인. Explorer 강제 종료/재부팅/절전은 자동 시험하지 않는다.

## 출시와 구분

로컬에서 실행할 수 있는 MVP를 제공한다. Gemini 실계정, Windows 배율/다중 모니터/자동 숨김/실제 재로그인 복구 행렬까지 검증하지 않았다면 정식 출시 완료로 표시하지 않는다. 작업표시줄 자식 창은 비공식 셸 통합이므로 Windows 업데이트 후 재검증 대상이다.

보안 근거: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [login settings](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows).
