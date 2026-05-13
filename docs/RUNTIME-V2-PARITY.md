# Runtime v2 Parity Matrix

작성일: 2026-05-03

이 문서는 Supervisor + Worker runtime v2를 production 기본 경로로 전환하기 전에 확인해야 하는 surface별 parity checklist다. `CODEXWINMUX_RUNTIME_V2=1`은 worker와 v2 diagnostic/API를 켜지만, 아래 행이 통과하기 전까지 legacy route와 JSON store가 production source of truth다.

## 기준

| 필드 | 의미 |
| --- | --- |
| Owner | 현재 구현 또는 migration 책임 module |
| v1 behavior | production legacy 경로의 동작 |
| v2 behavior | 현재 runtime v2의 동작 |
| Gap | default 전환 전에 닫아야 할 차이 |
| Migration | v2로 넘기는 방식 |
| Test | 최소 검증 명령 또는 smoke |
| Rollback | v2 off/default 취소 시 기대 동작 |

## Workspace And Layout

| Surface | Owner | v1 behavior | v2 behavior | Gap | Migration | Test | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Workspace create/list/delete | `src/lib/workspace-store.ts`, `src/lib/runtime/storage/repository.ts`, `src/lib/runtime/storage-dry-run.ts`, `src/lib/runtime/storage-backup.ts`, `src/lib/runtime/storage-import.ts`, `src/lib/runtime/storage-mirror.ts`, `src/lib/runtime/storage-read-owner.ts` | `workspaces.json`과 workspace별 `layout.json`을 생성/조회/삭제한다. | SQLite workspace/pane/tab schema로 create/list/delete를 지원한다. Storage dry-run은 legacy JSON stores를 read-only로 검사하고 backup manifest/import readiness를 count-only로 출력한다. Storage backup은 legacy JSON stores와 `runtime-v2/state.db*`를 backup dir로 복사한다. Storage import는 JSON snapshot을 schema v3 SQLite로 idempotent import하며 active/sidebar state와 workspace directories를 포함한다. `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=write|default`에서는 legacy JSON write 직후 SQLite import mirror를 수행한다. `default` 모드에서는 workspace/layout read가 SQLite projection을 우선 사용하고 실패 시 JSON으로 fail closed한다. | group/order/layout mutation source of truth는 아직 v1 JSON write path다. production live flag는 `write`에 남아 있어 default read는 temp smoke evidence 단계다. | Shadow import 후 `write` mode에서 JSON write를 SQLite로 mirror한다. `default` mode는 SQLite cold-start read와 JSON write mirror 후 재조회까지 temp HOME/DB로 검증한다. | `corepack pnpm test tests/unit/lib/runtime`, `corepack pnpm smoke:runtime-v2:storage-dry-run`, `corepack pnpm runtime-v2:storage-dry-run`, `corepack pnpm smoke:runtime-v2:storage-backup`, `corepack pnpm runtime-v2:storage-backup`, `corepack pnpm smoke:runtime-v2:storage-import`, `corepack pnpm runtime-v2:storage-import`, `corepack pnpm smoke:runtime-v2:storage-write`, `corepack pnpm smoke:runtime-v2:storage-default-read` | `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=off`; JSON store 유지. |
| Workspace rename | `src/pages/api/workspace/[workspaceId].ts`, `src/lib/workspace-store.ts` | workspace name을 JSON에 갱신하고 sync broadcast한다. | v2 rename command/route 없음. | rename command, validation, sync invalidation 필요. | JSON-vs-SQLite shadow compare 후 dual-write 가능 여부 확인. | workspace rename API test + shadow compare. | v1 rename route 유지. |
| Workspace reorder/group/collapse | `src/lib/workspace-store.ts`, `src/lib/workspace-order.ts` | workspaces/groups order와 collapsed/groupId를 JSON에 저장한다. | v2 schema/command 없음. | group/order schema와 transaction semantics 필요. | v1 write 유지, v2 shadow projection 먼저 추가. | reorder/group API test + malformed group fixture. | JSON order가 source of truth. |
| Active workspace/sidebar state | `src/pages/api/workspace/active.ts`, `src/lib/workspace-store.ts`, `src/lib/runtime/storage/repository.ts`, `src/lib/runtime/storage-import.ts` | activeWorkspaceId, sidebarCollapsed, sidebarWidth를 JSON에 저장한다. | schema v3 `app_state`에 `workspace-ui` snapshot을 저장하고 `default` read에서 SQLite projection을 우선 hydrate한다. `updateActive()` JSON write는 mirror를 통해 SQLite state를 갱신한다. | browser/Electron/Android 실기기 sync parity evidence는 production default rollout 전에 더 필요하다. | legacy JSON write와 mirror를 유지하면서 `default` read만 SQLite로 전환한다. | `corepack pnpm smoke:runtime-v2:storage-default-read` + active workspace reload/mobile reconnect smoke. | legacy active state JSON 재사용. |
| cwd validation | `src/pages/api/workspace/index.ts`, `src/lib/workspace-store.ts` | directory를 resolve하고 default layout cwd로 저장한다. | v2 create-workspace는 defaultCwd를 저장하지만 full production validation surface는 v1과 분리되어 있다. | deleted cwd, permission denied, relative path normalization parity 필요. | v1 validation helper를 v2 API boundary에서 재사용. | create workspace invalid cwd tests. | v1 workspace create route 유지. |
| Layout split/move/order/delete | `src/lib/layout-store.ts`, `src/pages/api/layout/**` | pane split, pane delete, tab reorder/move/delete를 workspace layout JSON에 반영한다. | v2는 default layout read와 terminal tab create/delete cleanup만 지원한다. | pane tree mutation commands와 sync invalidation 없음. | mutation command를 SQLite transaction으로 추가하고 v1 projection과 shadow compare. | layout mutation unit tests + runtime v2 tab delete smoke. | legacy layout JSON과 `pt-` sessions 유지. |
| Layout rename/tab patch | `src/lib/layout-store.ts` | tab name, active pane, ratio, agentSessionId/status metadata를 JSON에 저장한다. | v2 tab rename/patch 없음. | status/timeline metadata ownership과 충돌 가능. | storage default 전 status/timeline ownership split 확정. | tab rename/status metadata tests. | legacy layout metadata 유지. |
| Message history | `src/lib/message-history-store.ts`, `src/lib/runtime/storage/repository.ts`, `src/lib/runtime/storage-import.ts`, `src/lib/runtime/storage-read-owner.ts` | workspace layout dir 아래 message history namespace를 JSON으로 저장한다. | schema v3 `message_history` table에 workspace별 input history를 저장한다. `runtime-v2:storage-import`와 `write` mirror는 legacy `message-history.json`을 SQLite로 복사하고, `default` mode는 SQLite read/write를 우선 사용하면서 rollback용 JSON 파일을 함께 갱신한다. | production live default rollout과 browser/Electron/Android sync evidence가 남아 있다. | legacy JSON snapshot import 후 `default` mode에서 SQLite를 read/write owner로 사용하고 JSON fallback mirror를 유지한다. | `tests/unit/lib/runtime/message-history-default-read.test.ts`, `corepack pnpm smoke:runtime-v2:storage-default-read`. | `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=off`에서 legacy `message-history.json` read/write로 복귀. |

