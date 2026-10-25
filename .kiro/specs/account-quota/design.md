# 계정 한도 수집 설계

2026-10-20 후속: 사용자 요청에 따라 Gemini 독립 한도 모듈을 구현하고 합성 테스트를 통과했다. [작업 현황](tasks.md). 아래 초기 설계 상태와 달리 해당 모듈 구현은 진행되었으며, 전체 앱 연결과 Gemini 실계정 검증은 남아 있다.

상태: 사용자 검토용 설계안 · 작성 2026-10-19 / 수정 2026-10-20. 기존 로그인 읽기·원래 도구의 인증 갱신 방식은 2026-10-20 승인되었다. 요금제별 지원 행렬과 나머지 설계는 검토·검증 대상이다. 이후 사용자 승인 범위에서 Codex 인증 읽기 및 실제 한도 조회를 수행했으며 [검증 보고서](../../../docs/research/validation/2026-10-20-feasibility.md)에 범위를 기록했다. 제품 앱 구현은 하지 않았다.

## 1. 선택과 이유

첫 버전은 **사용자가 연결한 기존 클라이언트 인증 출처를 읽어 제공자 한도 API를 조회**한다. access token은 백엔드 메모리에서만 사용하며 TokenTrailer가 refresh grant를 보내거나 원본 인증 파일을 수정하지 않는다. 인증 갱신은 원래 도구에서 사용자가 수행하고, TokenTrailer는 다음 조회 때 변경된 정보를 다시 읽는다.

이 선택은 구현 선례가 있고, AICap처럼 별도 로그인·토큰 저장·갱신 체계를 처음부터 만들지 않아도 계정 기준 한도를 조회할 수 있기 때문이다. 단점은 원래 도구가 인증을 갱신하지 않으면 조회가 중단된다는 점이다. 무인 장기 사용에서 중단 없는 한도 갱신까지 보장하는 설계는 아니다. 별도 OAuth 로그인이 필요해지면 해당 제공자의 클라이언트 등록·권한·저장·갱신 경로를 조사하고 별도 검토한다.

| 대상 | 한도 수집 방식 | 사용하는 참고 앱과 일치 범위 | 변환 | 선택 이유 |
|---|---|---|---|---|
| Claude Code | 승인된 Claude 설정 홈의 로그인 정보 → OAuth usage API | CodeBurn·CodexBar: 기존 로그인 활용과 API 조회 선례. AICap: 별도 OAuth 로그인 UI와 같은 계열 usage API 단서 | utilization을 사용률로, resets_at을 초기화 시각으로 | 로컬 토큰과 별개인 실제 계정 사용 창을 직접 확보 |
| Codex | 선택된 CODEX_HOME의 ChatGPT 로그인 정보 → wham/usage | CodeBurn·CodexBar: 기존 로그인과 동일 조회 API. AICap: 별도 OAuth 로그인 UI와 wham/usage 단서. 인증 갱신 정책은 앱마다 다름 | used_percent, reset_at, limit_window_seconds | 계정 한도를 조회하면서 TokenTrailer의 원본 인증 파일 쓰기를 배제 |
| Gemini CLI | 지원 요금제의 Gemini CLI OAuth → loadCodeAssist → retrieveUserQuota | CodeBurn·CodexBar: CLI 인증을 이용한 두 API 조회. AICap의 Google/Antigravity는 이 방식의 입증 사례에서 제외 | 모델별 (1 − remainingFraction) × 100 | 서버가 정한 모델별 잔여 비율과 초기화 시각 활용 |
| Kimi Code, 후속 | Kimi 로그인 정보 → coding/v1/usages 후보 | CodeBurn: Kimi quota reader에서 확인. 다른 앱까지 지원 여부를 확대 해석하지 않음 | 확인된 used/limit × 100 | 구현 선례가 있으나 Windows 형식·요금제 실검증 후 확정 |
| Grok Build, 후속 | Grok 로그인 정보 → billing/settings 후보 | CodeBurn: Grok quota reader에서 확인. Grok Bot·Grok 웹은 별도 대상 | creditUsagePercent 또는 확인된 used/cap | 토큰 한도가 아닌 크레딧 한도일 수 있으므로 단위를 유지 |

참고 범위는 AICap 0.7.5의 저장된 REA 근거, CodeBurn 0.9.27 고정 소스, 2026-10-19 확인한 CodexBar 공개 문서다. 표의 앱 목록은 조사한 선례이며 현재 모든 계정에서의 성공 또는 전체 지원 앱 목록을 뜻하지 않는다. 세부 근거 링크는 문서 마지막에 있다.

