# codexwinmux 후속 작업

이 문서는 Codex 전환 MVP 이후 남은 검수와 post-MVP 작업을 정리한다.

## 완료된 범위

- 서비스 정체성: `codexwinmux`, `cwmux`, `~/.codexwinmux`, tmux socket `codexmux`.
- Codex provider: `codex`, `codex resume <sessionId>`, model/sandbox/approval/search option.
- Codex session detection: pane process tree 기반 `codex` 감지.
- Codex JSONL parser: timeline, session history, stats 입력 처리.
- usage stats: Codex JSONL 기반 cache와 cost 추정.
- daily report: `codex exec` 기반 report 생성.
- CLI/API: package CLI alias는 `codexwinmux`/`cwmux`, API 호환 레이어는 `x-cmux-token`, `CMUX_PORT`, `CMUX_TOKEN`.
- Codex-only 모델: `codex` panel type과 `agent*` metadata 유지.
- 한국어/영어 locale만 유지하고 기본 locale을 한국어로 전환.
- Electron 개발/빌드 flow와 Android Capacitor shell 추가.
- Android 런처: 저장 codexwinmux 서버 자동 재접속, 최근 서버, legacy codexmux 저장값 자동 연결 차단, 실패 복구, 앱 정보 표시, 앱 재시작.
- Android 연결 방어: `/api/health` probe, timeout/network/HTTP/SSL 실패 복구, CORS header.
- Release automation: `release:patch|minor|major`로 version bump, 검증, release commit/tag/push를 묶고, `deploy:local`로 build/service restart/health 확인을 수행.
- 모바일 UI: Android 런처와 모바일 sheet/header/tab bar의 터치/focus 상태 정리.
- 모바일 앱 정보: 서버 접속 후 mobile navigation에서 Android 앱 versionName/versionCode, package, device, Android version, 서버 버전 확인과 WebView/Activity 재시작 제공.
- 알림 설정: 작업 완료 toast, system notification, 완료 사운드 on/off.
- status 로직 1차 모듈화: state reducer, session mapping, notification policy, metadata merge 분리.
- timeline 로직 1차 모듈화: shared server state, stable entry id, dedupe, init/append/load-more merge 분리.
- provider contract 테스트 강화: Codex provider API shape, panel/process mapping, stable parser id 검증.
- DIFF 패널 안정화: 대량 tracked/untracked diff 제한, binary/대용량 placeholder, client timeout, 기본 접힘 렌더링 적용.
- 성능 1차/2차/3차/4차/5차/6차/7차/8차/9차: 인증된 `/api/debug/perf` snapshot, timeline append batching/row memo/content-visibility/windowed render, terminal stdout coalescing, JSONL tail snapshot cache, DIFF full response short cache, stats in-flight cache build dedupe, timeline message count streaming, session index unchanged persist skip, session list page mapping 적용.
- 터미널 제어 입력: xterm, Codex web input, 모바일 surface에서 `Ctrl+D`를 Codex CLI/shell EOF로 전달하고 pane 분할 단축키 충돌 제거.
- 워크스페이스 이름 변경: desktop 더블클릭/컨텍스트 메뉴, header shortcut, 모바일 header/navigation sheet 편집 경로 정리.
- Codex session detection: JSONL 지연 생성에 대비해 process start time 허용치를 확장하고 live process 확인 후 cwd fallback 보정 적용.
- 모바일 foreground reconnect: Android WebView/iPad Safari 복귀 시 terminal/status/timeline/sync WebSocket 강제 재연결과 workspace/layout 재동기화 적용.
- runtime v2 terminal 복구: Terminal Worker/service restart는 retryable close로 fresh attach를 유도하고, `session-not-found` restart는 runtime v2 Supervisor가 같은 tab id/session name을 재생성한다. 모바일/desktop 복구 overlay가 우상단 reconnect 버튼을 가리는 중복 UI는 숨긴다. Browser DOM smoke는 `corepack pnpm smoke:browser-reconnect`로 temp server에서 실제 Chromium pointer 동작까지 확인한다.
- runtime v2 storage dry-run: `corepack pnpm runtime-v2:storage-dry-run`으로 실제 `~/.codexwinmux` JSON stores를 read-only 분석하고, backup manifest와 cutover blocker를 민감 값 없이 출력한다. `corepack pnpm smoke:runtime-v2:storage-dry-run`은 fixture 기반 민감 정보 비노출과 blocker 산출을 검증한다.
- runtime v2 storage backup: `corepack pnpm runtime-v2:storage-backup`으로 legacy JSON stores와 `runtime-v2/state.db*`를 `~/.codexwinmux/backups/runtime-v2-storage-{timestamp}/`에 복사한다. `corepack pnpm smoke:runtime-v2:storage-backup`은 fixture 기반 복사와 민감 정보 비노출을 검증한다.
- runtime v2 storage import: `corepack pnpm runtime-v2:storage-import`로 legacy JSON workspace/layout/message-history snapshot을 SQLite schema v3로 idempotent import한다. group, split layout, active/sidebar state, workspace directory list, message history, legacy terminal tab, non-terminal tab, status metadata import가 가능하며 runtime v2 attach/cleanup은 `runtime_version=2` terminal tab만 대상으로 유지한다.
- runtime v2 storage write mirror: `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=write|default`에서 legacy JSON workspace/layout/message-history write 직후 SQLite import mirror를 수행한다. `corepack pnpm smoke:runtime-v2:storage-write`는 temp HOME/DB에서 mirror projection과 status metadata 보존을 검증한다.
- runtime v2 storage default read: schema v3가 workspace directory list, active/sidebar UI state, message history를 SQLite에 보존하고, `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=default`에서 workspace/layout/message-history read가 SQLite projection을 사용한다. 2026-05-16 Core/Backend 논리 분리 slice 이후 runtime default read failure는 legacy JSON으로 내려가지 않고 typed error로 fail closed한다. `corepack pnpm smoke:runtime-v2:storage-default-read`는 temp HOME/DB에서 SQLite cold read, JSON write mirror 후 default read, `updateActive()` runtime write 후 default read, message-history rollback JSON mirror를 검증한다.
- 모바일 CODEX 확인 화면: timeline 연결 전에도 terminal preview로 실제 tmux/Codex 출력을 확인할 수 있게 처리.
- Linux 운영: `systemd --user` 서비스 등록, linger 설정, `HOST=localhost,tailscale,192.168.0.0/16`/`PORT=8122` 운영 문서화.
- permission/input prompt smoke 자동화: 임시 server/HOME/tmux tab에서 `needs-input` push, option parsing, stdin 선택, ack 이후 `busy` 복귀 검증.
- 전역 approval queue 1차: notification panel의 `needs-input` 항목에서 Codex permission/input prompt 선택지를 조회하고 바로 선택/ack 처리한다. 선택지 조회/전송 실패 시 기존 tab 이동 fallback을 유지한다.
- approval queue metadata slice: command/file/permission/resume/conversation type, approval kind, risk badge, sanitized command/file detail을 전역 notification panel에 표시한다. Metadata는 status/Web Push durable payload가 아니라 pane capture에서 계산하는 sanitized projection으로 유지한다.
- 실제 Codex CLI permission prompt live smoke: live tab에서 `read-only` sandbox 실패로 실제 Codex CLI approval prompt를 띄우고, pane capture recovery로 `needs-input` 전환, notification panel `No` 선택, ack 후 `busy` 복귀, denied command 미실행을 확인했다.
- bridge trace forwarding: env-gated `CODEXMUX_BRIDGE_TRACE_URL`/`CODEXMUX_BRIDGE_TRACE_TOKEN`이 있을 때 status summary를 codex-ai-bridge external trace ingress로 best-effort POST한다. Discord 직접 전송이나 raw transcript 전달은 하지 않는다.
- Codex live input prompt 복구: JSONL interrupt marker 없이 남은 `Conversation interrupted` prompt는 stale `busy`에서 `idle`로 복구하고, service restart 후 남는 resume working directory prompt는 persisted `idle`에서도 `needs-input`으로 노출한다. `7e83313` live deploy 기준 Android에서 보이던 purecvisor-single hang 표시는 `needs-input` prompt로 정정됐다.
- Codex resume 실패 원인 분류: `timeline:resume-error`에 `invalid-session-id`, `command-build-failed`, `send-failed`, `unknown` reason을 추가하고 desktop/mobile toast가 reason별 한국어/영어 설명을 표시한다. 원본 error, command, cwd, session name, JSONL path, terminal output은 표시하지 않는다.
- Codex CLI 버전별 JSONL fixture: `tests/fixtures/codex-jsonl/`에 `0.127.0` response-item 중심 fixture와 `0.128.0` event/response paired message fixture를 추가하고 parser regression test로 stable id와 중복 제거를 고정했다.
- Codex fork/sub-agent 관계 UI: Codex `spawn_agent`/`Agent` function call과 matching output을 `agent-group` timeline entry로 접고, timeline 카드 헤더에 `Sub-agent`, agent type, 설명을 함께 표시한다.
- runtime v2 lifecycle control UI/actions: `/experimental/runtime` 상단에서 `/api/health`, `/api/v2/runtime/health`, `/api/debug/perf`, `/api/runtime/lifecycle/action`을 모아 release, surface mode, 24시간 observation gate, worker diagnostics, perf timing, allowlisted lifecycle actions, rollback runbook을 표시한다. 실행 action은 `phase6-gate`, `restart-service`, `deploy-local`, `rollback-runtime-flags`로 제한하고 restart/deploy/rollback은 exact confirmation phrase를 요구한다. `rollback-runtime-flags`는 `corepack pnpm lifecycle:rollback-apply`만 실행하며, 기존 systemd drop-in backup 뒤 rollback flag를 쓰고 daemon reload/service restart를 수행한다. Endpoint 부분 실패는 section label만 노출하고 가능한 section은 계속 렌더링하며, token/cwd/session/prompt/terminal output 원문은 UI와 audit에 표시하거나 저장하지 않는다.
- codex-ai-bridge external trace forwarding: `CODEXMUX_BRIDGE_TRACE_URL`/`CODEXMUX_BRIDGE_TRACE_TOKEN`이 설정된 경우 status update summary를 bridge-owned ingress로 best-effort POST한다. Discord token과 raw transcript는 codexmux가 소유하지 않고, 동일 tab/state/action 조합은 dedupe한다.
- runtime v2 timeline WebSocket default ownership: `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=default`에서 기존 `/api/timeline` WebSocket URL이 Timeline Worker live subscribe/session watch를 사용하는 runtime bridge로 전환됐다. Default WebSocket smoke, live shadow, resume safety, session-changed, Android foreground timeline smoke가 temp HOME/DB 기준 통과했다.
- runtime v2 Phase 6 default gate/code fallback: `smoke:runtime-v2:phase6-default-gate`가 `/api/v2/runtime/health`와 `/api/debug/perf`를 read-only로 조회해 terminal `new-tabs`, storage/timeline/status `default`, worker health ok, failure/restart/timeout counter 0을 확인한다. Phase 6 approval 이후 `CODEXWINMUX_RUNTIME_V2=1`에서 per-surface mode env가 unset이면 같은 값으로 resolve된다. 명시적 `off`는 rollback으로 유지한다.
- runtime v2 CLI/browser/Electron follow-up: CLI plain terminal tab creation은 runtime v2 mode에서 Supervisor/Storage Worker 경로를 사용하고 storage default에서는 JSON layout append 없이 runtime storage tab을 응답한다. `corepack pnpm smoke:runtime-v2:browser-sync`는 Windows에서 tmux 없이 page-context `/api/sync` workspace event와 sidebar UI 갱신을 확인한다. Electron runtime v2 smoke는 Windows process-tree cleanup 보정 뒤 initial + 2 reconnect marker output으로 통과했다.
- runtime v2 status/timeline stale UI evidence: `corepack pnpm smoke:runtime-v2:status-timeline-stale-ui`가 Windows temp runtime v2 default server에서 통과했다. Session list가 local `jsonlPath`로 timeline을 열고, explicit subscribe 뒤 `agentJsonlPath`가 runtime storage metadata에 저장되며, native background 중 JSONL append와 status hook permission prompt가 foreground reconnect 뒤 timeline/status UI에 반영된다.
- Core/Backend physical separation: P2에서 `src/lib/core-engine/contracts.ts`, `client.ts`, `server.ts`, `process-host.ts`와 `electron/core-process.ts`, `src/workers/core-engine-host.ts`를 추가했다. `codexwinmux.exe --codexwinmux-core`는 BrowserWindow와 UI single-instance lock 없이 runtime Supervisor/workers를 시작하고 Core protocol에 응답한다. `0.4.18`부터 Backend Core transport 기본값과 Windows service runbook 기본값은 split topology이며, combined service는 기존 설치 cleanup 용도로만 남긴다.
- Windows package/update smoke: `pack:electron`, `smoke:windows:updater-local-feed`, `smoke:windows:package-gate`, `smoke:windows:release-gate`가 Windows host에서 통과했다. Local feed smoke는 synthetic feed를 받아 download, `quitAndInstall`, post-update launch, uninstall cleanup까지 확인한다. `0.4.18`에서는 update installer가 temp smoke root 아래 pending process로 남는 Windows 타이밍을 자동 정리하도록 smoke-root process cleanup과 retry delete를 추가했다. Published channel smoke는 `HardcoreMonk/codexwinmux` `v0.4.8` release asset 기준 `0.4.2 -> 0.4.8` channel evidence를 확인했다. Full GitHub feed smoke는 실제 `0.4.2` installer를 temp install path에 설치한 뒤 GitHub-hosted `0.4.8`로 download/install/`quitAndInstall`/post-update runtime v2 terminal/5분 long-run health까지 통과했다.