## Terminal

| Surface | Owner | v1 behavior | v2 behavior | Gap | Migration | Test | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Attach/detach/stdout | `src/lib/terminal-server.ts`, `src/lib/runtime/terminal-ws.ts`, `src/lib/terminal-websocket-url.ts`, `src/lib/terminal-runtime-preflight.ts` | `/api/terminal` WebSocket이 `pt-` tmux session에 attach하고 stdout을 fanout한다. | `/api/v2/terminal` WebSocket이 `rtv2-` session에 attach하고 Terminal Worker stdout event를 fanout한다. Desktop/mobile terminal surface는 `runtimeVersion: 2` tab에서 `/api/v2/terminal`을 선택한다. Server smoke covers stdin, web stdin, heartbeat, resize, fresh reattach, fanout, backpressure close, tab restart, and cleanup rejection. Phase 2 gate smoke covers app layout new-tab routing, browser reload, server restart, and mode-off fallback. Electron page-context smoke covers existing-cookie `/api/v2/terminal` attach/output and 2회 page reload/reconnect. Android WebView smoke covers existing-cookie `/api/v2/terminal` attach/output and 2회 foreground reconnect. | packaged Electron OS-level foreground UX는 Mac 화면 세션에서 별도 확인한다. Android production legacy foreground reconnect와 runtime v2 foreground reconnect는 2026-05-03 smoke에서 통과했다. | `CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs`에서 plain terminal 신규 tab만 v2. | `corepack pnpm smoke:runtime-v2`, `corepack pnpm smoke:runtime-v2:phase2`, `corepack pnpm smoke:electron:runtime-v2`, `corepack pnpm smoke:android:runtime-v2`. | mode off blocks new v2 tab creation; existing v2 tabs remain visible and show `runtime-v2-disabled` before opening `/api/v2/terminal`. Existing legacy tabs remain on `/api/terminal`. |
| Runtime identity | `src/types/terminal.ts`, `src/lib/runtime/terminal-mode.ts`, `src/lib/runtime/storage/repository.ts`, `src/lib/layout-store.ts`, `src/lib/runtime/session-name.ts` | 기존 JSON tab은 `runtimeVersion`이 없고 legacy `pt-` session으로 해석된다. 신규 legacy terminal-backed tab은 `runtimeVersion: 1`을 저장한다. | runtime v2 Storage/Supervisor/API/layout projection은 `runtimeVersion: 2`를 반환한다. Phase 2 new-tabs slice는 v2 tab을 legacy JSON layout에도 저장한다. Legacy workspace/pane ids are normalized before becoming `rtv2-` tmux-safe session names. | SQLite workspace/layout default source 전환은 아직 아니다. | missing field는 runtime 1로 해석한다. Plain terminal v2 creation은 legacy workspace/pane id를 v2 storage에 mirror한 뒤 JSON layout에 append한다. | terminal mode/unit tests + runtime v2 API/layout API tests + Phase 2 gate smoke. | mode off keeps legacy route selection and existing JSON tabs valid. |
| stdin and web stdin | `src/lib/terminal-server.ts`, `src/lib/runtime/terminal/terminal-worker-service.ts` | terminal stdin과 Codex web input을 pty에 전달한다. | `terminal.write-stdin`과 `terminal.write-web-stdin` command가 있다. | `Ctrl+D` and mobile input parity 검증 필요. | tab runtimeVersion으로 write route 선택. | runtime v2 smoke web stdin step + terminal input/web input smoke including `Ctrl+D`. | v1 input route untouched. |
| Resize | `src/lib/terminal-server.ts`, `src/lib/runtime/terminal-ws.ts` | WebSocket resize message가 pty resize로 전달된다. | v2 terminal WebSocket resize message가 Supervisor를 거쳐 Worker로 전달된다. | desktop/mobile resize throttle parity 확인 필요. | runtimeVersion route switch. | runtime v2 smoke resize step + mobile foreground smoke. | legacy resize remains default. |
| Heartbeat/reconnect | `src/hooks/use-terminal.ts`, `src/lib/terminal-server.ts`, `src/hooks/use-terminal-websocket.ts`, `src/lib/terminal-recovery.ts` | existing terminal hook heartbeat/reconnect가 production path를 관리한다. | v2 diagnostic UI/websocket path uses the same hook policy and `/api/v2/terminal` URL selection. Terminal Worker exit closes subscribers with retryable `1001 Terminal worker exited`; missing sessions move to `session-not-found` recovery. Server smoke asserts heartbeat echo; Phase 2 gate smoke asserts browser reload and server restart reattach. Electron runtime v2 smoke proves page-context attach/output and 2회 reload reconnect with the same cookie-auth route. Android runtime v2 smoke proves WebView attach/output and 2회 foreground reconnect with the same cookie-auth route. Blocking recovery overlays hide the floating reconnect badge so the UI does not expose an unclickable control. | packaged Electron OS-level foreground UX는 별도 확인한다. Android live legacy reconnect는 `corepack pnpm smoke:android:foreground`에서 blocking console/logcat 0으로 통과했다. | 기존 app surface와 동일한 hook 구성으로 v2 URL만 선택. | runtime v2 smoke heartbeat step + `corepack pnpm smoke:runtime-v2:phase2` + `corepack pnpm smoke:electron:runtime-v2` + `corepack pnpm smoke:android:runtime-v2` + `tests/unit/lib/terminal-recovery.test.ts`. | legacy hook URL selection; v2-disabled preflight reports rollback state. |
| Kill/restart/close cleanup | `src/lib/layout-store.ts`, `src/lib/tab-session-cleanup.ts`, `src/lib/tmux.ts`, `src/lib/runtime/supervisor.ts` | close tab/workspace가 layout JSON 삭제와 `pt-` tmux kill을 수행한다. Legacy restart recreates the `pt-` tmux session. | `runtimeVersion: 2` tab cleanup calls runtime Supervisor delete, which removes SQLite state and kills `rtv2-` tmux session. Runtime v2 restart deletes/recreates the Storage row, creates the same `rtv2-` tmux session through Terminal Worker, and finalizes the same tab id back to `ready`. | pane/workspace mixed cleanup smoke는 더 필요하다. | tab runtimeVersion으로 cleanup/restart route 선택. | tab cleanup helper tests + layout-store restart tests + tab delete/workspace delete/runtime v2 smoke. | legacy cleanup still owns `pt-`; v2 cleanup/restart can be invoked for explicit recovery. |
| Backpressure | `src/lib/terminal-server.ts`, `src/lib/runtime/terminal/terminal-worker-service.ts`, `src/lib/runtime/terminal-ws.ts` | stdout coalescing/backpressure counters가 legacy server에 있다. | Terminal Worker emits `terminal.backpressure` and Supervisor closes subscribers. Runtime v2 WebSocket closes oversized queued input with `1011 Terminal input backpressure`. | production-level burst stdout smoke and counter comparison 필요. | v2 new-tabs phase에서 diagnostic counters compare. | runtime v2 smoke backpressure close + burst output smoke + `/api/debug/perf` check. | mode off returns to legacy backpressure. |
| Electron/Android cookie auth | `src/lib/runtime/api-auth.ts`, `src/lib/runtime/server-ws-upgrade.ts` | shell WebViews use existing cookie/token auth for legacy routes. | v2 HTTP/WS auth accepts existing session cookie and `x-cmux-token`. The Phase 2 gate smoke uses the normal app login cookie for HTTP and WebSocket attach. Electron runtime v2 smoke uses Electron page context plus injected session cookie to attach to `/api/v2/terminal`, read marker output, and reattach after page reload. Android runtime v2 smoke uses Android WebView page context plus injected session cookie to attach to `/api/v2/terminal`, read marker output, and reattach after foreground. | no shell-specific auth gap for terminal v2 new-tabs slice. | no native bridge change unless auth smoke fails. | `corepack pnpm smoke:runtime-v2:phase2` + `corepack pnpm smoke:electron:runtime-v2` + `corepack pnpm smoke:android:runtime-v2`. | legacy cookie-auth WebSocket path remains. |

