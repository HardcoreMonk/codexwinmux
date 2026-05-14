# Runtime v2 Production Cutover Plan

이 문서는 Supervisor + Worker runtime v2를 production 기본 경로로 전환하기 위한 단계별 기준이다.

## Current State

완료된 foundation:

- Storage Worker: SQLite schema, workspace create/list/layout, terminal tab create/delete, workspace delete cleanup.
- Terminal Worker: v2 tmux socket `codexmux-runtime-v2`, `rtv2-` session create/attach/stdin/stdout/resize/detach/kill, subscriber fanout, backpressure, startup reconciliation.
- Timeline Worker: `timeline.health`, session list, older entry read, message counts, live shadow subscribe/append/error IPC, and internal session watcher subscribe/unsubscribe IPC.
- Status Worker: policy-only hook/Codex reducer와 notification gating.
- Shadow diagnostics: server startup calls runtime v2 health without blocking legacy startup, and `/api/debug/perf` exposes worker health/readiness/restart/timeout counters.
- Terminal identity: newly created legacy tabs carry `runtimeVersion: 1`, runtime v2 tabs carry `runtimeVersion: 2`, and missing `runtimeVersion` is treated as legacy for existing JSON layouts.
- Smoke: `/api/v2/terminal` attach/input/output/resize/web stdin/heartbeat/fresh reattach/fanout/backpressure close/tab delete/tab restart/workspace delete, plus Phase 2 app-surface new-tab gate for browser reload, server restart, and terminal mode rollback.
- 2026-05-04 Phase 1 shadow: live `codexmux.service`에 `CODEXWINMUX_RUNTIME_V2=1`과 storage/terminal/timeline/status surface mode `off`를 적용했다. `/api/v2/runtime/health`는 모든 worker ok와 `terminalV2Mode: "off"`를 반환한다. `/api/debug/perf`는 각 worker `starts=1`, `readyFailures=0`, `healthFailures=0`, `timeouts=0`, `restarts=0`을 보여준다. 24시간 restart-loop 관찰 항목은 2026-05-05 14:20 KST operator-approved closeout으로 완료 처리했다.
- 2026-05-04 release smoke snapshot: `v0.4.1` commit `23fee4b`가 live deploy 되었고 `/api/health`는 `version=0.4.1`을 반환한다. `corepack pnpm release:patch`는 lint, unit test 92 files/441 tests, `tsc --noEmit`, production build, release commit/tag/push를 통과했다. `corepack pnpm build:electron`, M1 macOS `pnpm pack:electron:dev`, Android debug build/install, Android Tailscale failure recovery, Android production 60초 foreground reconnect, Android runtime v2 foreground, stats/daily report, permission prompt, systemd deploy health가 통과했다. Electron page-context smoke는 existing-cookie `/api/v2/terminal` attach/output plus 2회 page reload/reconnect를 검증했고, Android runtime v2 smoke는 SM-S928N Android 16에서 initial + 2회 foreground marker output을 검증했다. Runtime v2 reconnect recovery now covers Terminal Worker retryable close, `session-not-found` tab/session recreation through Supervisor, and desktop/mobile blocking overlay hiding the stale floating reconnect control. macOS packaging created `0.4.1` arm64/x64 DMG and zip artifacts with native binding/arch/Info.plist/`hdiutil verify` evidence.
- 2026-05-04 storage dry-run: `corepack pnpm runtime-v2:storage-dry-run`가 실제 `~/.codexmux` JSON stores를 쓰기 없이 읽고, `workspaces.json`과 workspace별 `layout.json` backup manifest, import readiness, count-only summary를 출력한다. live dry-run은 `cutoverReady: true`, blocker 0이다. `corepack pnpm smoke:runtime-v2:storage-dry-run`는 fixture에서 import 가능 상태와 cwd/workspace name/session name/prompt 비노출을 검증한다.
- 2026-05-04 storage backup export: `corepack pnpm runtime-v2:storage-backup`가 `workspaces.json`, `workspaces/**.json`, `runtime-v2/state.db*`를 `~/.codexmux/backups/runtime-v2-storage-{timestamp}/`로 복사한다. live export snapshot은 29개 파일을 복사했고 원본 삭제나 migration은 수행하지 않았다.
- 2026-05-04 storage import: schema v2가 `tabs.runtime_version`과 `workspaces.active_pane_id`를 추가했고, schema v3가 `workspace_directories`, `app_state`, `message_history`를 추가했다. `corepack pnpm runtime-v2:storage-import`는 legacy JSON workspace/layout/message-history snapshot을 SQLite로 idempotent import하며 grouped workspace, split layout, active/sidebar state, workspace directory list, message history, legacy `runtimeVersion: 1` terminal tab, non-terminal tab, tab status metadata를 보존한다. Runtime v2 terminal attach/cleanup은 imported legacy `pt-` session을 대상으로 삼지 않도록 `runtime_version=2` terminal tab으로 제한된다. live import snapshot은 workspace 5개, group 1개, pane 5개, tab 5개를 import했고 dry-run blocker는 0이다. message-history import는 temp smoke로 검증됐으며 production default rollout 전 live import를 다시 실행한다.
- 2026-05-04 storage write mirror/default read: `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=write|default`에서 legacy JSON workspace/layout/message-history write 직후 SQLite import mirror를 best-effort로 수행한다. `corepack pnpm smoke:runtime-v2:storage-write`는 layout write, SQLite projection, status metadata 보존을 temp HOME/DB에서 검증한다. `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=default`에서는 workspace/layout/message-history read가 SQLite projection을 우선 사용하고 실패 시 JSON으로 fallback한다. `corepack pnpm smoke:runtime-v2:storage-default-read`는 SQLite cold read, workspace directory/sidebar/status/message-history hydration, legacy layout/updateActive write mirror 후 default read, message-history JSON fallback mirror를 temp HOME/DB에서 검증한다. Production live mode는 아직 `write`이며 live default rollout은 남아 있다.
- 2026-05-05 P2 -> P3 preflight: 현재 production `codexmux.service`는 `CODEXWINMUX_RUNTIME_V2=1`, `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=write`, `CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=off`, timeline/status mode `off`이다. `corepack pnpm smoke:runtime-v2:phase2`와 `corepack pnpm smoke:browser-reconnect`가 현재 코드 기준 통과했고, live `/api/v2/runtime/health`는 모든 worker ok와 `storageV2Mode: "write"`, `terminalV2Mode: "off"`를 반환한다. `/api/debug/perf` worker counters는 storage/terminal/timeline/status 모두 `healthFailures=0`, `readyFailures=0`, `commandFailures=0`, `timeouts=0`, `restarts=0`, `errors=0`이다. P3 storage preflight는 temp `storage-dry-run`, `storage-backup`, `storage-import`, `storage-write`, `storage-default-read`, `storage-shadow` smoke를 통과했고, live `runtime-v2:storage-dry-run`은 `cutoverReady: true`, blocker 0, workspace 4개/tab 4개를 반환했다. live `runtime-v2:storage-backup`은 `runtime-v2-storage-20260504T163816Z`에 JSON/SQLite file 37개를 복사했고, live `runtime-v2:storage-import`는 workspace 4개/pane 4개/tab 4개/message-history 5개를 SQLite로 idempotent import했다. Production default rollout과 24시간 restart-loop 부재 관찰은 아직 닫지 않는다.
- 2026-05-05 live new-tabs/default cutover: `codexmux.service` drop-in을 `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=default`, `CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs`로 전환하고 service restart를 완료했다. `/api/v2/runtime/health`는 `terminalV2Mode: "new-tabs"`, `storageV2Mode: "default"`와 모든 worker ok를 반환한다. 임시 live workspace에서 plain terminal tab 생성이 legacy layout `runtimeVersion: 2`, `rtv2-` session name, runtime storage projection으로 확인됐고 workspace는 삭제됐다. `CODEXWINMUX_RUNTIME_V2_SMOKE_URL=http://127.0.0.1:8122 corepack pnpm smoke:runtime-v2:target`는 live target에서 attach/stdin/stdout/resize/web-stdin/heartbeat/fresh reattach/fanout/backpressure/tab delete/workspace delete를 통과했다. 30초 간격 6회 rollback window canary 동안 worker restart/timeout/failure 0, service `NRestarts=0`, 최종 warning journal 없음이다. 2026-05-05 14:20 KST에는 운영자 승인으로 observation을 closeout 처리했다. 원래 24시간 clock gate 종료 시각은 2026-05-06 01:42 KST였으므로 이 기록은 elapsed-time pass가 아니라 operator-approved closeout이다.
- 2026-05-05 lifecycle control UI/actions slice: `/experimental/runtime` 상단에 Lifecycle Control panel을 추가했다. 이 panel은 `/api/health`, `/api/v2/runtime/health`, `/api/debug/perf`를 normalize해 release metadata, terminal/storage/timeline/status mode, 24시간 observation gate, worker diagnostics, perf timing, rollback runbook을 같은 화면에 표시한다. 추가로 allowlisted action id만 받는 `/api/runtime/lifecycle/action`을 통해 `phase6-gate`, `restart-service`, `deploy-local`, `rollback-runtime-flags`를 실행할 수 있다. Restart/deploy/rollback은 exact confirmation phrase가 필요하고, audit은 `~/.codexmux/lifecycle-actions.jsonl`에 sanitized status event와 failure label만 남긴다. Endpoint 부분 실패는 가능한 section을 계속 렌더링하고 실패 section label만 노출하며, token/cwd/session/prompt/terminal output 원문은 표시하거나 저장하지 않는다. Rollback flag mutation과 systemd drop-in 편집은 `corepack pnpm lifecycle:rollback-dry-run`, `corepack pnpm lifecycle:rollback-apply`, Lifecycle Action `Apply Rollback Flags`로 자동화한다.
- 2026-05-05 timeline watcher/Android evidence deploy: `d3248c4`가 live deploy 되었고 `/api/health`는 `version=0.4.1`, `commit=d3248c4`를 반환한다. Timeline Worker는 `timeline.session-watch-subscribe`/`timeline.session-watch-unsubscribe`와 subscriber-scoped `timeline.session-changed` IPC foundation을 갖췄다. `corepack pnpm smoke:android:timeline-foreground`는 SM-S928N Android 16에서 `timelineV2Mode=default`, foreground 2회, `timeline:init totalEntries` 3/5/7, blocking console/logcat 0으로 통과했다.
- 2026-05-05 timeline WebSocket default ownership slice: `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=default`에서 client-facing `/api/timeline` WebSocket이 `handleRuntimeTimelineConnection()`을 통해 Timeline Worker live subscribe/session watch를 사용한다. 기존 URL과 auth/cookie contract는 유지하고, resume safety는 server helper의 process guard/sendKeys만 재사용하며 legacy file watcher에는 붙지 않는다. `corepack pnpm smoke:runtime-v2:timeline-websocket-default`, `timeline-live-shadow`, `timeline-resume-safety`, `timeline-session-changed`, `smoke:android:timeline-foreground`가 temp HOME/DB 기준 통과했다.
- 2026-05-05 Phase 6 code fallback default: `CODEXWINMUX_RUNTIME_V2=1`에서 per-surface mode env가 unset이면 terminal은 `new-tabs`, storage/timeline/status는 `default`로 해석한다. 명시적 `off`는 rollback으로 유지하고, 잘못된 명시 값은 `off`로 fail closed한다.
- 2026-05-08 lifecycle rollback automation: `corepack pnpm lifecycle:rollback-dry-run`은 현재 runtime drop-in과 target rollback flag를 mutation 없이 출력하고, `corepack pnpm lifecycle:rollback-apply`는 기존 drop-in을 timestamp `.bak`으로 백업한 뒤 storage `write`, terminal/timeline/status `off`, `CODEXWINMUX_RUNTIME_V2=1`을 쓰고 `systemctl --user daemon-reload`, `systemctl --user restart codexmux.service`를 실행한다. `/experimental/runtime`의 `rollback-runtime-flags` action은 같은 스크립트만 allowlist로 실행하며 confirmation phrase는 `rollback runtime v2`다.
- 2026-05-14 storage/status metadata write-through slice: `storage.patch-tab-status-metadata`와 `storage.get-tab-status-metadata`를 추가해 `agentSessionId`, `agentJsonlPath`, `agentSummary`, `lastUserMessage`, `cliState`, `dismissedAt`를 SQLite `tab_status`/`agent_sessions` contract로 갱신한다. `layout-store`의 timeline/status metadata helper는 storage default에서 Supervisor/Storage Worker를 호출한다. Status Worker live manager는 주입된 persistence adapter로 metadata를 갱신해 worker 내부에서 새 Supervisor를 띄우지 않는다. Direct v2 workspace/tab mutation API와 config/keybinding JSON mutation API는 기존 sync WebSocket invalidation을 broadcast한다.
- 2026-05-14 Windows runtime v2 follow-up: CLI tab creation은 `CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs`에서 Supervisor `createTerminalTab()`를 사용하도록 전환했고, storage default에서는 JSON layout append 없이 runtime storage tab을 app-facing 응답으로 반환한다. Layout tab 생성과 CLI tab 생성의 storage-default path는 직접 `layout` sync invalidation을 broadcast한다. `corepack pnpm smoke:runtime-v2:browser-sync`는 Windows checkout에서 tmux kill 없이 temp runtime v2 default server, Playwright Chromium, page-context `/api/sync` probe로 workspace mutation event와 sidebar UI 갱신을 확인했다. 이후 같은 Windows-local smoke를 workspace create/rename/group/order, layout tab create/patch/reorder/split/move/patch/close, config/keybinding refetch까지 확장했다. 브라우저 refetch는 `cache: 'no-store'`와 API `Cache-Control: no-store`로 304 캐시 경로를 차단하며, fixture는 빈 active workspace 자동 삭제와 충돌하지 않도록 v2 workspace 생성 직후 terminal tab을 함께 만든다. `corepack pnpm smoke:electron:runtime-v2`는 Windows process-tree cleanup 보정 뒤 기본 initial + 2 reconnect marker output으로 통과했다. ADB는 winget `Google.PlatformTools`로 설치했고 `adb devices -l`은 실행됐지만 연결된 Android 기기가 없어 `corepack pnpm smoke:android:runtime-v2`는 `connected=-`에서 중단됐다. `corepack pnpm smoke:runtime-v2:phase6-default-gate`는 live URL 미지정 때문에 외부/live evidence는 만들 수 없었고, temp runtime v2 default target을 명시한 로컬 gate만 통과했다. 이번 추가 검증은 Windows `codexwinmux` 로컬 앱 범위로 한정하며, Linux `codexmux` live service, Android app, Tailscale Serve 증거 수집은 별도 승인 전까지 보류한다. 따라서 legacy JSON fallback removal gate는 이 slice에서 닫지 않는다.