## 릴리스 전 확인

### 2026-05-04 v0.4.1 release smoke snapshot

2026-05-04 `v0.4.1` release 기준 live 배포와 smoke 결과:

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| live deploy/systemd | 통과 | `deploy:local`, `/api/health` `version=0.4.1`, `commit=d3248c4`, service `ActiveState=active`, `SubState=running`, `NRestarts=0` |
| release/build/type/unit | 통과 | `corepack pnpm release:minor`로 `v0.4.0` 생성 후 Electron DMG 의존성 보정, `corepack pnpm release:patch`로 `v0.4.1` 생성. 최종 release는 `lint`, `test` 92 files / 441 tests, `tsc --noEmit`, `build`, commit/tag/push 통과 |
| browser UI tooling | 통과 | `@playwright/test` 1.59.1 dev dependency, `corepack pnpm exec playwright install chromium`, headless Chromium launch smoke |
| Electron build/attach/runtime v2/package | 통과 | Linux `corepack pnpm build:electron` 통과. M1 macOS `pnpm pack:electron:dev`로 `codexwinmux-0.4.1-arm64.dmg`, `codexwinmux-0.4.1-arm64-mac.zip`, `codexwinmux-0.4.1.dmg`, `codexwinmux-0.4.1-mac.zip` 생성, native binding/arch/Info.plist `0.4.1`/`hdiutil verify` 통과. Linux release host에서는 `build:electron`까지만 authoritative smoke로 보고 macOS DMG/zip packaging은 macOS host에서 실행한다. |
| runtime v2 phase2 gate | 통과 | `corepack pnpm smoke:runtime-v2:phase2` browser reload/server restart/mode-off rollback, Electron page-context `/api/v2/terminal` cookie-auth attach/output/reconnect |
| runtime v2 phase1 shadow | 완료 | live `codexmux.service`에 `CODEXWINMUX_RUNTIME_V2=1`, surface modes `off` drop-in 적용. `corepack pnpm smoke:runtime-v2`, live target smoke, `/api/v2/runtime/health`, `/api/debug/perf` worker counters 통과. 24시간 restart-loop 관찰 항목은 2026-05-05 14:20 KST operator-approved closeout으로 완료 처리 |
| runtime v2 storage shadow/dry-run/backup/import/write/default-read | 통과 | `corepack pnpm smoke:runtime-v2:storage-shadow`, legacy JSON에 mirror된 `runtimeVersion: 2` tab과 SQLite runtime layout projection read-only compare 통과. `corepack pnpm smoke:runtime-v2:storage-dry-run`, live `corepack pnpm runtime-v2:storage-dry-run`, `corepack pnpm smoke:runtime-v2:storage-backup`, live `corepack pnpm runtime-v2:storage-backup`, `corepack pnpm smoke:runtime-v2:storage-import`, live `corepack pnpm runtime-v2:storage-import`, `corepack pnpm smoke:runtime-v2:storage-write`, `corepack pnpm smoke:runtime-v2:storage-default-read` 통과. default-read temp smoke는 workspace/layout/sidebar/message-history read ownership, typed no-fallback failure, rollback JSON mirror를 검증한다. 2026-05-16 내부 폐쇄망 기준에서는 runtime default JSON fallback removal이 완료됐고, fallback은 explicit off rollback artifact로만 남는다. |
| runtime v2 timeline shadow/default-read/WebSocket default | 통과 | `corepack pnpm smoke:runtime-v2:timeline-shadow`, legacy timeline read endpoint와 runtime v2 timeline read endpoint의 message counts/entries-before metadata compare 통과. 2026-05-05 live shadow code slice에서 `timeline.live-subscribe` init reply, `timeline.live-append` worker event, Supervisor fan-out, legacy `/api/timeline` sanitized shadow compare hook을 추가했다. `corepack pnpm smoke:runtime-v2:timeline-live-shadow`는 24개 append entry, init/append match counter, mismatch/error 0을 확인했다. 2026-05-05 default-read slice는 `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=default`에서 legacy `/api/timeline/sessions`, `/api/timeline/entries`, `/api/timeline/message-counts` HTTP URL을 유지한 채 Timeline Worker read command로 route한다. 2026-05-05 15:54 KST live systemd 전환 완료, runtime health `timelineV2Mode=default`, live default-read route smoke 및 Timeline Worker failure/restart/timeout 0 확인. 2026-05-05 WebSocket default ownership slice는 기존 `/api/timeline` WebSocket URL을 유지한 채 Timeline Worker live subscribe/session watch delivery로 전환했다. `corepack pnpm smoke:runtime-v2:timeline-websocket-default`, `corepack pnpm smoke:runtime-v2:timeline-resume-safety`, `corepack pnpm smoke:runtime-v2:timeline-session-changed`, `corepack pnpm smoke:android:timeline-foreground`가 통과했다. Android foreground evidence는 SM-S928N Android 16, timelineV2Mode default, initial/foreground-1/foreground-2 init totalEntries 3/5/7, blocking console/logcat 0, restore 확인이다. 2026-05-14 Windows fixture는 `terminal.get-session-info`로 runtime adapter PTY PID를 사용하고 explicit JSONL subscribe로 init 2 entries, append 1 entry, runtime counter init/append 1을 확인했다. |
| runtime v2 status shadow/default | 통과 | `corepack pnpm smoke:runtime-v2:status-shadow`, Status Worker IPC reducer/policy/side-effect intent/client-event intent output과 legacy pure helper output compare 통과. 2026-05-05 default live bridge는 worker process 안의 StatusManager가 polling/JSONL watcher/ack/Web Push/session history/rate-limit update를 소유하고 `/api/status`가 worker event를 기존 client protocol로 bridge한다. `corepack pnpm smoke:runtime-v2:status-default`는 permission prompt flow가 status default mode에서도 유지됨을 확인했다. 2026-05-14 Windows fixture는 tmux permission pane 대신 runtime tab + `/api/status/hook` notification으로 `needs-input`과 ack 후 `busy` 복귀를 확인했다. |
| Android debug install | 통과 | `versionName=0.4.1`, `versionCode=401`, `lastUpdateTime=2026-05-04 21:35:16`, `MainActivity` |
| Android Tailscale failure recovery | 통과 | `corepack pnpm smoke:android:recovery`, network/HTTP 4xx/SSL failure class별 app start, launcher 복귀와 저장 서버 재연결, blocking console/logcat 0 |
| Android foreground reconnect | 통과 | `corepack pnpm smoke:android:foreground`, 2회 background/foreground, `triggerEvent`/TypeError 0, blocking console/logcat 0 |
| Android runtime v2 foreground | 통과 | `corepack pnpm smoke:android:runtime-v2`, SM-S928N Android 16, temp runtime v2 server `http://100.112.40.104:15771`, initial + 2회 foreground `/api/v2/terminal` marker output, blocking console/logcat 0 |
| Android app info/restart | 통과 | `CODEXMUX_ANDROID_FOREGROUND_ROUNDS=0 CODEXMUX_ANDROID_RESTART_APP=1 corepack pnpm smoke:android:foreground`, native restart 후 `/login`, console 0/logcat 0 |
| Android 60초 background | 통과 | `CODEXMUX_ANDROID_BACKGROUND_MS=60000 CODEXMUX_ANDROID_FOREGROUND_ROUNDS=1 corepack pnpm smoke:android:foreground`, Tailscale HTTPS app surface, `versionName=0.4.1`, blocking console/logcat 0 |
| Android first-run launcher | 통과 | `CODEXMUX_ANDROID_CLEAR_APP_DATA=1 CODEXMUX_ANDROID_FOREGROUND_ROUNDS=1 corepack pnpm smoke:android:foreground`, `/login` 첫 실행 console 0/logcat 0 |
| stats/daily report | 통과 | stats overview/list 200, `2026-05-03` daily report generate 200 |
| permission prompt | 통과 | `corepack pnpm smoke:permission`, 임시 server/HOME/tmux tab에서 `needs-input` push, option parsing, stdin 선택, ack 이후 `busy` 복귀 |
| release-blocking 잔여 | 없음 | Android/Electron/macOS packaging과 runtime v2 foreground smoke는 `v0.4.1` 기준 통과. 원격 기기 연동 경로는 2026-05-05 제거 대상이므로 더 이상 release gate가 아니다. |

