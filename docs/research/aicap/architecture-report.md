# AICap 아티팩트 구조 및 네이티브 서브시스템 조사

- 조사일: 2026-10-19
- 대상: 설치된 ai-cap.exe 0.7.5, 10,771,456 bytes
- 현재 파일 SHA256: `232aa2d803e9cc551027d0996637122e6c4f3845d1a86546c3cfd4be32f02b3a` (이번 조사에서 재계산)
- 범위: 배포 EXE의 문자열/모듈 경로/의존성 흔적, 기존 복원 프런트엔드의 IPC와 관련 호출, 설치 디렉터리 파일 목록. 실행·설정 변경·계정 인증·네트워크 요청 없음.
- 근거 표기: `PE+0x...`는 원본 파일 바이트 오프셋. JS 오프셋은 복원 `assets/index-BbaXIiVU.js`의 UTF-16 인덱스. 문자열만으로 성공 동작이나 호출 가능성을 입증하지 않는다.

## 1. 배포 구조

설치 폴더에는 ai-cap.exe와 uninstall.exe(81,904 bytes)가 확인된다. `.aicap`에는 settings.json(조사 시점 1,135 bytes), app-config.yaml(475 bytes), logs 폴더가 있다. 이 조사에서 설정 파일 내용, 인증 저장소 또는 데이터베이스 레코드는 열지 않았다.

EXE는 Rust/Tauri 계열 네이티브 호스트와 압축된 웹 프런트엔드를 포함한다. 기존 복원 결과는 JS 14개와 CSS 1개다. 전체 원본 자산이 모두 복구되었다는 뜻은 아니며 HTML, 아이콘 및 실행 파일 내부의 다른 리소스는 별도 영역이다. 모든 복원 항목의 원본 범위와 해시는 frontend/provenance.json에 있다.

- 메인 JS: index-BbaXIiVU.js (316,532 UTF-8 bytes / 297,764 UTF-16 code units)
- runtime: rolldown-runtime-CNC7AqOf.js
- vendor 12개: React, query cache, i18n, Tauri API, updater 관련 구현 포함. 이름만으로 개별 패키지 버전은 확정하지 않는다.
- vendor-Cm0VEhql.js에 `plugin:updater` 명령 경로가 실제 존재.
- IPC 래퍼 60개: ipc-command-inventory.json. 이 목록이 모든 네이티브 API나 모든 기능 목록을 뜻하지는 않는다.

## 2. 의존성 버전 흔적

배포 바이너리의 빌드 소스 경로에서 확인했다. 잠금파일/SBOM 전체를 복구한 것은 아니다.

| 구성 | 버전 흔적 | 근거 예 |
|---|---|---|
| Tauri | 2.11.3 | PE+0x8648ae |
| updater plugin | 2.10.1 | PE+0x86b67e |
| autostart plugin | 2.5.1 | PE+0x86bdaf |
| single-instance plugin | 2.3.7 | PE+0x86c227 |
| WebView2 COM / Wry | 0.38.2 / 0.55.1 | PE+0x9b15b5 / 0x9b2c1e |
| keyring | 3.6.3 | PE+0x940505 |
| age / age-core | 0.12.1 / 0.12.0 | PE+0x8f22ff / 0x8fde80 |
| reqwest | 0.13.4 및 0.12.28 흔적 | architecture-static-index.json |
| tokio / log4rs / notify | 1.49.0 / 1.4.0 / 8.2.0 흔적 | architecture-static-index.json |
| tray-icon | 0.24.1 | PE+0x9a7993 |

## 3. 제공자 계층과 데이터 후보

자체 `libs/crates/llm-provider` 아래 core, facade, anthropic, openai, google, z_ai 모듈이 존재한다. 제공자별 auth, usage, chat 경로가 확인된다. Grok/Kimi의 해당 계층은 이번 검색에서 발견하지 못했으며, 이를 앱 전체에 대한 부재 증명으로 사용하지 않는다.