인증 처리까지 동일한 설계는 아니다. CodeBurn의 Codex reader에는 원본 auth.json 갱신·저장 경로가 있으며 본 설계는 이를 채택하지 않는다. CodexBar의 Codex 문서는 원본 토큰 쓰기를 피하면서 CLI를 통한 복구 경로를 설명하지만, 본 설계는 CLI 자동 실행도 부수효과 검증 전에는 사용하지 않는다. Gemini의 자체 refresh 경로 역시 첫 버전에 채택하지 않는다. AICap은 별도 앱 로그인 방식이므로 기존 CLI 인증 파일 재사용의 근거로 삼지 않는다.

첫 버전의 계정 연결 기본안은 도구별 하나의 명시적으로 선택한 인증 출처다. 계정 자동 전환·모든 브라우저 계정 탐색은 하지 않는다. 여러 계정 동시 표시가 필요한 경우 별도 범위 검토가 필요하다.

## 2. 공통 구조와 데이터 경계

```text
사용자가 출처 연결
  → 백엔드에서 인증 상태·선택 계정 확인
  → 도구별 한도 조회
  → 응답 검증·단위 정규화
  → 계정별 최신 성공 스냅샷 + 현재 조회 상태
  → 대시보드 / 작업표시줄 / 위젯

로컬 기록 → 토큰·시간·프로젝트 분석 (별도 경로)
```

제안 스택인 Tauri/Rust를 채택하면 인증 파일 읽기와 HTTP는 Rust 백엔드가 담당한다. React로는 정규화된 스냅샷만 전달한다. 이 문서는 기술 스택 확정을 대신하지 않는다.

스냅샷의 최소 계약:

| 필드 | 의미 |
|---|---|
| provider, connectionId | 도구와 사용자가 연결한 출처 |
| accountKey, workspaceKey | 검증 가능한 계정/워크스페이스 범위. 미확인 허용, 토큰 자체를 키로 사용하지 않음 |
| planLabel, identityConfidence | 요금제와 계정 식별 근거 수준 |
| windows[] | 창 식별자·명칭·모델 범위·사용률·한도 단위·시작/초기화 시각(없으면 null) |
| fetchedAt, lastAttemptAt | 마지막 성공과 최근 시도를 구분 |
| state, errorCode, retryAt | 성공/갱신 중/오래됨/인증 필요/접근 제한/미지원/잘못된 응답 |

사용률은 0~100 단위다. 알려진 정상 0과 null은 구별한다. 유효 범위를 벗어난 값은 공급자 계약에 초과 의미가 확인된 경우에만 표시하고, 그렇지 않으면 잘못된 응답으로 처리한다. 창이 여러 개면 합산·평균하지 않는다. 표시할 기본 창은 명칭을 붙여 선택하며, 모델별 최대 사용률을 표시하더라도 '계정 전체 사용률'로 이름 붙이지 않는다.

계정 식별을 확정할 수 없는 경우 '선택 출처, 계정 미확인'으로 표시하며 다른 출처와 병합하지 않는다. 토큰 교체 전후 계정 동일성을 확인하지 못하면 이전 스냅샷을 새 연결의 현재 값으로 이어붙이지 않는다. 조회 시작 시 연결 세대 번호를 기록하고 계정/출처 변경 후 늦게 도착한 응답은 폐기한다. 로컬 토큰 기록도 같은 PC에 있다는 이유만으로 현재 계정에 귀속하지 않는다.

## 3. Claude Code

1. 연결 화면에서 선택한 Claude 설정 홈과 읽을 로그인 메타데이터를 설명한다. Windows 기본 후보는 `~/.claude/.credentials.json`이며 사용자 지정 홈은 명시적으로 연결한다. WSL·다른 홈을 자동 탐색해 더 오래 유효한 토큰을 선택하지 않는다.
2. 지원 형식의 `claudeAiOauth.accessToken`과 만료/계정 메타데이터를 읽는다. API key만 있는 출처는 구독 한도 연결로 처리하지 않는다.
3. `GET https://api.anthropic.com/api/oauth/usage`에 Bearer 인증과 검증된 OAuth 헤더를 보낸다. 초기 호환 후보는 `anthropic-beta: oauth-2025-04-20`이다. 선택적 리셋 크레딧 query는 붙이지 않는다.
4. `five_hour`, `seven_day`, 실제 제공된 모델별 창의 `utilization`·`resets_at`을 해석한다. 단기 창이 없으면 없다고 표시하며 주간 값을 단기 창으로 재명명하지 않는다.
5. 요금제는 출처에 확인되는 메타데이터로 표시하되 오래될 수 있음을 구분한다. 같은 토큰의 계정 식별이 필요한 경우 profile 조회를 연결 시 수행하는 후보로 두고 응답 필드·필요 권한을 검증한다. 이름 확인 실패로 정상 한도까지 버리지 않는다.
6. 401이면 동일 출처를 한 번 다시 읽어 access token이 바뀐 경우에만 재조회한다. 여전히 실패하면 인증 필요로 전환한다. 403은 권한·요금제·제공자 거부를 구분 가능한 범위에서 표시하며 만료로 단정하지 않는다.