## Timeline

| Surface | Owner | v1 behavior | v2 behavior | Gap | Migration | Test | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Session list | `src/lib/timeline-server.ts`, `src/lib/session-index.ts`, `src/lib/runtime/timeline/worker-service.ts` | `/api/timeline/sessions` uses the local Codex session index and paging. | `/api/v2/timeline/sessions` uses the same local-only list command. `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=default` routes the legacy HTTP URL through Supervisor/Timeline Worker after preserving the non-agent tmux existence check. | large-list evidence remains. | keep legacy URL stable; switch read owner by env mode. | runtime v2 API tests + default-read route unit tests + large session list smoke. | `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=off` returns `/api/timeline/sessions` to legacy `listSessionPage`. |
| Load older entries | `src/lib/timeline-server.ts`, `src/lib/session-parser.ts`, `src/lib/runtime/timeline/worker-service.ts` | timeline WebSocket/API reads JSONL entries with stable id/dedupe/merge. | v2 read-only older-entry command exists and `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=default` routes legacy `/api/timeline/entries` through Supervisor/Timeline Worker. Client-facing WebSocket keeps the same URL and uses Timeline Worker live init/append in default mode. | large JSONL/live data timing evidence remains for perf tuning, not ownership parity. | keep client URL stable while read/live owner moves by env mode. | fixture tests for paired assistant dedupe, load-more, default-read route unit tests, and `corepack pnpm smoke:runtime-v2:timeline-websocket-default`. | `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=off` returns older-entry reads and WebSocket delivery to legacy timeline server code. |
| Init/append subscribe/unsubscribe | `src/lib/timeline-server.ts`, `src/lib/runtime/timeline-ws.ts`, `src/lib/runtime/timeline/worker-service.ts`, `src/lib/runtime/supervisor.ts` | WebSocket sends init, append, error and manages watchers/subscribers. | `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=shadow` still records legacy-vs-worker parity counters. In `default`, `/api/timeline` delegates init/append/error delivery to `handleRuntimeTimelineConnection()`, which subscribes through Supervisor/Timeline Worker and records `runtime_v2.timeline_ws.default.*` counters. Android WebView page-context smoke proves foreground reconnect gets fresh timeline init after background JSONL append. | no default ownership gap for init/append. Perf tuning and release artifact retention remain. | keep `/api/timeline` URL stable; switch implementation by env mode. | runtime IPC/supervisor/worker live unit tests + `corepack pnpm smoke:runtime-v2:timeline-live-shadow` + `corepack pnpm smoke:runtime-v2:timeline-websocket-default` + `corepack pnpm smoke:android:timeline-foreground`. | `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=off` disables worker live/default ownership; clients stay on the same URL with legacy implementation. |
| Resume/session-changed | `src/lib/timeline-server.ts`, `src/lib/runtime/timeline-ws.ts`, `src/lib/runtime/timeline/worker-service.ts`, `src/lib/runtime/supervisor.ts` | resume flow blocks unsafe active processes and broadcasts session-changed. | default WebSocket mode uses Timeline Worker session watch subscribe/unsubscribe and subscriber-scoped `timeline.session-changed` fan-out. Resume messages go through the runtime WebSocket bridge; unsafe active process blocking and `sendKeys` execution remain in the existing server helper so legacy file watchers are not attached in v2 mode. | full Status/session-history ownership is separate Phase 5 work. | keep resume command semantics stable while moving WebSocket delivery to the runtime bridge. | `corepack pnpm smoke:runtime-v2:timeline-resume-safety` proves unsafe active process blocking. `corepack pnpm smoke:runtime-v2:timeline-session-changed` proves `session-changed` before new JSONL init. `corepack pnpm test tests/unit/lib/runtime/timeline-ws.test.ts tests/unit/lib/runtime/timeline-worker-service.test.ts tests/unit/lib/runtime/supervisor.test.ts` proves bridge/session watcher cleanup. | `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=off` restores legacy resume/session watcher flow. |
| Message counts | `src/pages/api/timeline/message-counts.ts`, `src/lib/runtime/timeline/worker-service.ts` | streaming helper counts user/assistant/tool without full timeline construction. | v2 message-counts command and API exist; `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=default` routes legacy `/api/timeline/message-counts` through Supervisor/Timeline Worker. | cache/timing parity on live data remains. | shadow compare counts on long JSONL, then default-read route switch by env mode. | message-counts tests + default-read route unit tests + `/api/debug/perf` timing check. | `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=off` returns message counts to the legacy route cache. |

