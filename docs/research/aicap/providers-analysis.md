# AICap 제공자·계정·인증·사용량 프런트엔드 분석

분석일: 2026-10-19. 대상은 기존 복구된 AICap 0.7.5 배포 자산이다. 원본 앱과 설정, 실제 인증 파일은 읽거나 변경하지 않았고 인증·전환·내보내기 버튼을 실행하지 않았다.

## 근거 범위

- 주 근거: `frontend/assets/index-BbaXIiVU.js`, SHA256 `a3d727cc6216062b6493d48cc43165dee98cd523c172f2569e1d309db0e81f41`.
- 아래 위치는 이 파일의 JavaScript UTF-16 문자 오프셋(0부터 시작)이다. 압축된 원본 파일의 바이트 오프셋과 다르다.
- `ipc-command-inventory.json`의 60개 호출 래퍼와 실제 호출부, 조건 분기, 화면 필드를 함께 확인했다. 문자열 존재만으로 기능을 판정하지 않았다.
- 신뢰도 '확인'은 배포 프런트엔드 코드의 정적 동작 확인을 뜻한다. 백엔드 성공 여부, 외부 서비스 정책 및 현재 계정에서 실제 작동 여부는 별도다.

## 제공자와 계정 관리

| 기능 | 확인한 동작 | 근거 |
|---|---|---|
| 제공자 추가 | OpenAI, Anthropic, Google, Z.ai 네 종류. `Zt` 메타데이터의 키를 `xs=Object.keys(Zt)`로 만들고 타이틀바 `ys`의 버튼마다 `addProviderProfile(kind)` 호출 | Zt 약 11100; ys 280714 이후; xs 286738 |
| 복수 계정 프로필 | 백엔드 `create_provider_profile` 결과를 `providerProfiles` 배열에 추가하고 ID별 새로고침 주기를 설정. 같은 종류의 프로필 여러 개를 처리하는 구조 | 256670–257100, Ei 71045 이후 |
| 이름 변경 | nickname 입력·확정·취소, 빈 값은 null, 화면은 nickname 없으면 profile.id 표시 | Ti 60400–60900, 설정 setter 257500 이후 |
| 순서 변경 | 제공자 그룹 단위 드래그와 같은 제공자 내부 계정 드래그. 다른 제공자 간 계정 이동은 차단 | Ei 71045–77300 |
| 위젯 표시 대상 | 프로필별 pin/unpin, 모두 표시/해제. 설정에서 인증된 pin 대상이 있는지 별도 조회 | Ti 70000 이후; Mi 77541; vs 277900 이후 |
| 프로필 제거 | 프로필·pin·갱신주기 설정에서 제거하고 제거 analytics 및 `remove_auth` 요청. 인증 제거 실패는 로그 처리 | 257000–257530 |

Google이라는 UI 표기를 확인했지만 이를 일반 Gemini 웹/CLI 사용량 전체로 확대해서 해석할 수 없다. 실제 Google 제품/API 범위는 네이티브 분석 근거와 결합해야 한다. Grok·Kimi는 이 추가 버튼 목록과 인증 분기에 없다.

제거 확인창은 `Gr`(35619) 및 인증된 카드 메뉴에 존재한다. 반면 미인증 카드의 X는 `ze`로 직접 연결된다(Ti 약 61000); 모든 제거 경로가 같은 확인창을 거친다고 단정하면 안 된다.

## 인증 흐름

| 종류 | 실제 프런트엔드 흐름 | 근거 |
|---|---|---|
| Anthropic | `start_provider_auth(id)` → URL을 외부 브라우저로 열기 → `waiting_code` → 사용자가 코드를 입력 → `complete_provider_auth(id,code)` | nr 19000 전후–20300, Ti 62000 전후 |
| OpenAI | start → 외부 브라우저 → `complete_provider_auth(id,null)`을 기다림. polling 상태로 중복 요청을 막고 작업 세대 번호로 오래된 완료 결과를 무시 | ar 20300–21600 |
| Google | OpenAI와 같은 프런트엔드 비동기 흐름. 실제 localhost callback 또는 polling 내부 방식은 백엔드 영역 | cr 21600–22900 |
| Z.ai | API key password 입력, 비어 있으면 저장 불가, `set_z_ai_api_key(id,key)`, 성공 후 입력 지움 | dr 22900 전후, Ti 60000·63000 전후 |
| 공통 완료 처리 | auth-status·usage·canEnableWidget 쿼리를 무효화하고 토스트. 인증 성공 콜백에서 provider analytics 요청 | nr/ar/cr/dr, Ti 57000 |
| 수동 OAuth 복원 | access/refresh 필수, expiresAt은 양의 안전한 정수(Unix ms), accountId/idToken 선택. `restore_provider_auth`에 전달 후 쿼리 무효화 | fi 53520–55700 |
| 인증 정보 표시·복사 | `get_provider_auth_credential`로 상세값 조회. API key 또는 access/refresh/expires/accountId/idToken 필드를 읽기 전용 `type:text`로 표시하며 클립보드 복사 제공 | ni 41300–44200 |