### 2026-05-05 RC platform smoke snapshot

`ef09b42` 기준 다음 RC 전 platform smoke를 재실행했다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| systemd deploy/health | 통과 | `corepack pnpm deploy:local`, `/api/health` `commit=ef09b42`, `systemctl --user show codexmux.service` `ActiveState=active`, `SubState=running`, `NRestarts=0`, 최근 warning journal 없음 |
| Electron attach | 통과 | `corepack pnpm smoke:electron:attach`, live `http://127.0.0.1:8122`, preload bridge 확인, blocking console 0 |
| Electron runtime v2 | 통과 | `corepack pnpm smoke:electron:runtime-v2`, temp server `http://127.0.0.1:24013`, initial + 2 reconnect marker output, console clean |
| Android foreground reconnect | 통과 | `corepack pnpm smoke:android:foreground`, SM-S928N Android 16, Tailscale HTTPS target, 2 foreground rounds, blocking console/logcat 0 |
| Android runtime v2 foreground | 통과 | `corepack pnpm smoke:android:runtime-v2`, temp server `http://100.112.40.104:30653`, initial + 2 foreground marker output, blocking console/logcat 0 |

### 2026-05-07 Windows package/update smoke snapshot

Windows 전용 제품 전환 기준으로 Windows installer, packaged app launch, runtime v2
terminal attach, updater local feed를 실제 Windows host에서 다시 검증했다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| Windows package build | 통과 | `corepack pnpm pack:electron`, `release/codexwinmux-Setup-0.4.2.exe`, `release/codexwinmux-0.4.2-win.zip`, blockmap/latest metadata 생성 확인 |
| Windows update metadata | 통과 | `corepack pnpm smoke:windows:update-metadata`, `latest.yml`/installer blockmap/zip blockmap coherence 확인 |
| Windows updater local feed | 통과 | `corepack pnpm smoke:windows:updater-local-feed`, local static feed에서 synthetic `0.4.3` 다운로드, install trigger, post-update launch, uninstall cleanup 확인 |
| Windows packaged launch | 통과 | `corepack pnpm smoke:windows:packaged-launch`, installed app launch, health/load checks, CDP close, exact app path child process cleanup 확인 |
| Windows runtime v2 packaged launch | 통과 | `corepack pnpm smoke:windows:packaged-runtime-v2`, packaged app에서 runtime v2 terminal smoke path 확인 |
| Windows installer install/runtime v2 | 통과 | `corepack pnpm smoke:windows:installer-runtime-v2`, installer silent install, packaged runtime v2 launch, uninstall cleanup 확인 |
| Windows package gate | 통과 | `corepack pnpm smoke:windows:package-gate`, zip artifact, update metadata, updater local feed, packaged launch, packaged runtime v2, installer runtime v2 step 모두 통과 |
| Windows release gate | 통과 | `corepack pnpm smoke:windows:release-gate`, Windows preflight/service host/diagnostics/Electron env/package smoke suite 통과 |
| Windows published update channel | 통과 | `CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION=0.4.2 corepack pnpm smoke:windows:updater-published-channel`, GitHub Releases `HardcoreMonk/codexwinmux` `v0.4.8`, release count 1, `latestVersion=0.4.8`, `referencedInstallerName=codexwinmux-Setup-0.4.8.exe`, latest.yml/installer/blockmap/download URL checks 통과 |
| Windows full GitHub updater | 통과 | `CODEXMUX_WINDOWS_UPDATER_BASE_INSTALLER_PATH=D:\data\projects\codex-zone\codexmux\release\codexwinmux-Setup-0.4.2.exe CODEXMUX_WINDOWS_UPDATER_GITHUB_TAG=v0.4.8 CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_POST_INSTALL_HOLD_MS=300000 corepack pnpm smoke:windows:updater-github-feed`, `latestVersion=0.4.8`, `downloadedFileName=codexwinmux-Setup-0.4.8.exe`, `quitAndInstall`, post-update runtime v2 terminal, 5분 `long-run-health`, uninstall 통과 |
| Windows code signing / SmartScreen | 차단 | `Get-AuthenticodeSignature` 기준 `release/codexwinmux-Setup-0.4.8.exe`와 `release/win-unpacked/codexwinmux.exe` 모두 `NotSigned`; 인증서 신뢰/타임스탬프/SmartScreen reputation은 signed re-publish 전에는 통과 처리 불가 |
| Cleanup hardening | 통과 | packaged launch smoke가 Browser close 후 exact `ExecutablePath` 기반 child process exit를 확인하며, 실패 시 app-scoped cleanup으로 제한한다. `7ff7302f` 이후 temp codexmux process 잔류 없음 |

### 2026-05-08 Windows internal release v0.4.13 readiness

`0.4.13` 내부 파일럿 후보 산출물을 같은 Windows host에서 다시 생성하고 package/update gate를 재확인했다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| Windows package build | 통과 | `corepack pnpm pack:electron`, `release/codexwinmux-Setup-0.4.13.exe`, `release/codexwinmux-0.4.13-win.zip`, `latest.yml`, installer blockmap 생성 |
| updater metadata | 통과 | `release/win-unpacked/resources/app-update.yml` 생성, provider `github`, owner `HardcoreMonk`, repo `codexwinmux`, updater cache `codexwinmux-updater` |
| package gate | 통과 | `corepack pnpm smoke:windows:package-gate`, zip artifact, update metadata, updater local feed, packaged launch, engine lifecycle, packaged Runtime v2, installer Runtime v2 모두 통과 |
| updater local feed | 통과 | synthetic `0.4.14` feed에서 `download -> update-downloaded -> quitAndInstall -> post-update launch -> uninstall` 통과 |
| engine lifecycle | 통과 | packaged app UI quit 이후 `127.0.0.1:8121/api/health` 유지 |
| Runtime v2 terminal | 통과 | packaged app과 installer-installed app 모두 workspace/tab 생성 후 `/api/v2/terminal` marker 확인 |
| Code signing | 차단 | `Get-AuthenticodeSignature release/codexwinmux-Setup-0.4.13.exe`와 `release/win-unpacked/codexwinmux.exe` 모두 `NotSigned` |
| SmartScreen reputation | 차단 | unsigned artifact이므로 accepted reputation evidence로 처리 불가 |
| Rollback automation | 통과 | `corepack pnpm lifecycle:rollback-dry-run`, `mutates=false`, target flag 출력. `corepack pnpm lifecycle:rollback-apply`와 Lifecycle Action `Apply Rollback Flags`는 systemd drop-in backup/write, daemon reload, service restart를 자동화 |
| 운영 문서 | 작성 | `docs/operations/2026-05-08-internal-release-v0.4.13.md`에 release note, 설치/업데이트 안내, 파일럿 체크리스트, 전체 배포 gate, identity decision, rollback evidence 기록 |