## Status And Notifications

| Surface | Owner | v1 behavior | v2 behavior | Gap | Migration | Test | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Initial sync/update/remove | `src/lib/status-manager.ts`, `src/lib/status-server.ts`, `src/lib/runtime/status/worker-service.ts` | Main StatusManager polls process/JSONL state and broadcasts sync/update/remove. | In status default mode, Status Worker runs the StatusManager state machine and `/api/status` bridges worker `status.sync`/`status.update` events to existing clients. | SQLite `tab_status` write-through remains follow-up. | `CODEXWINMUX_RUNTIME_STATUS_V2_MODE=default` switches live ownership; `off`/`shadow` keep legacy main owner. | Status Worker/Supervisor IPC tests + `corepack pnpm smoke:runtime-v2:status-default`. | set status mode `off`. |
| Hook/statusline events | `src/pages/api/status/hook.ts`, `src/lib/status-manager.ts`, `src/lib/runtime/status/worker-service.ts` | hook/statusline events update tab state and metadata in main process. | Default mode forwards hook/poll commands to Status Worker live manager. | durable event persistence remains follow-up. | worker applies hook state and emits existing client message shape through bridge. | hook event fixture tests, side-effect intent tests, status default smoke. | legacy hook route/state write. |
| Needs-input ack/dismiss | `src/lib/status-server.ts`, `src/lib/status-client-event-policy.ts`, `src/lib/runtime/status/worker-service.ts` | ack/dismiss state suppresses repeated prompts and updates clients. | Default mode sends `status.live-client-event` to worker; shadow mode still compares pure client-event decisions. | durable ack storage remains follow-up. | status WebSocket preserves existing client protocol while worker mutates live state. | `corepack pnpm smoke:runtime-v2:status-default`, `corepack pnpm smoke:permission`, client event policy tests. | legacy ack/dismiss state. |
| Ready-for-review notification | `src/lib/status-notification-policy.ts`, `src/lib/status-side-effect-policy.ts`, `src/lib/runtime/status/worker-service.ts` | notification policy gates toast/system/Web Push/session history. | Default mode applies policy and side effects inside worker-owned StatusManager. | push deep link copy remains approval-queue follow-up. | shadow policy/intent compare remains available before/after default testing. | notification policy tests + side-effect tests + status default smoke. | legacy notification policy application. |
| Session history write | `src/lib/session-history.ts`, `src/lib/status-manager.ts`, `src/lib/runtime/status/session-history-actions.ts`, `src/lib/runtime/status/worker-service.ts` | completion history dedupes by `sessionId:turnId`. | Default mode writes and emits `session-history:update` from worker-owned StatusManager. | SQLite status/event persistence remains follow-up. | worker owns live add/update-dismissed path; `off`/`shadow` use legacy JSON path. | session history tests + Status Worker command tests. | legacy history JSON and fallback write path. |
| Web Push | `src/lib/push-subscriptions.ts`, `src/lib/status-manager.ts`, `src/lib/runtime/status/web-push-actions.ts`, `src/lib/runtime/status/worker-service.ts` | push subscriptions and sends are managed by legacy status path. | Default mode sends Web Push from worker-owned StatusManager; foreground visibility updates are mirrored with `status.live-device-visibility`. | push click deep link remains approval-queue follow-up. | `/api/push/visibility` updates both main and worker visibility state. | Status Worker command tests + status default smoke. | legacy push path. |