Production 기본 경로로 전환하지 않은 것:

- 기존 `/api/terminal`, `/api/status`, `/api/sync` WebSocket. `/api/timeline`은 URL은 그대로지만 timeline default mode에서 runtime bridge가 delivery를 소유한다.
- 기존 JSON layout/message-history fallback, storage off rollback JSON stores, config/keybinding stores.
- Status polling, JSONL watch, Web Push, session history write, dismiss/ack handling의 live ownership은 Status Worker default에 있지만 live foreground/stale UI evidence는 fallback 제거 전에 추가 확인한다.
- 기존 `pt-` tmux session의 `rtv2-` session migration.

## Cutover Rules

- Runtime v2 must stay behind explicit flags until the matching rollback path has passed smoke.
- Do not replace terminal, storage, timeline, and status in one release.
- New v2 defaults must first apply to newly created workspaces/tabs only. Existing `pt-` sessions remain legacy until migration is explicitly selected.
- Production data migration must be idempotent and must not delete JSON stores on first enable.
- Rollback must not require deleting `~/.codexmux/runtime-v2/state.db`.
- Worker readiness failure must fail closed to legacy where possible, not partially mix a v2 UI with missing workers.

## Feature Flags

Introduce separate flags instead of overloading `CODEXWINMUX_RUNTIME_V2`.