이유: 서버가 보고하는 사용률을 그대로 보존하고 로그인 생명주기를 Claude Code와 경쟁하지 않는다. CodexBar 문서는 usage 조회에 profile 권한이 필요하다고 설명하므로 모델 요청용 토큰이면 모두 사용할 수 있다고 가정하지 않는다. 브라우저 쿠키 수집·CLI 화면 문자열 파싱·자체 OAuth 로그인은 첫 경로 실패 시 자동 대체하지 않는다.

## 4. Codex CLI·데스크톱

1. 사용자가 선택한 Codex 홈을 연결한다. 명시된 CODEX_HOME을 우선하고 기본 후보는 `~/.codex`다. 홈마다 세션 기록과 인증 출처를 구분한다.
2. 지원되는 `auth.json`의 ChatGPT OAuth access token과 account/workspace 식별 정보를 읽는다. API key 로그인은 같은 구독 한도 연결로 취급하지 않는다.
3. `GET https://chatgpt.com/backend-api/wham/usage`에 Bearer와 확인된 `ChatGPT-Account-Id`를 적용한다. 임의의 프록시 URL에 원래 토큰을 전달하지 않는다.
4. `rate_limit.primary_window`, `secondary_window`, 지원되는 추가 창을 파싱한다. `limit_window_seconds`로 창의 실제 길이를 판단하고 `used_percent`, epoch초 `reset_at`, `plan_type`을 정규화한다.
5. 만료 시 동일 출처 재읽기 후 새 토큰이 있을 때만 한 번 재조회한다. 직접 refresh grant·auth.json 쓰기는 하지 않는다. 사용자에게 원래 Codex에서 로그인 갱신 후 재시도하도록 안내한다.
6. 데스크톱이 같은 홈과 계정을 사용하는 경우 계정 한도 조회를 공유할 수 있으나, 공유 사실을 Windows 버전별로 확인한다. 별도 안전 저장소에만 인증이 있으면 파일이 있다고 가정하지 않고 '인증 출처 미지원'으로 남긴다. 데스크톱 로그 지원과 한도 인증 지원을 각각 시험한다.

**app-server 경로는 검증 후 대안**이다. CodexBar의 `account/read`, `account/rateLimits/read` 선례는 유용하지만 CLI 실행 자체가 인증 자동 갱신이나 파일 쓰기를 유발할 수 있는지 확인해야 한다. read-only sandbox 옵션만으로 인증 파일 불변을 보장하지 않는다. 현재 원본 인증 파일 불변 요구사항 아래에서 무조건 자동 fallback으로 실행하지 않는다. 파일 기반 방식이 사용자 환경을 지원하지 못하면 이 대안의 부수효과를 조사하여 사용자 검토를 받는다.

이유: 한도 조회만을 위해 Codex 프로세스 실행·토큰 회전을 기본 동작에 추가하지 않는다. 단점은 auth.json이 없는 환경과 장기 만료 상황에서 한도 지원이 제한된다는 것이며, 해당 환경을 미지원 표시만 하고 필수 데스크톱 지원 완료로 판정할 수는 없다.

## 5. Gemini CLI와 Google 제품 구분