## Sync And Configuration

| Surface | Owner | v1 behavior | v2 behavior | Gap | Migration | Test | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Browser sync invalidation | `src/lib/sync-server.ts`, `src/lib/layout-store.ts`, `src/lib/workspace-store.ts` | layout/workspace/config changes broadcast over sync WebSocket. | v2 storage commands do not emit production sync invalidation. | browser reload and stale UI parity required. | v2 write mode emits the same sync message types. | browser reload/sync smoke. | legacy sync server remains owner. |
| Electron sync | `electron/`, `src/lib/sync-server.ts` | Electron shell connects to the same server routes. | v2 has no shell-specific sync change. | `smoke:electron:attach` covers live server attach, preload bridge, reload, and blocking console checks. `smoke:electron:runtime-v2` covers Electron page-context `/api/v2/terminal` attach/output and page reload/reconnect. packaged OS-level foreground UX remains Mac 화면 세션 smoke. | share browser sync path. | `corepack pnpm smoke:electron:attach`, `corepack pnpm smoke:electron:runtime-v2`, plus packaged Electron foreground UX before release. | legacy sync. |
| Android foreground sync | `android/`, `android-web/`, `src/hooks/use-mobile-foreground-reconnect.ts`, `src/lib/foreground-reconnect.ts` | foreground reconnect refreshes terminal/status/timeline/sync and suppresses expected forced-reconnect WebSocket console noise during the foreground grace window. | Android runtime v2 smoke covers terminal `/api/v2/terminal` foreground reconnect for the new-tabs slice. Android timeline foreground smoke covers default-owned `/api/timeline` WebSocket reconnect with increasing timeline init counts after background JSONL appends. | status v2 foreground reconnect smoke remains before Status Worker owns polling/Web Push/session history. | surface-specific mode gates. | `corepack pnpm smoke:android:foreground`, `corepack pnpm smoke:android:runtime-v2`, `corepack pnpm smoke:android:timeline-foreground`, plus status v2 smoke before status default. | legacy reconnect paths by surface mode rollback. |
| CLI clients and config | `src/pages/api/cli/**`, `src/lib/config-store.ts` | CLI uses token auth, layout/workspace JSON, and config JSON. | runtime v2 does not own CLI config or CLI tab creation. | CLI route compatibility and config invalidation required. | keep CLI legacy until storage default is stable. | CLI API smoke. | legacy CLI/config JSON. |

