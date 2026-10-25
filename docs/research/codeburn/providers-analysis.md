# CodeBurn 0.9.27: 제공자 수집과 집계 분석

대상: npm 배포 `main.js.map`에서 복구한 `mapped-source/src` 소스. 분석일 2026-10-19. 아래 경로·줄 번호는 이 디렉터리 기준이다. 제품 실행, 사용자 세션·계정·인증 파일 열람, 설정 변경은 하지 않았다. '확인'은 배포 소스의 정적 구현을 뜻하며 실제 설치 환경·API 동작 검증과 구분한다.

## 핵심 결론

CodeBurn은 사용자 우선순위인 Claude/Codex/Gemini/Grok/Kimi 모두에 실제 등록된 수집기를 갖고 있다(`providers/index.ts:200`). 그러나 이름은 웹 서비스 전체가 아니라 특정 클라이언트의 로컬 기록 범위다. Grok Build와 Grok Bot, Kimi CLI와 Kimi Code도 별도 수집기다. AICap의 한도 사용률 중심 구조와 달리 요청·턴·세션 단위의 토큰 기록, 모델 단가 기반 비용, 시간별·작업별 집계를 구현한다.

**로컬 파일에서 읽었다는 사실만으로 '이 PC에서 발생한 사용량'이 되지는 않는다.** 특히 Grok Bot의 파일은 원격 에이전트 대화의 로컬 미러이며, Claude Desktop·여러 config root·복사한 로그·WSL도 원본 실행 위치와 구분해야 한다. 계정 전체 토큰이라는 분모나 사용자 개인 귀속 역시 이 수집기들만으로 확보되지 않는다.

## 제공자별 실제 범위