1. 먼저 Google 로그인 기반 Gemini CLI인지, API key/Vertex 방식인지와 계정 요금제를 확인한다. API key/Vertex를 개인 구독 한도 API에 연결하지 않는다.
2. 지원 계정은 선택한 `~/.gemini/oauth_creds.json`의 access token을 읽는다.
3. `POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`로 요금제와 quota project를 확인한다. 초기 body 후보는 `{metadata:{ideType:'GEMINI_CLI',pluginType:'GEMINI'}}`다.
4. 같은 계정으로 `:retrieveUserQuota`를 호출한다. 검증된 project가 있으면 `{project}`를 쓰며 없을 때 `{}`가 허용되는지는 지원 계정 시험에서 확인한다. 임의 다른 Cloud 프로젝트를 탐색해 선택하지 않는다.
5. `buckets[].modelId`, `remainingFraction`, `resetTime`을 파싱한다. 잔여 0.7은 사용 30%다. 동일 모델에 서로 다른 창이 있으면 창 의미를 확인하기 전 임의 합산/병합하지 않는다.
6. 만료 시 자체 Google refresh를 하지 않고 원래 Gemini 클라이언트의 인증 갱신 후 재시도한다. CLI 패키지에서 OAuth client secret을 추출하는 별도 기능은 만들지 않는다.
7. loadCodeAssist의 HTTP 성공만으로 지원 성공을 판정하지 않는다. ineligible tier, unsupported client, 실제 quota 결과를 함께 검사하고 원인을 구분한다.

**조건부 지원:** Google 공식 문서는 2026-06-18부터 개인용·AI Pro·Ultra의 Gemini CLI Google 로그인 지원 종료를 안내한다. Standard/Enterprise는 별도 일정이므로 해당 계정도 현재 지원 여부를 검증해야 한다. 따라서 제품의 지원 행렬에서 계정 유형별 조회 가능성을 확인하며, 개발 요청자의 개인 요금제에 지원 범위를 한정하지 않는다. 사용자가 Gemini를 사용하지 않아도 CLI 지원 목표는 유지한다.

Antigravity나 Gemini 웹 한도를 Gemini CLI 대신 보여주지 않는다. 2026-10-20 사용자 결정으로 Gemini CLI만 유지하며 Antigravity 지원 여부는 추후 검토한다. 이 문서는 기존 필수 3개 실조회 출시 조건을 낮추지 않는다. 필요한 Gemini 지원 조합의 실계정 증거가 없으면 미검증으로 남기고, 조회 경로가 없으면 해당 지원 조합의 제약을 보고한다.

## 6. 후속 Kimi·Grok 후보

- Kimi: CodeBurn의 `~/.kimi-code/credentials/kimi-code.json` → `GET https://api.kimi.com/coding/v1/usages` 흐름을 참고한다. Kimi CLI/Code별 인증 형식, 실제 할당 단위와 초기화 시각을 Windows 자료로 확인한 후 적용한다. 사용량/한도 분모가 같은 단위일 때만 비율을 만든다.
- Grok Build: `GROK_HOME` 또는 `~/.grok/auth.json` → `https://cli-chat-proxy.grok.com/v1/billing?format=credits` 및 `/v1/settings`가 후보다. 크레딧과 기간을 표시하며 Grok 웹 전체 또는 토큰 사용률로 명명하지 않는다.
- 둘 다 첫 출시 필수에서 제외하고 독립 로그인·refresh·파일 쓰기는 첫 후보 설계에 넣지 않는다. 위 경로는 CodeBurn 고정 버전 선례이며 현재 계정에서의 동작 보장이 아니다.

## 7. 갱신·보안·오류 처리

2026-10-20 사용자 요청에 따라 계정 한도 주기를 선택 가능하게 한다. AICap 선례인 5/15/30/60/300초, 연결별 선택과 기본 300초를 제안한다. 수동 갱신을 제공하고 연결별 진행 요청은 하나로 통합한다. 정상 조회 후 다음 주기를 예약하고 주기 변경 시 이전 타이머를 취소한다. 서버 제한 대기 시 선택 주기보다 retryAt을 우선한다. 절전 복귀 시 오래된 연결을 한 번 갱신하며 누락된 주기를 일괄 실행하지 않는다. UI 캐시/남은 시간 표시는 외부 요청과 분리한다. 상세는 [설정 검토안](../desktop-presence/settings-review.md)을 따른다.