## Phase Gate

Runtime v2 can only become default for a surface when every row in that surface has:

- passing parity test or smoke evidence
- rollback behavior verified with `CODEXWINMUX_RUNTIME_*_V2_MODE=off`
- no sensitive content in `/api/debug/perf`
- no worker restart loop and no startup health failure spike in `services.runtimeWorkers`

Full-runtime defaulting must additionally pass `corepack pnpm smoke:runtime-v2:phase6-default-gate`.
That gate is read-only and checks the target server reports terminal `new-tabs`,
storage/timeline/status `default`, healthy runtime workers, and zero worker failure/restart/timeout
counters. After the 2026-05-05 code fallback approval, unset per-surface mode env resolves to the
same values when `CODEXWINMUX_RUNTIME_V2=1`; explicit `off` remains the rollback and invalid explicit
values fail closed to `off`.

## 2026-05-05 Phase 6 Default Gate Evidence

- `scripts/runtime-v2-phase6-gate-lib.mjs` validates `/api/v2/runtime/health` and `/api/debug/perf`
  snapshots without copying raw worker diagnostic payloads into failures.
- `corepack pnpm smoke:runtime-v2:phase6-default-gate` authenticates with the existing CLI token,
  checks the live or configured target, and prints only expected/actual mode names, check names,
  and sanitized failure codes.