| Flag | Values | Purpose |
| --- | --- | --- |
| `CODEXWINMUX_RUNTIME_V2` | `0`, `1` | Starts Supervisor and workers. |
| `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE` | `off`, `shadow`, `write`, `default` | Controls SQLite workspace/layout ownership. |
| `CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE` | `off`, `opt-in`, `new-tabs`, `default` | Controls terminal tab creation/attach path. |
| `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE` | `off`, `shadow`, `default` | Controls timeline HTTP/WebSocket path. |
| `CODEXWINMUX_RUNTIME_STATUS_V2_MODE` | `off`, `shadow`, `default` | Controls status polling/WebSocket/notification path. |

`CODEXWINMUX_RUNTIME_V2=1` with every surface mode `off` should only start workers and expose v2 diagnostic endpoints.

## Phase 0: Parity Inventory

Before any default switch, create a checked parity matrix for every production surface:

- Workspace: create, rename, reorder, group, active workspace, validate cwd, layout split/move/order/delete/rename, message history.
- Terminal: attach, stdin, web stdin, resize, heartbeat, kill, backpressure, reconnect, mobile foreground reconnect, Electron/Android WebView cookie auth.
- Timeline: init, append, subscribe/unsubscribe, resume, session-changed, load-more, message counts, session list paging.
- Status: initial sync, update/remove, hook/statusline events, needs-input ack, dismiss, ready-for-review notification, Web Push, session history.
- Sync: workspace/layout/config invalidation for browser, Electron, Android, and CLI clients.

