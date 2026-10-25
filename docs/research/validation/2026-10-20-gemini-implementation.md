# Gemini 한도 조회 모듈 구현

2026-10-20 사용자 요청: 유료 계정 검증 없이 CodeBurn·AICap 참고 방식으로 Gemini 구현 진행.

## 범위와 근거

- 구현: `src/providers/gemini-quota.mjs`, 시험: `tests/gemini-quota.test.mjs`.
- CodeBurn v0.9.27 `src/quota/gemini.ts`의 API 순서와 응답 필드를 참고해 독립 작성했다. 참고 소스를 런타임 의존성으로 사용하지 않는다.
- AICap의 사용률·초기화 표시 개념은 참고하지만 Google 기능을 Gemini CLI API 구현의 입증 사례로 취급하지 않는다.
- 기존 Node 환경에서 실행하는 백엔드 전용 독립 모듈이다. 전체 앱 스택을 Node로 확정한 것은 아니며 Tauri/Rust 앱 연결은 미구현이다. 프런트엔드에서 인증 파일을 읽거나 이 모듈을 실행하지 않는다.
- 로컬 Gemini 세션 토큰 파서와 화면 구현은 이번 한도 모듈에 포함하지 않는다.

## 계약

`fetchGeminiQuota({credentialPath, signal})`을 호출한다. 사용자 동의와 명시적인 출처 선택은 앱 연결 계층 책임이며 경로 생략 시 파일이나 네트워크에 접근하지 않는다.

반환: provider, state, windows, 성공/부분 성공의 fetchedAt, 확인 가능한 planLabel. 각 창은 modelId, usedPercent(0~100), resetsAt(null 가능)을 제공한다. 같은 모델의 서로 다른 창을 합치거나 계정 전체로 평균내지 않는다. 인증 토큰·원문 오류는 반환·기록하지 않는다.

상태: not-connected, authentication-required, success, partial, invalid-response, unsupported, access-denied, rate-limited, request-failed, cancelled, timeout. 429는 retryAt을 제공한다. 이전 성공값 보존과 retryAt까지 호출을 막는 스케줄러는 상위 계층에서 구현해야 한다.

인증 파일 최대 64KiB, 읽기 전용. 자체 OAuth refresh, 로그인 실행, 인증 쓰기 없음. 401에서 같은 출처를 한 번만 다시 읽고 변경된 토큰으로만 재시도한다. quota 단계에서 토큰이 변경되면 이전 프로젝트를 재사용하지 않고 loadCodeAssist부터 다시 진행한다. 두 API에 같은 30초 요청 예산과 취소 신호를 사용한다. 고정 HTTPS endpoint와 redirect 차단을 적용한다.

프로젝트가 없는 경우 빈 body 조회는 CodeBurn 선례를 따르는 미검증 경로다. 지원 계정 판정은 유료 여부 추정 대신 실제 API 응답을 따른다. 미지원 오류가 HTTP 200에 포함되어도 성공 처리하지 않는다.

## 검증 결과

실행: `node --test tests/gemini-quota.test.mjs` → 6 tests, 6 pass, 0 fail.

- 정상 비율, 동일 모델 창 보존, 누락/잘못된 비율/초기화 시각.
- 고정 endpoint·redirect 차단 옵션, project 전달, 임시 인증 파일 불변, 결과의 비밀정보 제외.
- 미연결·손상·크기 초과 인증에서 요청 없음.
- 401 동일 토큰 중단 및 quota 도중 변경 토큰의 프로젝트 재탐색.
- 각 API 단계의 403/500/미지원/비 JSON 응답.
- Retry-After 초·HTTP 날짜, 사전 취소, 네트워크 오류.

실제 Google 요청과 사용자 인증 접근은 하지 않았다. 실제 30초 경과 시험, 운영 스케줄러·UI 통합, Google 계정별 응답 검증은 미완료다. 기존 필수 3개 실조회 출시 조건은 유지한다.