- The gate requires `terminalV2Mode="new-tabs"`, `storageV2Mode="default"`,
  `timelineV2Mode="default"`, `statusV2Mode="default"`, all worker health sections `ok`, and
  storage/terminal/timeline/status failure counters at 0.
- `src/lib/runtime/*-mode.ts` now separates raw parsing from resolved code fallback. Raw parsers
  still return `off` for unset or invalid values; `getRuntime*V2Mode()` and ownership predicates
  apply Phase 6 defaults only when `CODEXWINMUX_RUNTIME_V2=1` and the surface mode env is unset.

## 2026-05-04 Storage Shadow Evidence

- `corepack pnpm smoke:runtime-v2:storage-shadow`를 추가했다.
- 범위는 Phase 2 `new-tabs` flow가 legacy JSON layout에 mirror한 `runtimeVersion: 2` tab과 SQLite runtime layout projection의 read-only compare다.
- 이 first slice는 full JSON-to-SQLite migration, workspace group/order/sidebar migration, split pane ownership, legacy `runtimeVersion: 1` tab import를 완료한 것이 아니다.
- mismatch output은 tab id, field, boolean/order 등만 포함하고 cwd 값은 직접 출력하지 않는다.

## 2026-05-04 Storage Dry-run Evidence

- `corepack pnpm smoke:runtime-v2:storage-dry-run`를 추가했다.
- `corepack pnpm runtime-v2:storage-dry-run`는 실제 `~/.codexmux`의 `workspaces.json`과 workspace별 `layout.json`을 쓰기 없이 읽고, `runtime-v2/state.db` 전환 전 backup manifest와 import readiness를 출력한다.
- live dry-run snapshot은 `workspaceCount=5`, `groupCount=1`, `paneCount=5`, `tabCount=5`, `runtimeV1TabCount=2`, `nonTerminalTabCount=3`, `statusMetadataTabCount=5`, `cutoverReady=true`, blocker 0이다.
- schema v3 이후 sidebar/active workspace state, workspace directories, message history는 SQLite import/default read 지원 범위다. workspace group, legacy terminal tab, non-terminal tab, tab status metadata도 storage import 지원 범위다.
- report는 workspace id, pane id, tab id, relative backup path, count만 포함한다. cwd, workspace/tab name, session name, JSONL path, prompt, assistant text, terminal output은 출력하지 않는다.

## 2026-05-04 Storage Backup Evidence

- `corepack pnpm smoke:runtime-v2:storage-backup`와 `corepack pnpm runtime-v2:storage-backup`를 추가했다.
- backup command는 `workspaces.json`, `workspaces/**.json`, `runtime-v2/state.db`, `runtime-v2/state.db-wal`, `runtime-v2/state.db-shm`를 `~/.codexmux/backups/runtime-v2-storage-{timestamp}/`로 복사한다.
- live backup snapshot은 `runtime-v2-storage-20260504T052000Z`에 29개 파일을 복사했다.
- command result는 destination path, relative path, byte count만 출력하고 file content, cwd, workspace/tab name, session name, prompt text는 출력하지 않는다.
- 이 backup은 rollback material을 보존하는 단계이며 JSON-to-SQLite import나 source-of-truth switch를 수행하지 않는다.

## 2026-05-04 Storage Import Evidence