Exit gate:

- Each row has owner module, v1 behavior, v2 behavior, migration strategy, test command, rollback behavior.
- `docs/RUNTIME-V2-PARITY.md` is the canonical matrix and must be updated before changing any surface mode.

## Phase 1: Shadow Runtime

Goal: run all workers in production while legacy remains the only user-facing path.

Work:

- Start `CODEXWINMUX_RUNTIME_V2=1` in production service.
- Add `/api/debug/perf` counters for each worker readiness, restart, timeout, and command error.
- Add a startup diagnostic that calls `runtime.health` and records worker health without blocking legacy startup.
- Run `corepack pnpm smoke:runtime-v2` against a managed temp HOME/DB server in CI and
  `CODEXWINMUX_RUNTIME_V2_SMOKE_URL=<live-url> corepack pnpm smoke:runtime-v2` against the
  production host after shadow runtime is enabled.

Exit gate:

- No worker restart loop over 24 hours.
- `/api/debug/perf` `services.runtimeWorkers.{storage,terminal,timeline,status}` shows health, readiness, restart, timeout, and command failure counters without session ids, cwd, JSONL paths, prompts, assistant text, or terminal output.
- `/experimental/runtime` Lifecycle Control panel can be used as the evidence surface for release metadata, surface mode, worker counter, perf timing, and 24h observation gate snapshots. Its executable controls are limited to the allowlisted Phase 6 gate, service restart, local deploy, and rollback flag mutation actions.
- `corepack pnpm build` includes storage, terminal, timeline, and status worker bundles.
- `scripts/smoke-runtime-v2.mjs` passes on the production host with temp HOME/DB.

Rollback:

- Set `CODEXWINMUX_RUNTIME_V2=0`; legacy routes are unchanged.

## Phase 2: Terminal v2 For New Tabs

Goal: let selected users create new terminal tabs through v2 while legacy tabs stay on `pt-`.

Work:

- Add UI/server routing that chooses v2 only for newly created terminal tabs when `CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs`.
- Keep existing `pt-` sessions and legacy JSON layout as the UI source of truth.
- Make tab identity explicit in UI state: `runtimeVersion: 1 | 2`.
- Parse `CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE` through `src/lib/runtime/terminal-mode.ts`; unknown values fail closed to `off`.
- After Phase 6, unset terminal mode falls back to `new-tabs` only when `CODEXWINMUX_RUNTIME_V2=1`; explicit `off` and invalid values still fail closed.
- Ensure close/delete uses the matching runtime cleanup path.
- Ensure restart uses the matching runtime path: runtime v2 tabs must be recreated
  through Supervisor/Storage/Terminal Worker with the same tab id and `rtv2-`
  session name, not through the legacy tmux socket.