### 2026-05-12 Windows internal release v0.4.14 signed readiness

`0.4.14` signed build를 같은 Windows host에서 다시 생성하고 package/update/signing gate를
재확인했다. 운영 기록은 `docs/operations/2026-05-12-codexwinmux-follow-up-1-2-3.md`에
남겼다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| Windows package build | 통과 | `CODEXWINMUX_WINDOWS_CERTIFICATE_SHA1`, `CODEXWINMUX_WINDOWS_PUBLISHER_NAME`, `CODEXWINMUX_WINDOWS_TIMESTAMP_SERVER` 지정 후 `corepack pnpm pack:electron` 실행. `release/codexwinmux-Setup-0.4.14.exe`, zip, blockmap, `latest.yml` 생성 |
| Code signing / timestamp | 통과 | installer와 `win-unpacked/codexwinmux.exe`가 `CN=PureCVisor Desktop Node Internal Code Signing`으로 서명됐고 DigiCert RFC3161 timestamp responder evidence를 포함 |
| SmartScreen internal scope | 통과 | 내부 전용 앱이므로 `CODEXWINMUX_SMARTSCREEN_STATUS=internal-not-required`, `CODEXWINMUX_SMARTSCREEN_ENVIRONMENT=internal-trusted-root-distribution`로 signed/timestamped artifact 범위 gate 통과 |
| Strict identity canary | 통과 | `CODEXWINMUX_STRICT_IDENTITY=1 corepack pnpm smoke:windows:strict-identity`, preferred alias와 product/repo identity 확인 |
| Package gate | 통과 | `CODEXWINMUX_SMOKE_ARTIFACT_DIR=artifacts/smoke/2026-05-12-codexwinmux-follow-up-1-2-3 corepack pnpm smoke:windows:package-gate`, 모든 Windows package 단계 통과 |
| Updater warning cleanup | 통과 | updater local feed smoke에서 `disableWebInstaller is set to false` 경고와 publisher full DN 경고 재발 없음 |
| GitHub release assets | 통과 | `v0.4.14` release assets를 새 signed build hash로 교체하고 원격 `refs/tags/v0.4.14`를 `55f8667c`로 정렬 |

### 2026-05-12 public SmartScreen / warning / legacy sunset follow-up

선택된 후속 작업 `1-2-3`을 추가 처리했다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| Public SmartScreen gate | 차단 동작 확인 | `CODEXWINMUX_SMARTSCREEN_PUBLIC_RELEASE=1`이면 internal-only status를 거부하고 `windows-smartscreen-public-evidence-required` blocker를 낸다. 실제 public 배포는 `CODEXWINMUX_SMARTSCREEN_STATUS=passed` 또는 evidence JSON이 필요하다 |
| Upstream warning cleanup | 통과 | packaging/package-gate/updater smoke child process env에 `--disable-warning=DEP0176`, `--disable-warning=DEP0190`를 중복 없이 병합한다. electron-builder/electron-updater 최신 버전은 각각 `26.8.1`, `6.8.3`로 추가 upgrade 경로가 없다 |
| Legacy CLI alias sunset | 통과 | `package.json` bin에서 `codexmux`/`cmux` alias를 제거하고 `codexwinmux`/`cwmux`만 유지했다. `CODEXWINMUX_LEGACY_SUNSET=1` strict identity smoke가 legacy CLI alias 제거를 검증한다 |

### 2026-05-13 release floor / runtime env alias follow-up

Public SmartScreen 재검증 전제와 다음 릴리스 불변성, runtime env alias migration을
추가 정리했다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 다음 릴리스 하한 | 반영 | `v0.4.15` public release 발행 후 `package.json`을 `0.4.16`으로 올렸다. `smoke:release-immutability`는 이미 발행된 tag/release를 감지해 clobber를 차단하며, `v0.4.14`와 `v0.4.15` tag/asset은 historical evidence로 불변 유지한다 |
| Storage utility alias | 반영 | `runtime-v2:storage-dry-run`, `runtime-v2:storage-backup`, `runtime-v2:storage-import` entrypoint가 `CODEXWINMUX_RUNTIME_*` 입력만 runtime source로 해석한다 |
| Storage/timeline smoke fixture alias | 반영 | storage write/default/shadow, timeline shadow/live/resume/session-changed/websocket smoke가 서버 child env와 test process env를 `CODEXWINMUX_RUNTIME_*` helper로 설정한다 |
| Public v0.4.15 release asset | 발행 | 2026-05-13 `v0.4.15` tag와 GitHub Release를 새로 발행했다. Asset은 `latest.yml`, `codexwinmux-Setup-0.4.15.exe`, installer blockmap, `codexwinmux-0.4.15-win.zip`이며, installer SHA-256은 `68EA233834CE254064545B2194A6844D6C7FB7051F65367DCCF917DE11042480`이다. `v0.4.14` tag/asset은 수정하지 않았다 |
| Public SmartScreen smoke | 차단 유지 | GitHub HTTPS URL에서 Chromium download, SHA-256 match, Internet ZoneId=3 확인까지 통과했지만, ZoneId가 붙은 installer 실행이 Windows에서 취소되어 `windows-smartscreen-public-evidence-failed`가 났다. `CODEXWINMUX_SMARTSCREEN_PUBLIC_RELEASE=1 corepack pnpm smoke:windows:signing-evidence`도 public evidence 누락을 `windows-smartscreen-evidence-missing`으로 차단한다. SmartScreen reputation이 확보된 뒤 clean Windows 환경에서 같은 SHA/URL로 재실행한다 |
| Legacy runtime fallback 제거 | 반영 | unit fixture와 runtime fallback test를 `CODEXWINMUX_RUNTIME_*` 기준으로 재작성했고, `src/lib/runtime/env.ts`, script helper, Electron bootstrap의 runtime legacy read/write fallback을 제거했다 |
| Windows storage-shadow fixture | 반영 | Windows의 `smoke:runtime-v2:storage-shadow`는 legacy `/api/workspace` tmux fixture 대신 `/api/v2/workspaces`와 `/api/v2/tabs` fixture를 사용한다. `CODEXWINMUX_RUNTIME_V2_STORAGE_SHADOW_FIXTURE=legacy-shadow|runtime-v2-api`로 명시 override할 수 있고, 2026-05-13 Windows 실행에서 `fixtureMode="runtime-v2-api"`로 통과했다 |
| Windows runtime smoke gate | 반영 | Windows의 기본 `corepack pnpm smoke:runtime-v2`는 POSIX low-level isolated target smoke 대신 `smoke:runtime-v2:terminal-windows`로 위임한다. target URL을 지정한 경우에는 기존 target smoke를 유지한다. 2026-05-13 Windows 실행에서 terminal gate가 attach/resize/write/detach/reattach/delete/workspace-delete를 통과했다 |
| Windows installer smoke cleanup | 반영 | updater local feed smoke 뒤 temp install uninstall registry가 남아 다음 installer smoke를 막는 현상을 재현했다. `windows-installer-smoke-lib`가 temp smoke uninstall entry만 cleanup하도록 보강했고, `corepack pnpm smoke:windows:package-gate`가 새 `cac22748` build 기준 통과했다 |

### 2026-05-15 public SmartScreen / status-timeline stale UI gate

외부 공개 gate와 fallback removal gate를 다시 점검했다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| Public SmartScreen smoke | 차단 유지 | `v0.4.15` public installer `https://github.com/HardcoreMonk/codexwinmux/releases/download/v0.4.15/codexwinmux-Setup-0.4.15.exe`와 SHA-256 `68ea233834ce254064545b2194a6844d6c7fb7051f65367dccf917de11042480` 기준 `corepack pnpm smoke:windows:smartscreen-public-evidence`를 재실행했다. Chromium download, SHA match, Internet ZoneId=3 확인은 통과했지만 Windows `Start-Process` launch evidence가 취소/SmartScreen reputation 단계에서 실패해 public `passed` evidence는 생성되지 않았다 |
| status/timeline stale UI evidence | 통과 | `corepack pnpm smoke:runtime-v2:status-timeline-stale-ui`가 Windows temp runtime v2 default server에서 통과했다. Session list local `jsonlPath`, timeline explicit subscribe 후 `agentJsonlPath` 저장, native background status/timeline socket close, background JSONL append/status hook mutation, foreground reconnect 뒤 timeline append와 status `입력 대기` UI refresh를 확인했다 |
| Legacy JSON fallback removal | 내부 기준 재개 가능 | public SmartScreen `passed` evidence와 published/public Phase 6 target evidence는 외부 공개 배포 전용 gate로 분리한다. 내부 폐쇄망 릴리스에서는 signed/timestamped Windows artifact, internal SmartScreen scope, Windows local/폐쇄망 Phase 6 target, status/timeline stale UI evidence 기준으로 fallback removal을 재개할 수 있다 |