- `corepack pnpm smoke:runtime-v2:storage-import`와 `corepack pnpm runtime-v2:storage-import`를 추가했다.
- schema v2는 `tabs.runtime_version`과 `workspaces.active_pane_id`를 추가했고, schema v3는 `workspace_directories`, `app_state`, `message_history`를 추가한다.
- import는 grouped workspace, split pane tree, active pane, active/sidebar state, workspace directory list, message history, legacy `runtimeVersion: 1` terminal tab, runtime v2 `runtimeVersion: 2` terminal tab, non-terminal tab, tab status metadata를 SQLite로 복사한다.
- live import snapshot은 group 1개, workspace 5개, pane 5개, tab 5개, legacy terminal tab 2개, non-terminal tab 3개, status metadata 5개를 import했다.
- runtime v2 terminal attach authorization과 cleanup session list는 `runtime_version=2` terminal tab만 대상으로 하므로 imported legacy `pt-` session은 v2 worker cleanup 대상으로 노출되지 않는다.
- 이 import는 production source-of-truth switch가 아니다. `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=off`에서는 legacy JSON이 계속 owner다.

## 2026-05-04 Storage Write Evidence

- `src/lib/runtime/storage-mode.ts`는 `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=off|shadow|write|default`를 지원하고 잘못된 명시 값을 fail-closed로 해석한다. Phase 6 이후 unset mode는 `CODEXWINMUX_RUNTIME_V2=1`에서 `default`로 resolve된다.
- `src/lib/runtime/storage-mirror.ts`는 `write|default` 모드에서 legacy JSON workspace/layout/message-history write 직후 `importLegacyStorageSnapshot`을 실행해 SQLite projection을 갱신하고, JSON snapshot에서 사라진 workspace/tab/pane/group row를 prune한다.
- `corepack pnpm smoke:runtime-v2:storage-write`는 temp HOME/DB에서 legacy `layout.json` write, SQLite layout projection, status metadata 보존을 확인한다.
- `/api/v2/runtime/health`는 `storageV2Mode`, `timelineV2Mode`, `statusV2Mode`를 노출해 운영 중 rollback 상태를 확인할 수 있다.
- 이 단계는 dual-write mirror이며 production read default ownership은 아니다. `off`로 되돌리면 기존 JSON read/write path가 그대로 남는다.

## 2026-05-04 Storage Default Read Evidence

- schema v3는 `workspace_directories`, `app_state`, `message_history`를 추가해 active workspace, sidebar collapsed/width, workspace directory list, message history를 SQLite projection에 포함한다.
- `src/lib/runtime/storage-read-owner.ts`는 `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=default`에서 workspace/layout/message-history read를 SQLite 우선으로 처리하고, DB open/projection 실패 시 JSON read로 fail closed한다.
- `corepack pnpm smoke:runtime-v2:storage-default-read`는 temp HOME/DB에서 SQLite workspace/layout/message-history cold read, workspace directory/sidebar/status metadata hydration, legacy `layout.json` write mirror 후 default read, `updateActive()` mirror 후 default read, message-history JSON fallback mirror를 검증한다.
- live service는 아직 `storageV2Mode=write`로 운영하며 production default rollout은 별도 gate로 남긴다.

## 2026-05-04 Timeline Shadow Evidence

- `corepack pnpm smoke:runtime-v2:timeline-shadow`를 추가했다.
- 범위는 allowed Codex JSONL fixture에 대한 legacy `/api/timeline/message-counts`, `/api/timeline/entries`와 runtime v2 `/api/v2/timeline/message-counts`, `/api/v2/timeline/entries`의 read-only compare다.
- 이 first slice는 Timeline Worker live watcher/subscriber/session-changed/resume ownership을 완료한 것이 아니었고, 이후 2026-05-05 WebSocket default ownership slice에서 `/api/timeline` client delivery가 runtime bridge로 전환됐다.
- mismatch output은 count, byte offset, entry type sequence만 포함하고 prompt/assistant/tool argument 본문은 출력하지 않는다.

## 2026-05-04 Status Shadow Evidence

- `corepack pnpm smoke:runtime-v2:status-shadow`를 추가했다.
- 범위는 Status Worker IPC의 hook reducer, Codex state reducer, notification policy output, side-effect intent, ack/dismiss client-event intent와 legacy pure helper output 비교다.
- 2026-05-05 side-effect shadow는 `status.evaluate-side-effects`로 session history/Web Push/JSONL watcher intent boolean만 비교하고 payload 본문을 기록하지 않는다.
- 2026-05-05 ack/dismiss shadow는 `status.evaluate-client-event`로 ready-for-review dismiss와 needs-input ack acceptance만 비교하고 tab id나 prompt 본문을 기록하지 않는다.
- 이 first slice는 process polling, JSONL watch, hook event side-effect application, dismiss/ack, Web Push, session history write ownership을 완료한 것이 아니다.