| 상황 | 처리 |
|---|---|
| 정상 응답 | 모든 값 검증 후 스냅샷 교체, 성공 시각 갱신 |
| 정상 응답에서 일부 창 누락 | 해당 창 미확인/미제공. 과거 값을 현재 창처럼 유지하지 않음 |
| 네트워크/5xx/시간 초과 | 이전 성공값+오래됨 유지, 제안 1/5/15분 상한 재시도 |
| 429 | Retry-After 존중. 없으면 5분 대기 제안. 수동 갱신도 대기 제한 적용 |
| 401 | 동일 출처 재읽기, 바뀐 토큰일 때 한 번만 재조회; 이후 인증 필요 |
| 403/미지원 요금제 | 이유 표시, 공격적 반복 재조회 중단. 사용자 수정·재연결 후 시도 |
| 형식 변화 | 확인 가능한 창만 부분 상태로 제공. 필수 구조가 불명확하면 전체 해석 실패 |
| 초기화 예정 시각 통과 | 재조회 예약. 성공 전에는 0%로 바꾸지 않음 |
| 연결 해제/계정 변경 | 진행 요청 취소·세대 증가·메모리 인증 참조 해제, 이전 계정 응답 폐기 |

전체 연결 요청은 30초 timeout 제안이다. 다단계 Gemini 호출에도 총 예산을 적용한다. 동일 자격정보로 반복 401 루프나 UI의 1초 외부 polling은 없다.

파일은 명시적으로 연결한 출처만 크기 제한·형식 검증 후 읽는다. 읽기 중 교체/불완전 JSON이면 짧게 재읽고 정상 파일을 빈 설정으로 오인하지 않는다. 비밀정보는 앱 DB·진단 로그·프런트엔드로 전달하지 않는다. 전체 HTTP 응답/헤더를 로그로 남기지 않고 정제된 오류 코드만 기록한다. 원본 파일 전체를 메모리에 읽을 수는 있으나 refresh token은 요청·저장에 사용하지 않는다. 일반 문자열 메모리의 완전 삭제까지 보장한다고 표현하지 않는다.

HTTP는 제공자별 고정 HTTPS 호스트만 허용한다. 인증 헤더를 가진 요청의 외부 호스트 redirect는 차단한다. 일반 설정에 적힌 임의 서버 주소로 인증정보를 보내지 않는다. 앱 전용 서버는 필요 없으며 제공자에게 직접 조회한다.

## 8. 검증과 남은 결정

| 요구사항 | 검증 |
|---|---|
| AQ-01 | 동의 전 인증 미접근, 계정 변경 중 늦은 응답 폐기, 종료/해제 후 조회 중단, 원본 파일 해시 불변 |
| AQ-02 | 0%·null·초과·여러 창·단위 불일치·unknown plan 합성 응답 검증 |
| AQ-03 | 401 새 토큰/같은 토큰, 403, 429, 시간 초과, 초기화 통과, 부분 응답, 계정 교체 시험 |
| AQ-04 | 필수 도구별 승인된 Windows 버전·요금제의 실제 조회와 공식 화면/원래 클라이언트 표시 대조 |
| V-05 | 원본 로그·설정·인증 파일 불변, 비밀정보가 UI·DB·로그에 남지 않는지 검증 |

실계정 시험 시 계정 식별·요금제·창·시각·사용률만 최소 증거로 기록하고 토큰 원문은 남기지 않는다. 시차/반올림 때문에 생기는 차이는 동일 창·가까운 조회 시각으로 비교한다. 모의 응답 통과만으로 실조회 검증을 대체하지 않는다.

승인 반영: 기존 로그인 읽기와 원래 도구에 갱신을 맡기는 방식, Gemini CLI만 지원 목표 유지. 남은 것은 사용자 개인 요금제 결정이 아니라 도구별 지원 행렬과 실제 검증이다. Codex 데스크톱 버전·인증 저장 방식, 다른 계정 유형, Gemini 실계정 조회를 검증해야 한다. 일부 조합의 성공을 제품 전체 출시 가능으로 판정하지 않는다.

## 근거

- [AICap 정적 분석](../../../docs/research/aicap/providers-analysis.md): 별도 OAuth UI, 사용률 표시, 백엔드 캐시. 전체 네이티브 변환·실계정 성공은 미검증.
- [CodeBurn 고정 소스](https://github.com/getagentseal/codeburn/tree/7ecc87f8adb2719482cf4a382605761102b34870/src/quota): v0.9.27의 도구별 인증·조회·변환 선례. 자체 refresh/writeback은 본 설계에 채택하지 않음.
- [CodexBar Codex](https://github.com/steipete/CodexBar/blob/main/docs/codex.md), [Claude](https://github.com/steipete/CodexBar/blob/main/docs/claude.md): 2026-10-19 확인한 공개 구현 설명이며 main은 변경 가능.
- [Google 공식 consumer 계정 안내](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals): 2026-10-19 확인. Gemini 지원 범위의 조건 근거.
