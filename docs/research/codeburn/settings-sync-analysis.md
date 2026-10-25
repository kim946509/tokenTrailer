# CodeBurn 0.9.27 설정·동기화·개인정보·부가기능 분석

분석 대상은 배포 npm sourcemap에서 복원한 `mapped-source/src`다. 아래 파일 경로는 해당 src 기준이며 줄 번호는 복원 소스의 실제 줄 번호다. 앱·쿼터·MCP를 실행하지 않았고 개인 로그/인증파일을 열지 않았다. 따라서 코드 경로는 확인했지만 서버 응답/OS별 실행 성공은 검증하지 않았다.

## 현재 PC와 여러 기기 합계

- `sharing/host.ts:177-205`는 현재 기기(local ID)와 페어링한 모든 원격기기(인증서 fingerprint ID)에서 동일 query로 사용량을 가져온다. 원격 실패는 개별 error 행으로 격리한다. 원격 데이터는 수신 시에도 sanitize한다.
- `sharing/host.ts:51-114`는 current의 cost/calls/input/output/cache를 합산한다. totalTokens = input+output+cacheCreate+cacheRead. 구버전 peer에 current cache필드가 없으면 기간에 해당하는 daily cache를 합산한다. `??`라 실제0과 누락은 구분한다.
- combined는 **응답 가능한 기기의 합**이다. error기기는 합계에서 제외하고 deviceCount/reachableCount를 보존한다. raw error행에는 수치0이 있으나 `renderDevices:224-231`는 오류문구와 '-'로 표시한다.
- **기기간 호출·세션 중복 제거는 이 경로에 없다.** host.ts:99-102도 cross-device identity contract가 없으므로 세션합을 unique나 하한치로 표시하면 안 된다고 명시한다. 페어링 목록의 fingerprint 중복 제거(host.ts:148-150)는 기기 중복 제거이지 사용량 이벤트 중복 제거가 아니다.
- 이 합계는 계정 전체 제공자 서버 합계가 아니다. 여러 PC에서 같은 로그/계정 기반 CSV를 중복 수집하면 과대합산 가능하고 꺼진 PC는 빠진다. 따라서 PC 비율을 만든다면 '현재 연결·집계된 기기 중 비율'이라는 분모가 맞다. 동일계정 조건을 이 레이어에서 검증하지 않는다. 현재PC=현재사용자 개인이라는 증명도 없다.

## 네트워크 경로는 두 가지를 구분해야 함

### 직접 기기 공유(sharing)

- `sharing/share-server.ts:27-36,58-61,168-170`: HTTPS 서버, 기본listen 0.0.0.0, bearer token과 클라이언트 인증서 fingerprint가 같은 paired peer여야 usage 허용.
- `sharing/client.ts:24-60`: self-signed TLS 허용 후 fingerprint pinning 검사. 단순 공개 HTTP가 아니며 최초 신뢰는 페어링에 의존한다. host.ts:125-175에 PIN 방식 및 화면 코드 승인 방식 존재.
- `sharing/store.ts:31-53`: peer/token 및 remote 목록 파일을 owner-only 0600으로 저장하려는 구현. Windows ACL 실효성은 확인하지 않았다.
- `sharing/sanitize.ts:9-43`: liveSessions, branch/PR rows를 제거하고 topProjects/topSessions/sessionSeries/points.sessions를 비운다. 모델·도구·작업·서브에이전트·스킬·MCP서버 집계명은 유지한다. 사용자 정의 스킬명 등에 고객명이 있으면 전달될 수 있다는 소스 주석도 있다.
- 중요 한계: sanitizer는 전체 payload를 `...rest`로 복사하고 특정 항목만 제거하는 방식이다. 앞으로 추가되는 식별필드를 자동 차단하는 allowlist는 아니다. 이 코드만으로 모든 개인정보가 제거된다고 보장하면 안 된다.

### 중앙 수집기로 push(sync)

- `sync/config.ts:12-51`: 별도 baseUrl/clientId/tracesPath/issuer/lastSync/auto 저장. 기본 tracesPath /v1/traces. 기기끼리 합산하는 공유와 별개의 기능이다.
- `sync/otlp.ts:261-350`, `sync/consent.ts:12-39`: 공급자·모델·입출력/cache토큰·비용·속도·프로젝트 basename·도구·추정여부·기기ID·coverage·선택적 작업매칭/commit/PR 등의 OTLP 필드가 나간다. LAN 공유보다 상세한 항목이 나간다. 원시 prompt나 전체경로를 이 코어 serializer가 보내는 경로는 확인되지 않았다. plugin enrichment도 있으므로 '어떤 설정에서도 원문이 절대 안 나감'으로 확장할 수 없다.
- `sync/otlp.ts:51-58`: device_id는 **SHA256(hostname:username)의 앞16hex**다. consent.ts:29의 'stable random identifier' 설명과 다르다. 무작위 UUID가 아니며 호스트/사용자명 변경시 달라진다.
- `sync/otlp.ts:63-68`: span ID는 deduplicationKey hash, trace ID는 sessionId hash. `sync/push.ts:305-322,437-488`은 로컬 sent-ledger를 뺀 호출만 POST하고 성공시 기록. 부분거부 batch는 ledger에 기록하지 않음(387부근). 이 ledger와 수신측 중복처리 계약은 직접 기기 combined의 중복제거를 제공하지 않는다.
- `sync/consent.ts:48-63,100-111`, `sync/cli.ts:807-836`: 수신처·필드·범위·주기·작업매칭의 acceptance fingerprint를 비교하고 변경되면 자동push 보류. daily/hourly scheduler, kill switch, receipts 존재. 실제 사용자 동의/스케줄 설치는 실행하지 않음.
- `sync/credentials.ts:1-20`: OS keychain/libsecret/DPAPI 또는 파일 fallback; 플랫폼 실효성은 미검증. config와 token 저장 분리.