### 2026-05-16 내부 폐쇄망 release gate 정정

codexwinmux 현재 배포 범위는 내부 폐쇄망 전용이다. 따라서 public SmartScreen reputation
확보와 GitHub public download 기반 Phase 6 evidence는 내부 release blocker가 아니다.
외부 공개 배포를 시작할 때만 `CODEXWINMUX_SMARTSCREEN_PUBLIC_RELEASE=1` strict mode와
`smoke:windows:smartscreen-public-evidence` 결과를 release blocker로 둔다.

내부 폐쇄망 gate는 다음 evidence를 기준으로 한다.

| 항목 | 내부 기준 |
| --- | --- |
| Windows signing | installer와 `win-unpacked/codexwinmux.exe` Authenticode `Valid`, timestamp present |
| SmartScreen scope | `CODEXWINMUX_SMARTSCREEN_STATUS=internal-not-required` 또는 `internal-trusted-root` |
| Runtime Phase 6 | Windows local 또는 폐쇄망 URL 기준 `smoke:runtime-v2:phase6-default-gate` 통과 |
| status/timeline stale UI | Windows temp/local smoke 통과 |
| Android | LAN dev/server URL 기준 install/foreground/runtime smoke 통과 |

이 기준에서는 public SmartScreen reputation 미확보가 legacy JSON fallback removal을 막지 않는다.

### 2026-05-16 Windows 0.4.17 설치 경로와 split stability evidence

사용자 직접 실행에서 `Cannot find module 'nanoid'` main process 오류가 발생해 Windows
packaged artifact를 재점검했다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| Standalone runtime dependency | 반영 | `.next/standalone/main.js`가 직접 `require("nanoid")`, `require("zod")`를 호출하지만 standalone `node_modules`에 top-level package가 없어 직접 실행에서 실패했다. `scripts/post-build.js --electron`이 `nanoid`, `zod`를 보강하도록 수정했고 `smoke:windows:zip-artifact`에 `zip-entry-standalone-runtime-deps` 검증을 추가했다 |
| 실제 설치 경로 launch | 통과 | `release/codexwinmux-Setup-0.4.17.exe`를 기본 사용자 설치 경로 `C:\Users\yohan\AppData\Local\Programs\codexwinmux`에 silent install한 뒤 설치된 `codexwinmux.exe`로 `CODEXMUX_WINDOWS_PACKAGED_RUNTIME_V2=1 node scripts/smoke-windows-packaged-launch.mjs`를 실행했다. packaged launch, local health, cookie auth, runtime v2 workspace/tab/terminal WebSocket, workspace cleanup, console clean이 통과했다 |
| Split service stability hold | 통과 | `CODEXWINMUX_WINDOWS_SPLIT_LIFECYCLE_MUTATE=1 CODEXWINMUX_WINDOWS_SPLIT_LIFECYCLE_STABILITY_MS=180000 node scripts/smoke-windows-core-backend-split-lifecycle.mjs`가 실제 `codexwinmux-core`/`codexwinmux-backend` service install/start/restart 후 180초 동안 backend health sample 33개를 통과했다 |
| Legacy fallback removal gate | 0.4.17 기준 보류, 0.4.18에서 해소 | Backend/API entrypoint의 runtime supervisor direct import policy를 유지하고, default runtime storage read는 legacy JSON fallback 없이 typed failure로 fail closed한다. 0.4.17에서는 combined service의 in-process Core client fallback을 split service default-on 전까지 운영 기본 경로 보호용으로 남겼고, `0.4.18` split default-on에서 Backend in-process Core client fallback을 제거했다 |

### 2026-05-16 Windows 0.4.18 split default-on 진행

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| Source version bump | 반영 | `package.json` version을 `0.4.18`로 올렸다. Android 다음 빌드도 같은 package version에서 `versionName=0.4.18`, `versionCode=418`로 계산된다 |
| Backend Core transport default | 반영 | `resolveCoreEngineBackendTransportConfig()` 기본값을 `tcp`로 승격했고, `in-process`/invalid 요청도 in-process로 내려가지 않도록 fail-closed 처리했다 |
| UI-owned local engine split launch | 반영 | Electron main process가 owned local engine을 시작할 때 `--codexwinmux-core`와 `--codexwinmux-engine`을 paired process로 띄우고, Backend에는 `CODEXWINMUX_CORE_ENGINE_TRANSPORT=tcp`와 loopback Core endpoint를 주입한다 |
| Windows service default-on | 반영 | `scripts/windows-service.ps1` 기본 `-Mode`를 `split`으로 전환했고 `restart`를 split action에 추가했다. combined mode의 `install/start/restart/write-config`는 차단하고, 기존 combined service는 `status/health/stop/uninstall` migration cleanup에만 남긴다 |
| Backend in-process Core fallback | 제거 | `src/lib/core-engine/runtime-api.ts`에서 runtime Supervisor 직접 import와 in-process Core client 생성 경로를 제거했다. Core unavailable 상태는 TCP client request timeout/error로 fail closed한다 |
| Windows package gate | 통과 | `corepack pnpm pack:electron`으로 `0.4.18` Windows artifact를 재생성했고 `node scripts/smoke-windows-package-gate.mjs`가 zip/update metadata/updater local feed/packaged launch/engine lifecycle/Core IPC/Backend external Core attach/split lifecycle dry-run/packaged runtime v2/installer runtime v2를 통과했다. Service-running 환경에서는 package gate가 `windows:service-account:stop-services`/`restart-services`로 설치형 Electron smoke 구간을 격리하고 종료 후 split service를 복구한다. Updater local feed smoke는 pending update installer process를 temp root 기준으로 자동 종료하고 retry delete로 smoke root를 정리한다 |
| 실제 split service lifecycle | 통과 | old combined `codexwinmux` service를 uninstall한 뒤 `codexwinmux-core`/`codexwinmux-backend`를 기본 split mode로 install/start했다. `CODEXWINMUX_WINDOWS_SPLIT_LIFECYCLE_MUTATE=1 node scripts/smoke-windows-core-backend-split-lifecycle.mjs`와 이후 profile-aware service account restart/health가 통과했고 두 split service는 `Running/Automatic` 상태다 |
| Service account / NSIS 결정 | 전환 반영 | 내부 운영은 runbook-first로 유지하되 실제 split service account를 `codexwinmux-svc`로 전환했다. profile/data dir, Codex credential/session migration, ACL, `SeServiceLogonRight`, password rotation, profile-aware restart, health, reboot-readiness evidence가 통과했다. NSIS는 service 자동 설치가 아니라 `Windows service runbook (advanced)` default-off section만 제공한다 |
| Service account migration runbook | 반영 | `src/lib/windows-service-account.ts`, `scripts/windows-service-account.ps1`, `smoke:windows:service-account`를 추가했다. Plan은 service profile을 `C:\ProgramData\codexwinmux\service-profile`로 두고 `.codex` credential/session, `.codexwinmux` runtime data, ACL target, password rotation, restart/health, upgrade/uninstall/reboot gate를 secret redaction 상태로 검증한다 |
| Android 0.4.18 device/release smoke | 통과 | SM-S928N `R3CX10RTWFH`에서 `corepack pnpm android:build:debug`, `corepack pnpm android:install`, `corepack pnpm smoke:android:install` 통과. 설치 상태는 `versionName=0.4.18`, `versionCode=418`이다. `corepack pnpm android:bundle:release`와 `corepack pnpm smoke:android:release-aab`도 통과했고 AAB는 `expectedVersionName=0.4.18`, `expectedVersionCode=418`, `jarsigner-verify`를 확인했다. `corepack pnpm smoke:android:runtime-v2`는 foreground 2회 marker와 blocking console/logcat 0으로 통과했다 |
| Android LAN recovery full matrix | 통과 | Launcher reconnect smoke helper가 stale saved-server button을 클릭하지 않고 target URL로 직접 이동하도록 조정했다. Windows LAN dev server `http://<windows-host-lan-ip>:8132` 기준 `corepack pnpm smoke:android:recovery`가 network, HTTP 404, SSL failure 모두 launcher 복귀와 target 재연결, blocking console/logcat 0으로 통과했다 |

### 2026-05-17 Windows 0.4.19 signed rebuild