| 제공자 | 네이티브 정적 근거 | 판단 경계 |
|---|---|---|
| Claude | oauth usage PE+0x867d51, profile PE+0x9422b1, messages PE+0x867c89, usage_reset 모듈 PE+0x867bfc | 사용률 조회 외 채팅/리셋 경로가 포함됨. 실행 성공은 미검증 |
| Codex | wham/usage PE+0x867a7a, profiles/me PE+0x8677e2, reset-credits PE+0x867888, consume PE+0x867938, codex/responses PE+0x8679f5 | 통계와 리셋을 별도 모듈로 지원하는 단서 |
| Google | google/api/usage.rs PE+0x867309, daily-cloudcode-pa.googleapis.com PE+0x867418 | 정확한 제품 명칭·플랜 대응은 프런트엔드와 함께 확인해야 함 |
| Z.ai | quota/limit PE+0x941372, chat/completions PE+0x866f89, set_z_ai_api_key IPC | API 키 기반 연동과 사용량 조회·채팅 경로 |

중요: Codex statistics.rs(PE+0x867833) 및 PE+0x941e5a 이후에 lifetime_tokens, peak_daily_tokens, daily_usage_buckets, cumulative_daily_usage_buckets, weekly_usage_buckets, total_threads, workspace_rank, stats_as_of 등의 필드가 있다. 따라서 'AICap은 토큰 관련 통계가 전혀 없다'고 단정할 수 없다. 현재 복원 메인 JS에는 lifetime_tokens, daily_usage_buckets, statistics 문자열이 없었다. 네이티브 타입 잔존인지 사용량 응답에 포함되는지, UI에서 사용하지 않는지 추가 연결 검증이 필요하다. 이 통계가 현재 PC의 로컬 사용량이라는 증거는 없다.

## 4. 인증·외부 앱 계정 연결

- src/auth/keyring.rs PE+0x87df82; Credential Manager API 이름 CredReadW PE+0xa0b2ee, CredWriteW PE+0xa0b2fa.
- 자체 big-keyring PE+0x8fed12: metadata/chunks와 Base64 분할 저장, 누락/불일치/역직렬화 실패 문자열. Base64는 암호화가 아니다. 저장 암호화 수준이나 OS 보호 설정은 호출 분석 없이 확정하지 않는다.
- Codex integration.rs PE+0x941984: CODEX_HOME, USERPROFILE, .codex, auth.json, config.toml 문자열. IPC switch_codex_account와 is_running_codex_desktop가 있어 별도 앱 계정 전환 경로 존재.
- OpenCode preview.rs PE+0x8f07ef; preview_opencode_export, export_auth_to_opencode(expectedRevision) IPC. 미리보기/변경 경쟁 검사를 의도한 입력 구조가 있다. 실제 충돌 처리 로직까지 확인한 것은 아니다.
- start/complete/restore/remove 인증 IPC 및 active account badge 조회가 있다. credential을 반환/복원하는 명령도 있으므로 기능 목록에서는 인증정보 취급 경계로 분리해야 한다.

## 5. 스케줄러는 수동적 일정 표시만이 아님

메인 JS UTF-16 약 87274에는 첫 요청 없이 다음 사용량 주기를 시작하도록 하는 설명이 있으며, 87377에는 '자동으로 짧은 채팅을 보내서 다음 리셋 시간을 앞당겨요'라는 한국어 안내가 있다. 네이티브 usage_scheduler/callback.rs(PE+0x87daf6)에는 on_usage_refreshed, do_touch, Detected fresh usage window, Success/Failed to touch usage window가 있다. UI 설정 변경 코드는 JS+255226 부근에서 AfterReset 모드 활성화 시 analytics 이벤트를 보낸다.

즉 기능 의도는 사용량 조회 시점에 조건이 맞으면 모델 요청을 발생시키는 것. 현재 앱의 실제 스케줄러 실행 여부, 정확한 임계 조건·모델 선택·중복 억제는 별도 분석 필요. 단순 리셋 일정 타임라인과 이 기능을 혼동하지 않는다.