## 계정 한도와 로컬 토큰 사용량

- `quota/index.ts:79-94`에 Claude/Codex/Gemini/Copilot/Antigravity/Kimi/Cursor/Z.ai/ZCode/Grok/GrokBot/ClinePass/Devin/CommandCode reader가 등록된다. 프로바이더별 연결상태/플랜/usedPct/reset windows를 반환한다(:112-151). **이 비율은 계정 한도이며, PC 토큰 수/기기 합계 비율이 아니다.**
- Claude: `quota/claude.ts:9,51,95,164` 로컬 파일/가능시 Keychain credential로 OAuth usage 조회. 다른 Claude config directory별 quota/today도 별도 표시 가능한 코드(`quota/index.ts:48-75,157-190`).
- Codex: `quota/codex.ts:8-9,439-500,514-540` wham/usage. 특히 만료/오래된 토큰은 OAuth refresh 후 **auth.json에 회전된 token을 저장**한다. quota 명령도 read-only로 취급하면 안 된다. 저장 직전 계보/계정변경 검증이 있지만 실패시 재로그인 경고 경로 존재. 분석 중 실행하지 않았다.
- Gemini: `quota/gemini.ts:69-79,139-165` loadCodeAssist/retrieveUserQuota와 필요시 OAuth refresh. refresh 결과는 메모리 사용, CLI 파일은 수정하지 않는 설계.
- Grok: `quota/grok.ts:18-19,181-192` CLI billing/settings 조회, Kimi: `quota/kimi.ts:19,55,159-169` coding usage 조회. 두 reader는 token self-refresh/파일쓰기를 하지 않고 만료시 원래 CLI 실행 요구.
- `cursor-sync.ts:17,166-212`: Cursor 계정 CSV export를 cookie로 다운로드하는 별도 경로 존재. config.cursorSync=false 또는 CODEBURN_CURSOR_SYNC=0으로 자동동작 비활성 가능(:69). 이 데이터는 로컬 로그만 읽는 범주와 다르므로 계정 전체/현재PC 경계를 검토해야 한다.

## 설정·지속 저장

- `config.ts:25-90`: 표시통화, 플랜·예산, 모델별칭/가격override, 여러 Claude설정 디렉터리, 로컬모델 가상절감비용, flat-rate, proxyPaths, 프로젝트연결, gateway 합산포함, Cursor sync 설정. gateway 일집계는 로컬호출과 매칭 불가하므로 기본 headline 합계 제외(:75-90).
- `config.ts:107-125` ~/.config/codeburn/config.json, 읽기실패 빈설정 fallback; 저장은 임시파일+rename 경로. `cache-dir.ts:10-13` CODEBURN_CACHE_DIR 또는 ~/.cache/codeburn.
- `sync/ledger.ts:19-24,81-85` sync-ledger.json 원자적 갱신. `sync/config.ts:29-31,87-100` receipts.jsonl. `sharing/store.ts` 별도 peers/remotes 저장. 전체 저장소/스키마 점검은 parser 담당 분석과 합쳐야 함.

## 관측 외 선택적 작업 기능

- `act/cli.ts:13-19,43-69,69-96,107` 적용이력·undo·프로젝트모델권장값적용·효과보고. `act/apply.ts:16-35,46-76` 백업→검증→파일이동/쓰기→journal; `undo --force`는 drift보호 우회옵션. 단순뷰어에 머물지 않는 기능군.
- `guard/cli.ts:156-179` Claude Code 설정에 hook 설치/제거, 프로젝트기본 또는 --global/--project, 선택적 statusline. `guard/hooks.ts:60-75` hardUSD 초과시 PreToolUse deny, softUSD 최초경고, `guard allow`로 해당 세션 cap해제. Stop을 강제차단하지 않는 설계(:24-25). 전체 제공자 공통 지출차단이라고 부르면 안 된다.
- `mcp/server.ts:17-21,47-77`: stdio MCP get_usage/get_savings, 현재기기 데이터, 최대6개월, 프로젝트명 기본 가명화. `mcp/redact.ts:9-30` salt+hash 기반 가명. include_project_names=true로 실제명 제공 가능. 서버 자체의 로컬집계와 MCP클라이언트/모델로 결과 전달은 구분해야 한다.
- `update.ts:255,406,427` npm 버전조회·release feed/플랫폼별업데이트 경로. 앱 Electron UI 설정 전체는 이 src source-map 범위만으로 모두 확인할 수 없다.

## TokenTrailer에 대한 시사점(요구사항 확정 아님)

1. 현재PC/연결된기기합/계정한도는 별도 scope로 표시하고 deviceCount/reachableCount·기간·freshness를 함께 유지해야 한다.
2. 같은 이벤트가 여러 기기에 있을 때의 전역 식별/중복제거 없이는 '계정전체에서 내PC 몇%'라고 주장할 수 없다.
3. 로컬분석·기기공유·조직서버push·quota조회·자동개입은 데이터 이동/쓰기 범위가 다르다. 특히 Codex quota 갱신은 인증파일 쓰기를 포함한다.
4. 유용한 참조점은 실패기기 별도표시, cache포함 토큰정의, sync동의 fingerprint, action journal/undo다. 실제 채택은 사용자 요구사항 검토 대상이다.

검증하지 않은 것: 실제 로그인/API/네트워크 전송, pairing, 서버중복제거, OS keychain/ACL, Electron/macOS 앱 전체설정 UI. 원본 앱/설정/개인파일은 변경하지 않았다.