`20662fad` status/timeline stale UI source commit을 포함해 Windows artifact를 새 버전으로
재생성했다. 기존 `v0.4.18` tag/asset은 건드리지 않고, `v0.4.19` tag와 release asset을
새로 발행하는 경로만 허용한다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| Source version bump | 반영 | `package.json` version을 `0.4.19`로 올렸다. Android 다음 빌드도 같은 package version에서 `versionName=0.4.19`, `versionCode=419`로 계산된다 |
| Release immutability | 통과 | `corepack pnpm smoke:release-immutability`가 `v0.4.19` local tag, remote tag, GitHub Release 모두 사용 가능하다고 확인했다 |
| Signed Windows package build | 통과 | `CODEXWINMUX_WINDOWS_CERTIFICATE_SHA1=8C5F3B5030D3A54B1150C2C30CFD9868800DF0C6`, `CODEXWINMUX_WINDOWS_PUBLISHER_NAME=PureCVisor Desktop Node Internal Code Signing`, `CODEXWINMUX_WINDOWS_TIMESTAMP_SERVER=http://timestamp.digicert.com`를 지정해 `corepack pnpm pack:electron`을 재실행했다. `release/codexwinmux-Setup-0.4.19.exe`, `release/codexwinmux-0.4.19-win.zip`, `release/latest.yml`, blockmap, `win-unpacked`를 생성했다 |
| Code signing / timestamp | 통과 | `CODEXWINMUX_SMARTSCREEN_STATUS=internal-not-required CODEXWINMUX_SMARTSCREEN_ENVIRONMENT=internal-trusted-root-distribution corepack pnpm smoke:windows:signing-evidence`가 installer와 `win-unpacked/codexwinmux.exe` 모두 Authenticode `Valid`, DigiCert RFC3161 timestamp present, internal SmartScreen scope accepted로 확인했다 |
| Windows package gate | 통과 | signed artifact 기준 `corepack pnpm smoke:windows:package-gate`가 zip/update metadata/updater local feed/packaged launch/engine lifecycle/Core IPC/Backend external Core attach/split lifecycle dry-run/packaged runtime v2/installer runtime v2를 통과했다. Local feed smoke는 signed installer signature validation과 post-update launch까지 확인했다 |
| Windows release gate | 통과 | `corepack pnpm smoke:windows:release-gate`가 package script audit, Windows terminal runtime, preflight, service host/account, Core IPC, Backend external Core attach, split lifecycle dry-run, host diagnostics, Electron env/packaging, Codex session detection을 통과했다 |
| Regression / service health | 통과 | `corepack pnpm test`는 183 files / 874 tests passed, 1 skipped였고 `corepack pnpm tsc --noEmit`, `corepack pnpm lint`, `git diff --check`도 통과했다. `corepack pnpm windows:service-account:health`는 `version=0.4.19`, `commit=20662fad`, `buildTime=2026-05-16T21:32:26.563Z`를 반환했고 `verify-reboot-readiness`도 split service `Running/Automatic` 상태로 통과했다 |

### 2026-05-05 P2 -> P3 runtime v2 storage preflight

P2 terminal gate evidence를 보강하고 P3 storage default rollout 전 preflight를 실제
`~/.codexwinmux` 데이터 기준으로 다시 실행했다. Production live mode는 아직
`CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=off`,
`CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=write`이다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| P2 terminal gate | 통과 | `corepack pnpm smoke:runtime-v2:phase2`, browser reload/server restart/mode-off rollback 통과 |
| Browser reconnect DOM | 통과 | `corepack pnpm smoke:browser-reconnect`, `session-not-found` overlay, floating reconnect hidden, 새 터미널 복구 click path 통과 |
| live runtime health | 통과 | `/api/v2/runtime/health`가 storage/terminal/timeline/status worker `ok`, `storageV2Mode="write"`, `terminalV2Mode="off"` 반환 |
| live worker counters | 통과 | `/api/debug/perf` `services.runtimeWorkers.*`에서 `healthFailures=0`, `readyFailures=0`, `commandFailures=0`, `timeouts=0`, `restarts=0`, `errors=0` |
| P3 temp storage smokes | 통과 | `smoke:runtime-v2:storage-dry-run`, `storage-backup`, `storage-import`, `storage-write`, `storage-default-read`, `storage-shadow` 통과 |
| live storage dry-run | 통과 | `corepack pnpm runtime-v2:storage-dry-run`, `cutoverReady=true`, blocker 0, workspace 4개/tab 4개 |
| live storage backup | 통과 | `corepack pnpm runtime-v2:storage-backup`, `runtime-v2-storage-20260504T163816Z`, JSON/SQLite file 37개 복사 |
| live storage import | 통과 | `corepack pnpm runtime-v2:storage-import`, workspace 4개/pane 4개/tab 4개/message-history 5개 import, missing/invalid/prune 0 |

### 2026-05-05 runtime v2 live new-tabs/default cutover

`~/.config/systemd/user/codexmux.service.d/runtime-v2-shadow.conf`를
`CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs`,
`CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=default`로 전환하고
`systemctl --user daemon-reload`, `systemctl --user restart codexmux.service`를
실행했다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| live mode | 적용 | `/api/v2/runtime/health`가 `terminalV2Mode="new-tabs"`, `storageV2Mode="default"` 반환 |
| systemd | 통과 | `ActiveState=active`, `SubState=running`, `NRestarts=0`, `ExecMainPID=1644017` |
| live app-surface new tab | 통과 | 임시 workspace에서 plain terminal tab 생성 시 legacy layout `runtimeVersion=2`, `rtv2-` session name, runtime storage projection 확인 후 workspace 삭제 |
| live runtime target smoke | 통과 | `CODEXWINMUX_RUNTIME_V2_SMOKE_URL=http://127.0.0.1:8122 corepack pnpm smoke:runtime-v2:target`, attach/stdin/stdout/resize/web-stdin/heartbeat/fresh reattach/fanout/backpressure/tab delete/workspace delete 통과 |
| rollback window canary | 통과 | 30초 간격 6회 poll 동안 mode 유지, worker restart/timeout/failure 0, service `NRestarts=0` |
| journal | 통과 | 최종 `journalctl --user -u codexmux.service --since '5 minutes ago' -p warning..alert` entries 없음 |
| observation closeout | 운영자 승인 완료 처리 | 2026-05-05 14:20 KST 기준 `/api/v2/runtime/health` all workers ok, `terminalV2Mode="new-tabs"`, `storageV2Mode="default"`, runtime worker restart/timeout/failure 0, systemd `ActiveState=active`, `SubState=running`, `NRestarts=0`, warning-or-higher journal 없음. 원래 24시간 clock gate 종료 시각인 2026-05-06 01:42 KST 전 closeout이므로 elapsed-time pass가 아니라 operator-approved closeout으로 기록한다. |

P0/P1/P2/P3 후속 상태:

- P0 완료: Android Tailscale Serve HTTPS 접속, failure recovery 반복, foreground reconnect, fresh app data clear first-run, app info bridge 확인, login route console noise 제거, permission prompt status/tmux E2E smoke 자동화.
- P0 남음: 자동 개발로 처리 가능한 code/runtime blocking 항목은 없음. 실제 기기/OS가 필요한 장시간/외부 smoke는 P1 운영 검증으로 남긴다.
- P1 완료: Android foreground/recovery/runtime v2 smoke, app info/native restart smoke, Electron attach/runtime v2 smoke, M1 macOS `0.4.1` DMG/zip packaging, PWA/iPad readiness smoke, permission prompt smoke.
- P1 남음: 자동 개발로 처리 가능한 platform smoke 항목은 없음.
- P2 완료: runtime v2 phase2 gate, Electron/Android runtime v2 reconnect smoke, browser reconnect DOM smoke, live terminal `new-tabs` enable을 현재 코드 기준으로 확인했다.
- P2 남음: self-hosted Android device scheduling과 macOS packaged UX artifact 자동화. Release smoke artifact foundation은 browser reconnect smoke를 release workflow artifact로 보존하고, Android/Electron smoke scripts가 같은 sanitized JSON을 local 또는 self-hosted run에서 쓸 수 있게 완료했다. 추가로 `Platform Smoke Artifacts` 수동 workflow가 browser reconnect, GitHub-hosted macOS Electron runtime v2, self-hosted Android device artifact 수집 경로를 분리했다. `smoke:ops:batch`는 browser reconnect와 선택적 PWA/runtime target check를 local evidence artifact로 묶고, iPad/Mac 실기기 항목은 `manual-required`로 표시한다. 실제 Android runner provision과 packaged Mac UX evidence는 외부 운영 검증으로 남긴다. runtime v2 shadow/new-tabs/default 24시간 worker restart-loop 관찰은 2026-05-05 14:20 KST에 운영자 승인 closeout으로 완료 처리했다. 원래 24시간 clock gate 종료 시각은 2026-05-06 01:42 KST였으므로 이는 elapsed-time pass가 아니라 operator-approved closeout이다.
- P3 진행: storage `default` live mode로 전환했고 dry-run, backup, import, write, default-read, shadow preflight와 initial rollback window canary를 통과했다. Android release signing/AAB는 로컬 keystore 권한 보정, fresh AAB build, `smoke:android:release-aab` 검증 자동화까지 완료했다. Windows package/update path는 실제 Windows host에서 local feed, published channel, full GitHub updater install smoke까지 통과했고, `0.4.16` signed local package gate와 signing evidence도 재검증했다. `0.4.16` installer와 `win-unpacked/codexwinmux.exe`는 `CN=PureCVisor Desktop Node Internal Code Signing`으로 Authenticode valid, DigiCert RFC3161 timestamp present, internal SmartScreen scope accepted 상태다. Public SmartScreen은 `smoke:windows:smartscreen-public-evidence`로 clean Windows public launch evidence JSON을 수집하고, signing evidence strict mode가 그 JSON만 public `passed`로 받도록 정리했다. 다만 v0.4.15 public installer 재실행은 browser download/SHA256/ZoneId까지만 통과하고 launch evidence가 failed라 reputation 확보 항목은 아직 닫지 않는다. Status/timeline stale UI 전용 evidence는 Windows temp runtime v2 default server에서 native background socket close, background JSONL/status mutation, foreground reconnect UI refresh로 통과했다. Perf snapshot baseline은 runtime v2 default 전환 뒤 2026-05-05 02:21 KST에 재수집했고, 2026-05-07 packaged `0.4.8` snapshot에서는 worker failure/restart/error 0으로 추가 튜닝 대상이 발견되지 않았다. Approval queue 1차와 metadata slice는 notification panel에서 pending permission prompt를 직접 처리하고 command/file/permission/resume/conversation type, approval kind, risk badge를 표시하는 경로까지 구현했다. `vitest`, `smoke:permission`, `tsc`, `lint`, `build`와 실제 Codex CLI permission prompt live smoke를 통과했다.
- P3 남음: 내부 runtime env `CODEXMUX_RUNTIME_*` fallback 제거는 `0.4.15`에서 완료했고, storage/timeline/status smoke fixture, storage dry-run/import/backup utility, `.mjs`/Windows/Electron/Android smoke wrapper, Electron bootstrap, Windows service host의 runtime 입력도 `CODEXWINMUX_RUNTIME_*`로 전환했다. WSL/tmux temp copy에서 `timeline-live-shadow`, `timeline-resume-safety`, `timeline-session-changed`, `timeline-websocket-default`, `status-default` smoke가 통과했다. 2026-05-14 Windows host에서도 `status-default`와 `timeline-websocket-default`가 runtime tab/tmux-free fixture로 통과했고, `node dist/server.js`로 띄운 Windows local target에서 `smoke:runtime-v2:phase6-default-gate`가 terminal `new-tabs`, storage/timeline/status `default`, worker counter clean으로 통과했다. Lifecycle control은 allowlisted action과 rollback flag mutation/systemd drop-in 편집 자동화까지 완료했고, `corepack pnpm lifecycle:rollback-dry-run`은 현재 drop-in과 target flag를 mutation 없이 JSON으로 출력하며 `corepack pnpm lifecycle:rollback-apply`는 backup/write/reload/restart를 수행한다. 실제 운영 환경 mutation rollback drill evidence는 아직 남는다. Timeline Phase 4 WebSocket default ownership, Status Phase 5 live bridge, Phase 6 default gate/code fallback default 전환은 smoke 기준 완료됐다. 2026-05-14 기준 Windows-local browser sync, Electron runtime v2 smoke, Android runtime v2 foreground smoke는 통과했고 2026-05-15 기준 status/timeline stale UI evidence도 닫혔다. Published/public Phase 6 target evidence와 public SmartScreen launch evidence는 외부 공개 gate로만 유지한다. 내부 폐쇄망 기준 legacy JSON fallback 제거는 signed/local package, 폐쇄망 Phase 6 target, status/timeline stale UI evidence를 근거로 재개한다.