## 6. 백업과 복구

프런트엔드 IPC는 파일 내보내기/가져오기(password), Google Drive 인증·목록·내보내기·가져오기·삭제를 제공한다. 실제 파일 내보내기 호출은 JS+226539 부근이다.

네이티브 src/backup/common.rs PE+0x8eb966 부근에는 `.age` 파일명, passphrase encryption 요구, 파일 및 복호화 크기 제한, 비밀번호 길이, 포맷 버전, profile ID 중복, credential-provider 불일치 검증, `rollback failed` 오류 경로가 존재한다. age 의존성과 함께 비밀번호 암호화 백업 구현의 강한 정적 근거다. 실제 최대 크기·비밀번호 조건·복구 원자성은 미확정이다.

Google Drive appdata scope PE+0x915ec8, files/upload API 및 revoke 경로가 있다. 일반 폴더 공유 기능이라고 추정하지 않는다. 백업 범위에 인증정보가 포함될 수 있음을 credential 검증 문자열과 UI 흐름이 시사하지만, 실제 백업을 만들거나 내용을 열지 않았다.

## 7. 업데이트·피드백·분석 전송

- Tauri updater plugin과 latest.json URL이 바이너리에 존재한다. 메인 JS+288743 부근에서 analyticsAppUpdateInstallRequested -> downloadAndInstall -> 재시작 호출 흐름 확인. 실제 다운로드·설치·서명 검증 결과는 조사하지 않았다.
- relay/feedback.rs PE+0x8eafb0 부근: `/v1/bug-report`, logFile, 로그 파일 읽기 및 multipart 구성 실패 메시지. 피드백이 단순 텍스트만 전송한다고 가정하면 안 된다.
- relay/analytics/sender.rs PE+0x8eb4da 부근: `/v1/analytics`, application/x-protobuf. worker/logger 모듈 및 app-exit 이벤트 흔적도 있다. IPC에 제공자 추가/삭제, 스케줄러 활성화, 업데이트 설치요청 analytics 명령 존재.
- PostHog 도메인 문자열은 CSP 허용목록에서도 발견된다. 이것만으로 PostHog 직접 전송이나 전송 필드를 확정하지 않는다.
- 실제 전송 여부·동의 설정·payload·개인정보 최소화 수준은 미검증. 피드백/analytics 엔드포인트에 요청하지 않았다.

## 8. 설정 감시·종료·창 관리

config_watcher.rs PE+0x87d8c0는 설정 파일 파싱, watcher interval, 로그 레벨 갱신을 포함한다. 바이너리 기본 설정 텍스트에는 watcher interval_secs 60 / is_enabled true / 로그 백업 5개가 있다. 이는 실제 현재 사용자 설정값이 아니다.

별도 src/tray.rs, widget/taskbar_widget_host.rs, widget/monitor.rs, app_exit.rs, msix/migration_binary.rs가 있다. 일반 창·트레이·위젯·작업표시줄 호스트·패키지 마이그레이션은 구분되는 하위 시스템이다. 기존 FOCUSED_NATIVE_ANALYSIS.md의 작업표시줄/자동시작 함수 분석과 결합해 읽는다.

## 9. 분석 한계와 다음 연결 지점

이번 보고서는 구조와 기능 후보를 포괄적으로 확장한 결과다. 전체 바이너리의 모든 함수를 복구하거나 모든 기능을 실행 검증한 결과가 아니다. 특히 통계 데이터의 UI 도달성, 스케줄러 조건, 백업 비밀정보 범위, analytics payload, 제공자 오류 복구 경로는 프런트엔드 호출과 선택적 네이티브 분석을 연결해야 한다.

원본 앱과 설정은 변경하지 않았고, 자격증명 저장소·대화·DB 행을 읽지 않았다. 표의 문자열은 기능 존재/범위의 단서이며 사용자 PC에서 성공한 기능으로 과장하지 않는다.