- In the first new-tabs slice, route only plain terminal tab creation through v2. Codex, diff, web-browser, resume, and command-start tabs remain legacy.
- Mirror the legacy workspace/pane id into runtime v2 storage, then append the returned `rtv2-` tab back into legacy JSON layout with `runtimeVersion: 2`.
- Keep `scripts/smoke-runtime-v2.mjs` for low-level runtime terminal parity and `scripts/smoke-runtime-v2-phase2-gate.mjs` for app-surface new-tab routing, browser reload, server restart, and rollback mode checks.
- Collect Electron reconnect and Android foreground reconnect cookie-auth evidence against the same app surface before widening Phase 2. `corepack pnpm smoke:electron:runtime-v2` covers Electron page-context cookie-auth attach/output and page reload/reconnect repetition, and `CODEXMUX_ELECTRON_APP_PATH=<release/.../codexmux.app> CODEXMUX_ELECTRON_WINDOW_FOREGROUND_CYCLES=1 corepack pnpm smoke:electron:runtime-v2` covers packaged `.app` CLI launch plus CDP foreground probe attach repetition on macOS. The foreground probe records whether it used `Browser.*` window bounds or `Target.activateTarget` fallback. `corepack pnpm smoke:android:runtime-v2` covers Android WebView cookie-auth attach/output and foreground reconnect repetition. Finder double-click and Gatekeeper prompt UX still need interactive Mac evidence.

Exit gate:

- `corepack pnpm smoke:runtime-v2:phase2` passes and proves new v2 tabs survive browser reload and server restart while legacy tabs stay on `/api/terminal`.
- Runtime v2 tab restart after `session-not-found` recreates the same tab/session
  through Supervisor and reconnect controls remain actionable; blocking recovery
  overlays must not leave a visible but unclickable floating reconnect control.
- Electron page-context reconnect and Android foreground reconnect smoke pass with existing session cookie auth on `/api/v2/terminal`.
- Android production legacy foreground reconnect passing is necessary but not sufficient for this exit gate; `corepack pnpm smoke:android:runtime-v2` is the Android `/api/v2/terminal` evidence for the current new-tabs slice.
- Legacy tabs continue to attach through `/api/terminal`.
- Rollback mode `off` blocks new v2 tab creation, `/api/v2/runtime/health` reports `terminalV2Mode: "off"`, and existing v2 tabs remain visible with a clear `runtime-v2-disabled` diagnostic state.

Rollback:

- Switch `CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=off`.
- Keep `state.db` and v2 tmux sessions for explicit recovery; do not auto-delete.

## Phase 3: Storage v2 Shadow Then Default

Goal: move workspace/layout/tab source of truth to SQLite safely.

Work:

- Implement idempotent JSON-to-SQLite migration with dry-run output.
- Add shadow read comparison: legacy JSON projection vs SQLite projection.
- Current first slice: `corepack pnpm smoke:runtime-v2:storage-shadow`가 legacy JSON에 mirror된 `runtimeVersion: 2` tab과 SQLite runtime layout projection을 비교한다. 이 비교는 v2 tab subset의 상대 순서를 사용하며 cwd 값을 출력하지 않는다.
- Current dry-run slice: `corepack pnpm runtime-v2:storage-dry-run`는 production JSON stores를 read-only로 검사하고, `workspaces.json`/`workspaces/<workspaceId>/layout.json` backup manifest와 blocker code를 출력한다. `corepack pnpm smoke:runtime-v2:storage-dry-run`는 민감 값 비노출을 자동 확인한다.
- Add dual-write only where operations can preserve ordering and transaction semantics; otherwise keep v1 write and v2 shadow import.
- Current backup slice: `corepack pnpm runtime-v2:storage-backup` copies legacy JSON stores and `runtime-v2/state.db*` into `~/.codexmux/backups/runtime-v2-storage-{timestamp}/`.
- Current import slice: `corepack pnpm runtime-v2:storage-import` imports workspace/layout/message-history JSON stores into SQLite schema v3 without switching production source of truth.
- Current write slice: `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=write` keeps legacy JSON as the user-facing read owner, but mirrors every workspace/layout JSON write into SQLite through the same idempotent import path. The mode is exposed as `storageV2Mode` on `/api/v2/runtime/health`.
- Current default-read slice: `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=default` routes workspace/layout/message-history reads through SQLite projection first, keeps rollback JSON mirrors, and falls back to JSON if SQLite projection fails. This slice is verified by `corepack pnpm smoke:runtime-v2:storage-default-read` on temp HOME/DB.
- Current workspace mutation owner slice: `storage.rename-workspace`, workspace group/order/collapse/delete/reorder commands를 Storage Worker typed IPC로 추가했다. `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=default`에서 `workspace-store`의 rename/group/order mutation은 JSON write path 대신 Supervisor/Storage Worker를 호출한다. Focused unit contract는 repository, worker service, supervisor, workspace-store에서 통과했다.
- Current layout mutation owner slice: `storage.split-pane`, `close-pane`, `patch-layout`, `patch-pane`, `reorder-tabs`, `move-tab`, `patch-tab` typed IPC를 추가했다. `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=default`에서 `layout-store`의 split/close/patch/reorder/move/tab patch는 JSON write path 대신 Supervisor/Storage Worker를 호출하고 기존 layout sync invalidation을 broadcast한다. Supervisor는 split 시 Terminal Worker session create와 Storage Worker tree mutation을 묶고, close 시 Storage Worker가 반환한 sessions를 Terminal Worker kill로 정리한다.
- Current status/timeline metadata slice: `storage.patch-tab-status-metadata`와 `storage.get-tab-status-metadata`가 `tab_status`와 `agent_sessions`를 갱신한다. `updateTabAgentSessionId`, `updateTabAgentJsonlPath`, `updateTabAgentSummary`, `updateTabLastUserMessage`, `updateTabCliStatus`, `readTabAgentJsonlPath`는 storage default에서 runtime storage contract를 사용한다. Status Worker는 주입된 metadata persistence adapter를 사용해 worker 내부 Supervisor 재귀를 피한다.
- Add migration tests with malformed layout, missing cwd, deleted workspace, stale session names, grouped workspaces, and split panes.