1. 장시간 Codex smoke test: 새 tab 생성, prompt 실행, tool call과 reasoning summary 표시, 상태 전이 확인.
2. permission/input prompt smoke test: `corepack pnpm smoke:permission`으로 pane capture 기반 option parsing, inline prompt 선택, stdin 전달, `needs-input` push와 ack 후 `busy` 복귀 확인. 실제 Codex CLI permission prompt는 live tab에서 `read-only` sandbox 실패 prompt를 띄워 notification panel `No` 선택, ack 후 `busy` 복귀, denied command 미실행까지 확인한다. Resume working directory prompt는 `/api/tmux/permission-options`가 `Use session directory`/`Use current directory` 선택지를 반환하고 notification panel이 `needs-input`으로 보여주는지 확인한다. JSONL marker 없는 `Conversation interrupted` prompt는 stale `busy`가 `idle`로 풀리는지 확인한다.
3. stats smoke test: `/api/stats/*` endpoint와 실제 `~/.codex/sessions` 집계 확인.
4. daily report smoke test: `codex exec` 성공/실패, cache 재사용 확인.
5. macOS packaging: Linux release host에서는 `corepack pnpm build:electron`까지 확인하고, `.app`/`.dmg` 산출물은 macOS host에서 `corepack pnpm pack:electron:dev`로 생성한다.
6. Android packaging: `corepack pnpm android:build:debug`, `corepack pnpm android:install`, `corepack pnpm smoke:android:install`로 package install state 확인. release AAB는 `corepack pnpm android:keystore`, `corepack pnpm android:bundle:release`, `corepack pnpm smoke:android:release-aab` 순서로 확인한다. 현재 `0.4.19` 기준 `versionName=0.4.19`, `versionCode=419`이어야 한다.
7. 모바일 reconnect smoke test: Android WebView는 `smoke:android:foreground`로 반복 확인한다. iPad/PWA install readiness는 `corepack pnpm smoke:pwa`로 manifest/head/icon/splash/service worker/iPad viewport console을 먼저 확인한다. iOS startup image는 `scripts/generate-splash.js`가 만든 `codexmux` branding이어야 하며, 기존 Home Screen 앱의 오래된 splash는 iOS cache 때문에 앱 재추가로 확인한다. 실제 iPad Home Screen 장시간 background와 입력 draft 보존, timeline 중복 출력 방지는 별도 수동 smoke로 남긴다.
8. Android Tailscale 실패 smoke test: `smoke:android:recovery`가 network/HTTP 4xx/SSL을 자동 확인한다. 실제 Tailscale 미연결과 서버 장시간 중지는 별도 수동 smoke로 남긴다.
9. Android app info/restart smoke test: launcher와 server 접속 후 mobile navigation에서 앱 정보가 표시되고 앱 재시작 버튼이 WebView/Activity를 다시 여는지 확인.
10. DIFF smoke test: tracked 변경 20개 이상, untracked 50개 초과, binary/대용량 파일이 있는 저장소에서 응답 시간, 생략 안내, 기본 접힘 렌더링 확인.
11. systemd smoke test: `corepack pnpm deploy:local`, `/api/health`의 version/commit/buildTime, `journalctl --user -u codexmux.service` 확인.
12. timeline 배포 smoke test: browser reload 후 같은 assistant 문장이 `event_msg.agent_message`와 `response_item.message` pair로 남은 JSONL에서도 한 번만 표시되는지 확인.
13. Codex attach smoke test: Codex process 시작 후 JSONL이 늦게 생성된 session도 session id/jsonlPath가 붙고, 모바일 CODEX `check` 화면에서 terminal preview가 보이는지 확인.
14. perf snapshot smoke test: 인증된 요청으로 `/api/debug/perf`가 process/event loop/WebSocket/watcher/status poll/diff/stats counter를 반환하고, prompt/cwd/JSONL path/terminal output 본문을 노출하지 않는지 확인.
15. 설치/upgrade: `npx codexwinmux`, `cwmux`, global install, 기존 `~/.codexwinmux` 유지 확인. legacy `codexmux`/`cmux` CLI alias는 sunset 이후 새 package에서 제공하지 않는다.
16. release metadata: `corepack pnpm release:patch|minor|major`, changelog, release workflow artifact 확인. 이미 local/remote tag나 GitHub Release가 있는 version은 `corepack pnpm smoke:release-immutability`에서 실패해야 하며, 같은 version asset을 덮어쓰지 않는다.
17. Runtime v2 cutover readiness: `docs/RUNTIME-V2-CUTOVER.md`와 `docs/RUNTIME-V2-PARITY.md`의 phase gate, rollback flag, temp HOME/DB smoke를 release candidate commit 기준으로 확인한다. Phase 1 shadow는 live `codexmux.service` drop-in으로 `CODEXWINMUX_RUNTIME_V2=1`과 surface modes `off`를 켠 뒤 `/api/v2/runtime/health`, `/api/debug/perf`, live target `corepack pnpm smoke:runtime-v2`를 확인하고 24시간 restart-loop 부재를 관찰한다. Phase 2 terminal gate는 `corepack pnpm smoke:runtime-v2:phase2`로 browser reload/server restart/mode-off rollback을 먼저 통과시킨 뒤 `corepack pnpm smoke:electron:runtime-v2`와 `corepack pnpm smoke:android:runtime-v2`의 page-context attach/output/reconnect, systemd 검증 증거를 추가한다. Phase 3 storage gate는 `corepack pnpm smoke:runtime-v2:storage-dry-run`, `corepack pnpm runtime-v2:storage-dry-run`, `corepack pnpm smoke:runtime-v2:storage-backup`, `corepack pnpm runtime-v2:storage-backup`, `corepack pnpm smoke:runtime-v2:storage-import`, `corepack pnpm runtime-v2:storage-import`, `corepack pnpm smoke:runtime-v2:storage-write`, `corepack pnpm smoke:runtime-v2:storage-default-read`, `corepack pnpm smoke:runtime-v2:storage-shadow`, `corepack pnpm smoke:runtime-v2:browser-sync`를 함께 확인한다. Phase 4 timeline은 `corepack pnpm smoke:runtime-v2:timeline-websocket-default`, `timeline-live-shadow`, `timeline-resume-safety`, `timeline-session-changed`, `smoke:android:timeline-foreground`를 확인한다. Phase 5 status는 `corepack pnpm smoke:runtime-v2:status-shadow`와 `corepack pnpm smoke:runtime-v2:status-default`를 확인한다. Phase 6 full default readiness는 `corepack pnpm smoke:runtime-v2:phase6-default-gate`로 target의 terminal `new-tabs`, storage/timeline/status `default`, worker failure/restart/timeout counter 0을 read-only로 확인한다. Code fallback default는 `CODEXWINMUX_RUNTIME_V2=1`과 unset surface mode env에서만 적용되며, explicit `off` rollback과 invalid-value fail-closed를 유지한다. packaged Electron은 `CODEXWINMUX_ELECTRON_APP_PATH=<release/.../codexwinmux.app> CODEXWINMUX_ELECTRON_WINDOW_FOREGROUND_CYCLES=1 corepack pnpm smoke:electron:runtime-v2`로 CLI smoke를 먼저 통과시키고, Finder/Gatekeeper UX는 Mac 화면 세션 smoke로 별도 확인한다.
18. Browser reconnect DOM smoke: `corepack pnpm smoke:browser-reconnect`로 temp server/workspace에서 `session-not-found` 복구 overlay와 floating reconnect control 중복 렌더링이 없는지 Playwright Chromium pointer 동작까지 확인한다. Release workflow는 `CODEXWINMUX_SMOKE_ARTIFACT_DIR=artifacts/smoke pnpm smoke:browser-reconnect`를 실행하고 `smoke-browser-reconnect` artifact를 14일 보존한다. 기존 `CODEXMUX_SMOKE_ARTIFACT_DIR`은 호환 fallback이다.
19. Windows package/update smoke: Windows host에서 `corepack pnpm pack:electron`, `corepack pnpm smoke:windows:updater-local-feed`, `corepack pnpm smoke:windows:updater-published-channel`, `corepack pnpm smoke:windows:updater-github-feed`, `corepack pnpm smoke:windows:package-gate`, `corepack pnpm smoke:windows:release-gate`를 확인한다. Local feed smoke는 실제 remote release publication이 아니라 installer/update engine/download/install mechanics evidence로 해석하며, temp smoke root 아래 pending update installer process와 설치 폴더 delete retry까지 자동 cleanup evidence에 포함한다. Published channel smoke는 GitHub Releases asset이 발행된 뒤 `latest.yml`, installer, blockmap, newer semver를 확인하는 read-only gate다. GitHub feed smoke는 실제 설치된 이전 버전에서 published asset download/install/`quitAndInstall`과 updated installed app launch까지 확인하는 mutating gate다.