수동 복원 입력의 비밀 필드는 `type:password`지만 인증 상세 창은 마스킹 없는 text 표시다. 이는 기능 확인이며 이번 조사에서 실제 인증값을 열람한 것은 아니다. OAuth 취소 시 프런트엔드의 오래된 결과는 무시하나, 백엔드 인증 작업까지 취소하는 IPC는 이 경로에서 찾지 못했다.

## Codex 계정 전환과 OpenCode 내보내기

- Codex/OpenCode 활성 계정 배지는 `get_active_account_badges`를 1초마다 배경 조회한다(`Jn` 18500 전후, `js` 289709). 계정별 badges를 Map으로 표시한다. 실패 시 배지를 미정으로 둔다.
- OpenAI 카드 중 현재 Codex 배지가 아닌 계정에 계정 전환 메뉴를 제공한다. `switch_codex_account(id)`는 전역 mutation key로 중복 실행을 막는다(Ti 56900·58200).
- `is_running_codex_desktop` 조회 성공으로 메뉴를 표시하고, 클릭 시 다시 조회하여 **실행 중이면 확인창**, 실행 중이 아니면 바로 전환한다(`si` 44900·47700). 따라서 메뉴 표시의 isSuccess 사용만으로 오류라고 할 수 없다.
- 전환 결과 `restart_failed`를 일반 실패와 구분하여 사용자에게 알리고 배지 쿼리를 무효화한다. 실제 어떤 파일을 쓰고 프로세스를 어떻게 재시작하는지는 네이티브 근거가 필요하다.
- OpenCode 내보내기는 OpenAI·Anthropic·Z.ai만 지원 목록에 있다(`ui` 53400 전후). `preview_opencode_export`로 경로·state·revision을 받고, current 상태이면 재내보내지 않는다.
- 실행 시 `export_auth_to_opencode(id,expectedRevision)`를 호출한다. false이면 파일이 바뀐 것으로 취급하여 미리보기를 새로 읽고 재검토를 안내한다(`Zr` 38412–41270). 프런트엔드에서 변경 충돌 대응 의도가 확인되지만 백엔드의 원자적 쓰기 보장은 별도다.
- Anthropic은 `@ex-machina/opencode-anthropic-auth` 플러그인 안내를 표시한다. 실행 중 OpenCode 재시작 안내도 있다. 이 작업들은 사용량 관찰을 넘어 다른 클라이언트 인증 상태에 영향을 주는 기능이다.

## 사용량 데이터와 화면

- `Gn`은 auth-status를 먼저 확인하고, 인증된 프로필에 대해 `In`으로 `refresh_provider_usage(id)`를 호출한다(17659–18340, 16051–17061).
- 기본 갱신 주기는 네 제공자 모두 300초, 선택값은 5/15/30/60/300초이며 프로필 ID별 설정이다(약 5800–6300, `zn` 17000 전후). background refetch 활성, staleTime/gcTime 0. 일반 실패는 1회 재시도, NOT_FOUND/not found는 retry를 하지 않는다. 해당 로그의 'stopping fetch'와 달리 주기 조회를 중단시키는 코드는 이 함수에 없다.
- 메인 카드는 `five_hour`, `seven_day`, `extra_windows`의 `utilization`과 `resets_at`을 표시하고 계정 요금제 `plan_type`도 표시한다(Ti 57500–58300·69000–70900). extra windows는 label/short_label을 받아 표시한다.
- OpenAI 요금제 표시 별칭: go→Go, plus→Plus, prolite→Pro 5x, pro→Pro 20x(77428).
- Google 추가 창은 Claude/GPT 5시간·7일, Argon 7일 ID를 인식하며, Anthropic 추가 창은 hideFableUsage 옵션으로 숨길 수 있다. mainWindow/widget/all/none 범위가 있다(`Vn` 17100–17600). 모델명 의미와 서비스 실제 할당량은 외부 API/네이티브 검증 전에는 미확정이다.
- `Pt`는 utilization을 0–100으로 제한하며 남은 비율 모드는 `100-utilization`. 비용이나 토큰 수로 변환하지 않는다(7422–7516).
- **메인 카드 `Yt`에는 `t?.utilization??0`이 있어 개별 usage window 값이 없으면 0%(역표시는 100%)가 될 수 있다.** 전체 API 오류는 Ti의 오류 카드로 별도 표시하지만, 누락된 개별 필드와 실제 0을 구분하지 못할 가능성은 남는다(약 9500–11200). 실제 누락 응답 재현은 미실시.
- 초기 로딩, 미인증, API 오류, 정상 카드가 각각 분기된다. 오류 카드는 재시도 및 재인증/수동복원 수단을 제공한다. 마지막 업데이트 시각은 React Query dataUpdatedAt이다.
- 위젯은 `get_provider_usage_data_all` 캐시를 1초마다 읽는다(`wo` 260264–264392). 외부 API를 1초마다 요청한다는 뜻이 아니다. cache read error는 로그를 쓰지만 반환 UI 모델에 error를 전달하지 않는다. 오래된 값의 표시 기준/신선도 표시는 메인과 차이가 있다.
- 리셋 타임라인 `br`(24025–29741)은 향후 `resets_at`을 수집·정렬한 일정 그래프다. 0–5시간과 5–168시간을 각각 절반 폭으로 표현한다. **토큰 소비 이력 그래프가 아니다.**