Exit gate:

- `corepack pnpm runtime-v2:storage-dry-run` returns `cutoverReady: true` on real `~/.codexmux` data or every blocker has an explicit migration path tested before default.
- Dry-run output includes only IDs/counts/relative backup entries and does not print cwd, workspace/tab names, session names, JSONL paths, prompts, assistant text, or terminal output.
- Shadow compare passes on real `~/.codexmux` data.
- Default mode can cold-start workspace/layout/sidebar/message-history state from SQLite in temp HOME/DB and has explicit JSON fallback evidence.
- Legacy JSON fallback can still render the previous layout after disabling storage v2.
- `write` and `default` mode smokes pass and disabling the mode leaves JSON reads/writes unchanged.
- Lifecycle Control panel shows storage `default`, terminal `new-tabs`, worker restart/timeout/failure 0, and the current 24h observation state before closing the default rollout gate.
- Browser/Electron/Android stale UI smoke must cover workspace rename/group/order, layout split/close/patch/reorder/move/tab patch, status/timeline metadata, direct v2 API mutation sync, and config/keybinding invalidation over the existing sync WebSocket before legacy JSON fallback removal. Windows-local browser evidence now covers workspace create/rename/group/order, layout tab create/patch/reorder/split/move/patch/close, direct runtime v2 API mutation sync without tmux, and config/keybinding invalidation. Android device evidence, live evidence, and status/timeline metadata stale UI evidence remain open.
- CLI/config/keybinding paths are classified separately from runtime storage ownership. Config/keybinding remain rollback-compatible JSON stores with `config` sync invalidation; CLI tab creation now routes plain terminal creation through runtime Supervisor in terminal v2 mode and no longer reintroduces JSON layout as the app-facing source of truth in storage default mode.

Rollback:

- Switch `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=off`.
- Legacy JSON remains source of truth until a later cleanup release.

## Phase 4: Timeline v2 WebSocket Cutover

Goal: move live timeline subscribe/append/resume into Timeline Worker.

Work:

- Move file watcher/session watcher state into Timeline Worker, not just read commands.
- Current read-only first slice: `corepack pnpm smoke:runtime-v2:timeline-shadow` compares legacy timeline read endpoints with runtime v2 timeline read endpoints for message counts and entries-before metadata without printing entry text.
- 2026-05-05 live shadow slice: `timeline.live-subscribe` returns the worker initial `timeline:init` payload, `timeline.live-append`/`timeline.live-error` events flow through Supervisor, and legacy `/api/timeline` records sanitized init/append parity counters while remaining client-facing.
- 2026-05-05 default-read slice: `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=default` keeps the existing `/api/timeline/*` HTTP URLs but routes `sessions`, `entries`, and `message-counts` through the Timeline Worker read commands.
- 2026-05-05 session watcher contract slice: Timeline Worker accepts `timeline.session-watch-subscribe`/`timeline.session-watch-unsubscribe`, emits subscriber-scoped `timeline.session-changed` events to Supervisor, and Supervisor fans out matching changes.
- 2026-05-05 WebSocket default ownership slice: the existing `/api/timeline` WebSocket URL stays stable, but default mode delegates init/append/error/session-changed delivery to Timeline Worker through `src/lib/runtime/timeline-ws.ts`. Legacy mode remains available with `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=off`.
- Keep stable id/dedupe/merge behavior unchanged.
- Add worker crash behavior: close timeline sockets with retryable reason and let client reconnect.

Exit gate:

- Implemented live shadow unit evidence: `tests/unit/lib/runtime/ipc.test.ts`, `timeline-worker-service.test.ts`, `timeline-live-shadow.test.ts`, `supervisor.test.ts`, and `corepack pnpm tsc --noEmit`.
- Long JSONL append smoke passes: `corepack pnpm smoke:runtime-v2:timeline-live-shadow` receives 24 append entries, has no duplicate assistant append ids, and records init/append match counters with mismatch/error counters 0.
- Default-read route unit evidence passes: `tests/unit/pages/timeline-sessions.test.ts`, `tests/unit/pages/timeline-read-default.test.ts`, and `tests/unit/lib/runtime/timeline-mode.test.ts`.
- Resume flow still blocks unsafe active processes: `corepack pnpm smoke:runtime-v2:timeline-resume-safety`.
- Session watcher ordering evidence passes: `corepack pnpm smoke:runtime-v2:timeline-session-changed` sees `timeline:session-changed` before the new JSONL `timeline:init`.
- Session watcher IPC contract evidence passes: `corepack pnpm test tests/unit/lib/runtime/ipc.test.ts tests/unit/lib/runtime/timeline-worker-service.test.ts tests/unit/lib/runtime/supervisor.test.ts`.
- Default-owned WebSocket evidence passes: `corepack pnpm test tests/unit/lib/runtime/timeline-ws.test.ts tests/unit/lib/runtime/timeline-worker-service.test.ts tests/unit/lib/runtime/supervisor.test.ts` and `corepack pnpm smoke:runtime-v2:timeline-websocket-default`.
- Android foreground reconnect evidence passes: `corepack pnpm smoke:android:timeline-foreground` opens `/api/timeline` from Android WebView page context, backgrounds the app while appending JSONL entries, and verifies foreground reconnect receives a fresh init without stale JSONL.

Rollback:

- Switch `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=off`; shadow subscriptions do not start and clients remain on legacy `/api/timeline`.

## Phase 5: Status v2 Cutover

Goal: move live status polling/broadcast side effects into Status Worker.

Work:

- Move process polling, JSONL watch, hook event application, dismiss/ack handling, Web Push/session history side effects behind Status Worker.
- Current policy-only first slice: `corepack pnpm smoke:runtime-v2:status-shadow` compares Status Worker IPC reducer/policy output with legacy pure helpers.
- 2026-05-05 side-effect shadow slice: `status.evaluate-side-effects` returns sanitized boolean intent for layout timestamp updates, session history write, Web Push send, and JSONL watcher start/stop. `StatusManager` remains production owner and records only `runtime_v2.status_shadow.side_effect.{match,mismatch,error}` counters in shadow mode.
- 2026-05-05 ack/dismiss shadow slice: `status.evaluate-client-event` returns sanitized acceptance and intent for `status:ack-notification` and `status:tab-dismissed`. Legacy `/api/status` remains production executor and records only `runtime_v2.status_shadow.client_event.{match,mismatch,error}` counters in shadow mode.
- 2026-05-05 session history worker slice: `status.add-session-history-entry` and `status.update-session-history-dismissed-at` can execute session history writes through Status Worker. `StatusManager` still builds entries and broadcasts updates; it calls the worker only in `CODEXWINMUX_RUNTIME_STATUS_V2_MODE=default` and falls back to legacy writes on worker failure.
- 2026-05-05 Web Push worker slice: `status.send-web-push` can send existing safe Web Push payloads through Status Worker. `StatusManager` still computes foreground visibility in the main process and calls the worker only in `CODEXWINMUX_RUNTIME_STATUS_V2_MODE=default`, with legacy send fallback on worker failure.
- 2026-05-05 live bridge/default slice: `status.live-start` runs the StatusManager state machine inside Status Worker, and `/api/status` maps worker `status.*` realtime events back to existing client message types. Hook/statusline events, ack/dismiss, request-sync, last-user-message notify, tab register/remove, device visibility, session history update, Web Push send, JSONL watcher, polling, and rate-limit update are worker-owned in `CODEXWINMUX_RUNTIME_STATUS_V2_MODE=default`.
- Keep pure reducer and notification policy output byte-for-byte compatible with current tests.
- Keep typed status events for sync/update/remove/hook/session-history/rate-limits.
- Preserve `globalThis` singleton compatibility until custom server and API routes no longer share status state directly.

Exit gate:

- `needs-input`, `ready-for-review`, dismiss, ack, and Web Push smoke pass.
- `corepack pnpm smoke:runtime-v2:status-default` passes in temp HOME/server and proves the existing permission prompt flow survives `CODEXWINMUX_RUNTIME_STATUS_V2_MODE=default`.
- Session history dedupe still uses `sessionId:turnId`.
- Legacy `/api/status` fallback can be re-enabled without losing current layout metadata.

Rollback:

- Switch `CODEXWINMUX_RUNTIME_STATUS_V2_MODE=off`; existing `StatusManager` resumes ownership.

## Phase 6: Default Runtime v2

Goal: make v2 the default for new installs and upgraded installs that pass migration gates.

Work:

- Run `corepack pnpm smoke:runtime-v2:phase6-default-gate` against the release candidate or live target before changing any code/env defaults.
- Treat Phase 6 first as an operations gate: runtime v2 must be enabled, terminal must be `new-tabs`, storage/timeline/status must be `default`, and every runtime worker failure/restart/timeout counter must be 0.
- Default all surface modes in code only after phases 2-5 have shipped independently and the Phase 6 gate passes on the intended target. Completed on 2026-05-05: unset per-surface mode env now resolves to terminal `new-tabs`, storage/timeline/status `default` while `CODEXWINMUX_RUNTIME_V2=1`.
- Keep a documented legacy fallback for at least one release.
- Add release note section for backup, rollback flags, and diagnostic commands.
- The gate script remains read-only and does not edit systemd drop-ins, restart services, mutate workspaces, or create tabs.

Exit gate:

- `corepack pnpm smoke:runtime-v2:phase6-default-gate` passes with `terminalV2Mode="new-tabs"`, `storageV2Mode="default"`, `timelineV2Mode="default"`, `statusV2Mode="default"`.
- `/api/debug/perf` exposes runtime worker diagnostics and storage/terminal/timeline/status `healthFailures`, `readyFailures`, `commandFailures`, `invalidReplies`, `timeouts`, `sendFailures`, `exits`, `errors`, and `restarts` are all 0.
- Release branch passes build, lint, typecheck, unit tests, runtime v2 smoke, Electron build, Android debug build, and systemd deploy smoke.
- Production canary shows no worker restart loop, no WebSocket error spike, and no status/timeline duplicate event spike.

Rollback:

- Run `corepack pnpm lifecycle:rollback-dry-run`, then `corepack pnpm lifecycle:rollback-apply`, or use Lifecycle Action `Apply Rollback Flags` with confirmation `rollback runtime v2`.
- The automation keeps `CODEXWINMUX_RUNTIME_V2=1`, sets storage to `write`, sets terminal/timeline/status to `off`, backs up the previous drop-in, reloads systemd, and restarts `codexmux.service`.
- If applying manually, set the narrow surface flag back first: status, then timeline, then storage, then terminal.
- If worker startup itself is unstable, set `CODEXWINMUX_RUNTIME_V2=0`.
- Do not delete `~/.codexmux/runtime-v2/state.db` during first rollback; keep it for recovery and diagnostics.

2026-05-07 Windows packaged closeout:

- Packaged `0.4.8` isolated target passed `corepack pnpm smoke:runtime-v2:phase6-default-gate`.
- Actual modes were terminal `new-tabs`, storage/timeline/status `default`.
- Worker diagnostics were present and clean: health failures, ready failures, command failures, invalid replies, timeouts, send failures, exits, errors, and restarts were all 0.
- `corepack pnpm lifecycle:rollback-dry-run` passed read-only and reported no active runtime drop-in in the Windows checkout environment.
- The perf closeout snapshot did not identify a measurement-backed code tuning target; see `docs/PERFORMANCE.md`.

## Required Test Commands

```bash
corepack pnpm test tests/unit/lib/runtime tests/unit/lib/status-state-machine.test.ts tests/unit/lib/status-notification-policy.test.ts tests/unit/pages/runtime-v2-api.test.ts tests/unit/scripts/runtime-v2-smoke-lib.test.ts
corepack pnpm test tests/unit/lib/runtime/terminal-mode.test.ts tests/unit/lib/runtime/storage-mode.test.ts tests/unit/lib/runtime/timeline-mode.test.ts tests/unit/lib/runtime/status-mode.test.ts tests/unit/pages/runtime-v2-api.test.ts
corepack pnpm test tests/unit/scripts/runtime-v2-phase6-gate-lib.test.ts
corepack pnpm tsc --noEmit
corepack pnpm lint
corepack pnpm build
corepack pnpm smoke:runtime-v2
corepack pnpm smoke:runtime-v2:phase2
corepack pnpm smoke:runtime-v2:storage-dry-run
corepack pnpm runtime-v2:storage-dry-run
corepack pnpm smoke:runtime-v2:storage-backup
corepack pnpm runtime-v2:storage-backup
corepack pnpm smoke:runtime-v2:storage-import
corepack pnpm runtime-v2:storage-import
corepack pnpm smoke:runtime-v2:storage-write
corepack pnpm smoke:runtime-v2:storage-default-read
corepack pnpm smoke:runtime-v2:timeline-websocket-default
corepack pnpm smoke:runtime-v2:timeline-live-shadow
corepack pnpm smoke:runtime-v2:timeline-resume-safety
corepack pnpm smoke:runtime-v2:timeline-session-changed
corepack pnpm smoke:runtime-v2:status-default
corepack pnpm smoke:runtime-v2:browser-sync
corepack pnpm smoke:runtime-v2:phase6-default-gate
corepack pnpm smoke:android:timeline-foreground
corepack pnpm build:electron
corepack pnpm android:build:debug
```

## Release Notes Checklist

- Exact flags enabled in this release.
- Data migration mode and backup location.
- Rollback commands.
- Known unsupported legacy/v2 mixed states.
- Smoke result summary with commit SHA and date.