## Post-MVP 백로그

### Codex lifecycle

- `~/.codex/state_*.sqlite` read-only indexer 검토.
- stable timeline id가 provider별 record identity에 맞게 확장되는지 app-server fixture로 검증했다.

### Approval workflow

- approval queue 1차는 notification panel의 `needs-input` section에서 Codex permission/input prompt 선택지를 직접 처리한다. 실제 Codex CLI permission prompt live smoke와 resume directory prompt option parsing은 통과했다.
- approval queue metadata slice는 command/file/permission/resume/conversation type, approval kind, risk badge, sanitized command/file detail을 전역 notification panel에 표시한다. API option label은 기존 option index 선택 호환을 위해 CLI 선택지 텍스트를 유지한다.
- approval queue push/audit slice는 Web Push 새 창 fallback을 root deep link query로 복구하고, 선택지 표시/fallback/선택 전송 성공/실패를 `~/.codexwinmux/approval-audit.jsonl`에 원문 없이 append한다.
- mobile lock-screen copy는 pane recovery가 status entry에 저장한 sanitized `approvalPromptMetadata`를 사용해 command/file/permission type, risk, concise detail을 표시한다. metadata가 없으면 기존 last user message/tab name fallback을 유지한다.
- pane capture 실패 시 option API는 500 대신 `capture-failed` fallback을 반환하고, notification panel은 terminal에서 직접 선택하라는 한국어/영어 안내를 표시한다. audit에는 fallback reason만 저장하고 terminal output은 저장하지 않는다.

### App-server adapter

- Codex CLI `app-server` protocol은 `0.128.0` 기준 experimental이다.
- `src/lib/providers/codex-app-server`에 guarded protocol adapter를 추가했다. app-server `ThreadItem.id`를 provider record identity로 사용해 user/assistant/reasoning/command/sub-agent item을 timeline entry로 변환한다.
- 아직 runtime provider로 등록하지 않는다. `listProviders()` 기본값은 계속 `codex` 하나이며, tmux/JSONL path는 production fallback이 아니라 production owner로 유지한다.
- 신뢰 가능한 approval/status event를 app-server에서 받을 수 있는지 확인되면 별도 spec과 gate로 runtime provider 등록을 판단한다.

### Mobile app

- Android release signing은 로컬 keystore 보관형으로 운영한다. `android/release.keystore`와 `android/keystore.properties`는 git ignore와 `600` 권한을 유지하고, AAB는 `corepack pnpm android:bundle:release` 후 `corepack pnpm smoke:android:release-aab`로 fresh artifact/signature를 확인한다. Play Console upload와 internal testing 증거 보존은 배포 운영 단계에서 추가한다.
- 모바일 WebView에서 장시간 reconnect, push click, input draft 보존을 반복 검증.
- iPad는 Safari + 홈 화면 추가를 기본 지원 경로로 유지한다. Startup image/icon branding 변경은 PWA 정적 자산 배포 후 기존 Home Screen 앱 재추가까지 확인한다.
- iOS native shell이 필요하면 Capacitor iOS project와 Xcode signing/deploy flow를 별도 검토.

### Architecture modularization

- `timeline-server.ts`는 shared state에 이어 subscription service, file watcher service, resume service를 별도 파일로 분리했다. WebSocket lifecycle과 provider/tmux 연결은 아직 `timeline-server.ts`가 소유한다.
- `status-manager.ts`는 순수 정책 helper에 이어 Web Push/history side effect adapter를 분리했다. StatusManager는 상태 전이, dedupe, workspace/config 조회를 유지하고 runtime default/legacy fallback 세부 구현은 adapter가 담당한다.
- provider를 추가할 때는 `IAgentProvider` contract test와 JSONL fixture를 먼저 추가한다.
- runtime v2 production 전환은 `docs/RUNTIME-V2-CUTOVER.md`의 surface별 flag와 rollback gate를 따른다. terminal, storage, timeline, status를 한 release에서 동시에 기본값으로 전환하지 않는다.
- runtime v2 parity는 `docs/RUNTIME-V2-PARITY.md`의 surface row별 owner, migration, test, rollback을 먼저 채운 뒤 surface mode를 바꾼다.
- Lifecycle Control은 evidence surface와 allowlisted action launcher를 제공한다. 현재 UI 실행 범위는 Phase 6 gate, `codexmux.service` restart, local deploy, rollback flag mutation으로 제한되며 audit은 sanitized JSONL status event만 남긴다. `lifecycle:rollback-dry-run`은 현재 drop-in과 target rollback flag를 read-only로 보여주고, `lifecycle:rollback-apply`/`rollback-runtime-flags` action은 기존 drop-in backup 뒤 storage `write`, terminal/timeline/status `off`, `CODEXWINMUX_RUNTIME_V2=1`을 쓰고 service를 재시작한다. 실제 운영 rollback drill 증거 수집은 별도 운영 항목으로 남긴다.

### Performance

- `/api/debug/perf` snapshot을 배포 환경에서 수집해 timeline render, status poll, diff, stats 중 실제 병목을 먼저 확인한다. 2026-05-06 측정에서는 stats cold cache build가 약 3.17초로 가장 컸고, stats JSONL parser/cache에 경로 날짜 기반 file filtering을 적용했다. 후속으로 projects/sessions 동시 요청이 같은 parsed session summary를 공유하도록 `stats.session_parse.<period>` in-flight/cache reuse를 추가했다.
- timeline virtualization은 `content-visibility` 이후 grouped item windowed render까지 적용했다. 긴 timeline은 tail/middle visible range와 spacer로 DOM row 수를 제한하고, 다음 단계는 긴 실제 JSONL에서 scroll 상단/중간/하단, load-more, permission prompt, mobile foreground reconnect smoke로 row height 추정을 보정한다.
- session meta message count는 전용 streaming helper로 분리했다. 다음 단계는 실제 긴 JSONL에서 `timeline.message_counts.read` duration과 cache hit 비율을 보고 추가 index화가 필요한지 판단한다.
- session index는 refresh 결과가 unchanged이면 persisted file write를 건너뛴다. Phase 6 default 이후 main server는 runtime v2 timeline default에서 legacy session index startup prewarm을 건너뛰어 15초 주기 JSONL scan 중복 비용을 줄인다. Legacy/shadow/off mode와 fallback lazy initialization은 유지한다.
- session list request는 index에서 requested page만 변환한다. 다음 단계는 session list 체감 지연이 계속 보일 때 search/filter도 index 단계로 내리는지 판단한다.
- terminal stdout burst는 server에서 짧게 coalescing한다. 다음 단계는 `/api/debug/perf`의 raw chunk 대비 sent message 감소율과 입력 지연 smoke를 같이 보고 flush window 조정 여부를 결정한다.
- StatusManager adaptive scheduling은 `unknown`, `needs-input`, `ready-for-review` 지연을 측정한 뒤 active/background workspace 정책으로 분리한다.
- Runtime v2 shadow mode는 `/api/debug/perf`의 `services.runtimeWorkers` counters로 worker health, readiness, restart, timeout, command failure를 먼저 확인한다. payload, session id/name, cwd, JSONL path, prompt, assistant text, terminal output은 diagnostics에 넣지 않는다.

### 문서와 운영

- 문서는 한국어 원문을 기준으로 유지한다.
- Codex CLI option이 바뀌면 README, `docs/`, landing docs, settings copy를 함께 갱신한다.
- smoke test 결과는 release note 또는 `docs/`에 반영한다.

## 운영 메모

- `~/.codex`는 Codex CLI 소유이며 codexwinmux는 읽기 전용으로 접근한다.
- 새 기능은 Codex provider 또는 provider-neutral boundary에 추가한다.
- tmux/socket/session naming은 release 전 다시 바꾸지 않는다.