## 사용 한도 초기화 크레딧

- OpenAI·Anthropic만 동작 대상으로 선언(`Ai` 77512). 서버 응답의 rate_limit_reset_credits.available_count 및 credits 배열을 읽는다.
- 만료 시각 순으로 정렬, 잔여 개수/만료 정보와 목록을 보여주며 선택 후 확인창을 거친다(`Yr` 36400 전후, si 52353 이후).
- usable_now가 false인 크레딧은 실행하지 않는다. 요청 키는 credit.id·remaining_count를 기준으로 재사용하고 UUID 또는 시각/난수 기반 값을 생성한다(Ti 58700–60200).
- `consume_provider_usage_reset(profileId,idempotencyKey,creditId)`의 reset/already_redeemed는 성공, nothing_to_reset은 정보, no_credit은 실패로 구분한다. finally에서 성공·실패 모두 사용량 재조회한다.
- 사용량 초기화는 앱의 로컬 카운터 지우기라고 볼 수 없다. IPC 이름·반환값으로 제공자 한도 리셋 요청임을 알 수 있지만 실제 제공자 효과는 네이티브와 런타임 검증이 필요하다. 이번 분석에서 호출하지 않았다.

## 백업과 인증 관련 경계

한국어 백업 설명은 '앱 설정과 계정 인증 정보가 포함', 오래된 인증정보 재인증 가능, 비밀번호 분실 복구 불가를 명시한다(약 84700–86000). 복원 안내는 현재 설정·계정 인증 정보를 교체하고 재시작한다고 명시한다. 파일/Google Drive 저장 IPC는 비밀번호 인자를 받는다(4200–5400). 상세 암호화 구현과 실제 저장 범위는 네이티브 담당 분석으로 확인해야 한다. 안내문만으로 암호화 방식·강도를 입증할 수 없다.

## TokenTrailer 적용 판단과 미확정 사항

1. AICap의 직접 참고점은 여러 계정의 요금제 한도 모니터링, 프로필별 주기, 신선도/오류 상태, 위젯 대상 선택이다.
2. 이 프런트엔드에서 시간별·작업별 토큰 소비, 현재 PC 토큰, 동일 기간 계정 전체 대비 PC 비율 UI는 찾지 못했다. 코드가 실제 사용하는 metric 필드와 타임라인 흐름을 확인한 결론이다.
3. `lifetime`, `peak_daily`, `threads`, `statistics`, `tokens`, `total_used`, `balance`는 주 번들에서 미검출이다. 그러나 별도 네이티브 문자열에 lifetime_tokens/peak_daily_tokens/total_threads 단서가 발견되었다는 병행 분석 결과가 있으므로 **앱 내부에 토큰 통계가 전혀 없다**고 단정하지 않는다. UI로의 전달과 표시 경로가 미확인이다.
4. Google UI가 곧 사용자 목표의 Gemini 지원이라고 볼 수 없으며, Grok/Kimi 추가 수집 방식도 독립 조사 대상이다.
5. TokenTrailer의 계정 조회 기능에 인증정보 노출·복원·Codex 전환·OpenCode 내보내기까지 자동 포함할 근거는 없다. 이들은 별도 권한과 사용자 목적이 필요한 기능 범위다.
6. 누락을 0으로 대체하지 않는 표시, 마지막 성공/현재 실패의 동시 표현, 캐시 신선도 표시는 후속 요구사항 검토 후보다. 기존 요구사항·설정은 변경하지 않았다.

분석하지 않은 부분: 실제 로그인, 계정전환, credential export/restore, 한도리셋, 외부 API 성공·실패 재현, 저장 암호화 보장. 이 보고서는 정적 프런트엔드 기능과 네이티브 경계까지의 근거이며 전체 앱 런타임 검증 완료를 뜻하지 않는다.