| 제공자 | 읽는 경로와 형태 | 측정/추정과 범위 | 근거 |
|---|---|---|---|
| Claude Code | 기본 `~/.claude/projects`; `CLAUDE_CONFIG_DIRS` → `CLAUDE_CONFIG_DIR` → config의 claudeConfigDirs → 기본값 순. WSL 홈 추가 | assistant usage 입력·출력·cache read/write, 모델·도구·사용자 턴. 복수 config 합산 | providers/claude.ts:82–133, parser.ts:1496–1578 |
| Claude Desktop/Cowork | macOS Application Support 및 Claude-3p; Windows `%APPDATA%/Claude/local-agent-mode-sessions`, MSIX LocalCache 후보. projects와 usage-ledger NDJSON 탐색 | 로그 및 별도 ledger의 model별 usage를 수집. Cowork 공간/폴더/제목 귀속. 웹 Claude 일반 사용 전체를 의미하지 않음 | providers/claude.ts:151–220, 243–395, 453–476 |
| Codex | CODEX_HOME 또는 `~/.codex`; sessions 연/월/일 및 archived_sessions JSONL | token_usage 응답, legacy token_count, 누적차분, 일부 누락 시 문자 기반 추정. 세션 cwd 및 도구를 연결 | providers/codex.ts:188, 608–650, 915–1000, 1347–1513 |
| Gemini CLI | `~/.gemini/tmp/<project>/chats/session-*.json` 또는 JSONL | gemini 메시지의 tokens/model 필수. user 메시지로 턴 구분, 도구 추출. Gemini 웹·모바일 계정 전체 수집 아님 | providers/gemini.ts:67–149, 216–246 |
| Grok Build | GROK_HOME 또는 `~/.grok`의 sessions 및 logs/unified.jsonl | unified inference 실측 우선. 세션 turn_completed 실측 또는 구버전 context curve 추정 | providers/grok.ts:10–29, 52–55, 260–280, 380–452, 469–600 |
| Grok Bot | Windows `%APPDATA%/Grok Bot/sand-client-persistence/*.blob`, macOS·Linux 대응 경로; CODEBURN_GROKBOT_DIR override | 로컬 대화 미러의 문자수/4 추정. 토큰·모델·비용 실측 없음. 주석은 약 최근 200개 transcript entry 미러라고 설명 | providers/grokbot.ts:11–24, 59–70, 137–179, 197–230; token-estimate.ts:1–5 |
| Kimi CLI | KIMI_SHARE_DIR 또는 `~/.kimi/sessions/<workdir>/<session>/wire.jsonl`, subagents 포함 | StatusUpdate의 token_usage/usage 필드. 모델 없으면 config 모델 fallback | providers/kimi.ts:57, 158–164, 206–227, 242–333, 363–384 |
| Kimi Code | KIMI_CODE_HOME 또는 `~/.kimi-code`; macOS embedded Kimi Desktop 경로 추가, sessions/*/*/agents/*/wire.jsonl | usage.record/inputOther/output/inputCacheRead/inputCacheCreation, model alias 해석, 턴/에이전트 연결. 비용은 estimated 표시 | providers/kimicode.ts:86–98, 155–177, 350–409 |

Kimi Code 기본 후보에는 Windows Kimi Desktop 전용 자동 탐색 경로가 없다. Windows 기본 CLI 홈이나 명시적 KIMI_CODE_HOME은 가능하지만 Desktop 지원을 자동 보장하지 않는다.

## 토큰과 비용 단위

1. 공통 표현은 inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, reasoningTokens 등이다. 모델 공급자가 cache/reasoning을 원본 input/output의 부분집합으로 보고하는지에 따라 정규화한다.
2. Codex: input에서 cached를 뺀 fresh input을 만들고, cache write는 남은 input 안에서 clamp한다. 명시적 cache-write 단가가 있는 모델에만 해당 bucket으로 옮긴다. output에는 reasoning이 이미 포함되므로 두 번 더하지 않는다(`providers/codex.ts:915–970`).
3. Gemini: fresh input = max(0,input-cached). output과 thoughts는 별도로 저장하되 비용은 output+thoughts로 계산한다(`providers/gemini.ts:89–137`).
4. Grok: 원본 prompt는 cache를, completion은 reasoning을 포함하므로 각각 차감해 별도 bucket에 저장한다. 일반 집계에서 reasoning을 다시 포함한다(`providers/grok.ts:580–590`, `models.ts:59–66`).
5. `billableOutputTokens`는 Claude/Codex/Copilot/DSH는 output 그대로, 다른 provider는 output+reasoning으로 통일한다(`models.ts:59–66`). 표시와 비용의 이중 계산 방지용이다.
6. `calculateCost`는 per-token 단가, cache read/write, 웹 검색 요청 수, fast/flex, long-context tier를 적용한 USD 값이다. 1시간 cache-write와 5분 cache-write도 분리한다(`models.ts:1516–1575`). **실제 청구서 비용이나 구독 한도 %가 아니다.**
7. 미등록 모델 단가가 없으면 경고 후 비용 0을 반환한다(`models.ts:1528–1540`). 이 숫자만 보고 무료라고 해석하면 안 된다. 다른 집계에 pricing coverage/unpriced 경고가 있어도 원시 cost 필드 단독 소비자는 주의가 필요하다.
8. Codex token_count.info가 없을 때 사용자 prompt 및 output 문자수를 ceil(chars/4)로 추정하고 costIsEstimated=true를 붙인다(`providers/codex.ts:1354–1396`). Grok Bot 역시 같은 추정이다. 이는 토크나이저 실측도 전체 system/tool/context input 추정도 아니다.
9. Grok Bot costIsEstimated는 토큰 자체 추정을 수반하는 반면 Kimi Code의 동일 플래그는 usage.record 토큰을 읽고 모델 단가 비용을 추정하는 경로다. **플래그 하나만으로 토큰 신뢰도를 동일 취급하면 안 된다.**

## 중복 제거와 집계 정확성

- Claude streaming: 같은 message ID의 마지막 record를 보존하되 timestamp는 최초 record 값으로 유지한다(`parser.ts:1658–1679`). 이후 전역 seenMsgIds로 파일 간 중복을 걸러낸다(`parser.ts:1743–1745`). 따라서 비용이 처음 응답 시각에 귀속될 수 있다.
- Claude Desktop ledger와 transcript는 서로 ID가 달라 모델/토큰/시간을 비교해 1:1 매칭하고 transcript를 보존한다. transcript가 없는 ledger는 유지한다(`parser.ts:5761–5807`). 정교한 보정이지만 실제 중복 완전 제거를 런타임으로 검증한 것은 아니다.
- Codex archive는 파일명 중복 발견을 줄이고 call-level dedup을 병행한다(`providers/codex.ts:636–650`). 새 response token usage가 나타난 뒤 legacy token_count twin을 건너뛴다(`1354–1359`).
- legacy Codex는 직전 info의 완전 동일 재전송과 동일 cumulative total을 먼저 제외하고 last_token_usage 우선, 없으면 total-current minus previous를 사용한다. last를 사용했더라도 누적 baseline은 항상 갱신한다(`1420–1475`).
- fork는 parent namespace와 cumulative token breakdown을 key로 사용한다. cumulative가 없는 경우 파일 path+physical offset key로 바꾸며, 소스 자체가 'cross-file replay identity를 추측하지 않는 trade-off'라고 설명한다(`1480–1513`). 어떤 형식에서도 완벽한 fork 중복제거라고 홍보하면 안 된다.
- Gemini는 sessionId + message.id, ID가 없으면 순번 key(`providers/gemini.ts:95–120`). JSON과 JSONL 복사본이 같은 ID를 보존하면 충돌 제거되지만 안정적 ID 없는 재작성 파일의 보장은 약하다.
- Kimi는 session directory basename + message_id 또는 usage 순번(`providers/kimi.ts:248,293–297`). Kimi Code는 sessionId+agentId+줄번호+usage순번(`providers/kimicode.ts:371`). 서로 다른 파일 재작성·동일 ID 복사는 그 키 계약에 따라 달라지므로 원본별 검증이 필요하다.
- Grok Build는 unified log에 session ID가 **하나라도** 있으면 그 세션 디렉터리 전체를 건너뛴다(`providers/grok.ts:386–387`). log가 일부만 남은 경우 디렉터리에만 있는 과거 요청 누락 가능성이 있다. 이는 코드 조건에서 도출한 검토 후보이며 실제 사용자 데이터로 재현하지 않았다.
- Grok Build 세션 fallback은 모든 usage를 한 모델·한 updated_at 시각으로 내보낸다(`providers/grok.ts:397–452`). 요청별 시간 분포나 multi-model 비용 분석이 정확한 unified log 경로와 다르다.
- Grok Bot은 requestId/id로 입력·출력 문자를 묶고 agentId+request key로 dedup한다. bot 이름을 project로 쓴다(`providers/grokbot.ts:137–179,197–230,256–269`). 따라서 '프로젝트별'이라는 동일 라벨이 여기서는 봇별을 뜻한다.

## 언제 많이 썼는가

`granular-history.ts`는 실제 수집 call timestamp를 선택 기간 bucket으로 묶는다. 48시간 이하는 15분, 8일 이하는 1시간, 그 이상은 1일이다(`76–103`). 지역 wall-clock와 해당 timestamp의 offset으로 DST 반복 시간을 구분하고, 일 단위는 로컬 자정을 사용한다.

모델·세션별 cost와 tokens 시리즈를 만들고, 비용 상위 6개와 토큰 상위 6개의 합집합을 유지하며 나머지는 Other로 합산한다(`9,111–121,286–307`). 세션 key는 provider + projectPath + sessionId다(`350–365`).

**이 그래프의 Tokens는 fresh input+raw output만이다**(`granular-history.ts:355–358`). cache와 별도 reasoning은 제외한다. 반면 day aggregator의 output은 billableOutputTokens를 사용하며 cache read/write를 별도 합산한다(`day-aggregator.ts:203–219`). Gemini/Grok에서는 그래프 raw output과 headline의 reasoning 포함 output이 달라질 수 있으므로 지표 정의를 화면에서 설명해야 한다. 이것을 무조건 수치 버그라고 판정하지 않는다.

일별 집계는 작업 분류·turn 수를 사용자 turn 시작일에, 비용·토큰은 각 call의 날짜에 귀속한다(`day-aggregator.ts:113–132,200–219`). 자정을 넘는 턴을 통째로 하루에 몰아넣지 않는다. 날짜 필터 역시 call 단위로 자른다(`parser.ts:5810–5835`). 시간 정보가 거친 Grok 세션 fallback 등의 정확도가 여기서 자동 개선되는 것은 아니다.

## 어떤 작업에서 많이 썼는가

- `classifier.ts:61–94`는 계획/에이전트 생성/편집/실행/검색/읽기 도구 패턴을 이용한다.
- `classifier.ts:4–16,120–153`은 prompt의 영어 정규식 키워드로 feature/debugging/refactoring/brainstorming 등을 세분화한다. 가장 먼저 등장한 키워드 위치로 일부 충돌을 해소한다.
- 이는 LLM이 대화 의미를 이해한 분류가 아니라 휴리스틱이다. 한국어만으로 작성한 '버그 고쳐줘', '새 기능 만들어줘'는 해당 영어 키워드 세분화에 직접 맞지 않으며 도구 종류 또는 일반 fallback에 의존한다. 사용자 한국어 작업에 대한 정확도는 별도 검증 대상이다.
- 분류를 위해 실제 사용자 문장·도구·명령을 읽는다. Gemini는 이전 user message를 최대 500자로 추출한다(`providers/gemini.ts:75–83`). TokenTrailer가 이를 참고하더라도 '토큰 숫자만 읽는 수집기'라고 설명해서는 안 된다.
- 날짜별 session 수는 서로 다른 날짜의 occupancy를 단순 합치지 않고 최대 일수 값을 lower bound로 다룬다. 과거 cache에 cache-read 필드가 없으면 부분합을 완전한 값으로 표시하지 않도록 incomplete를 유지한다(`usage-aggregator.ts:44–75`). 이는 누락과 0을 구분하는 참고점이다.

## TokenTrailer 요구사항 검토에 연결할 점

1. Claude·Codex부터 클라이언트 종류와 로그 형식을 명시한 수집 계약을 만든다. 계정 한도 수집과 로컬 토큰 수집은 별도 데이터다.
2. input/output/cache-read/cache-write/reasoning의 포함 관계를 provider별로 정하고, 그래프의 '전체 토큰' 정의를 하나로 고정한다.
3. measured/estimated/unknown을 토큰·비용·시간·작업분류 각각에 부여한다. 하나의 estimated 플래그로 모두를 묶지 않는다.
4. current-PC의 의미는 파일 발견 위치가 아닌 원본 실행 장치로 검토해야 한다. 로그 복사·WSL·원격 미러·계정 공유를 별도 취급한다.
5. 공통 event ID와 provider별 dedup 규칙, 원본 provenance, fork/archive 중복과 로그 순환 누락을 수용 기준으로 삼을 가치가 있다.
6. 시간 그래프 → 세션/프로젝트 → 작업분류로 내려가는 흐름은 참고할 수 있지만 한국어 분류 품질, cache 포함 여부, coarse timestamp는 사용자가 알 수 있어야 한다.
7. 계정 전체 대비 PC 비율은 동일 계정·기간·토큰 정의의 전체 집계가 확보된 경우에만 가능하다. 이 로컬 수집 기능이 있다는 이유로 분모까지 확보됐다고 할 수 없다.

원본 앱·요구사항은 수정하지 않았다. 전 제공자의 모든 edge case·실제 로그 정확도·요금 최신성·계정 전체 대비 포착률은 검증하지 않았으며, 본 보고서는 사용자 우선순위 제공자와 공통 집계 구현을 중심으로 한 정적 분석이다.
