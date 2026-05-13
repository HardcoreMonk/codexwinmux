# 아키텍처와 서비스 로직

이 문서는 codexmux의 아키텍처 흐름과 서비스 로직을 구현 기준으로 정리한다. 장기 설계 결정은 `ADR.md`, tmux와 WebSocket 세부는 `TMUX.md`, 상태 전이는 `STATUS.md`, 운영 서비스는 `SYSTEMD.md`를 기준 문서로 둔다.

## 핵심 구조

codexmux는 Next.js Pages Router UI, custom Node server, tmux session, Codex CLI JSONL을 하나의 운영 흐름으로 묶는다.

```text
Browser / Electron / Android WebView
  ├─ HTTP pages + API        -> Next.js Pages Router
  ├─ /api/terminal WebSocket -> terminal-server -> node-pty -> tmux -L codexmux
  ├─ /api/timeline WebSocket -> timeline-server -> Codex JSONL tail
  ├─ /api/status WebSocket   -> status-server -> StatusManager
  └─ /api/sync WebSocket     -> sync-server -> workspace/layout/config broadcast

Runtime state
  ├─ ~/.codexmux/            -> codexmux-owned app state
  ├─ tmux -L codexmux        -> live shell/Codex processes
  └─ ~/.codex/sessions/      -> Codex-owned JSONL, read-only
```

## Experimental Runtime v2

`CODEXWINMUX_RUNTIME_V2=1`이면 현재 runtime 옆에 실험용 Supervisor + Worker runtime이
함께 시작된다. Supervisor는 public routing과 worker lifecycle을 소유하고, Storage
Worker는 `~/.codexmux/runtime-v2/state.db` SQLite app state를 소유한다. Terminal
Worker는 별도 `codexmux-runtime-v2` tmux socket의 `rtv2-` session lifecycle과
`/api/v2/terminal` attach/stdin/stdout/resize 경로를 소유한다.
Timeline Worker는 Codex JSONL session list, older entry read, message count 같은
읽기 전용 timeline command를 typed IPC 뒤에 둔다. 아직 production `/api/timeline`
WebSocket의 file watch/live append/resume 경로를 대체하지 않는다.
`CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=default`에서는 기존 `/api/timeline/sessions`,
`/api/timeline/entries`, `/api/timeline/message-counts` HTTP route가 URL을 유지한 채
Supervisor의 Timeline Worker read command로 처리된다.
Status Worker는 상태 전이와 notification gating 같은 순수 정책 평가 command를 typed
IPC 뒤에 둔다. `CODEXWINMUX_RUNTIME_STATUS_V2_MODE=default`에서는 Status Worker가
별도 process 안에서 `StatusManager` live state machine을 실행하고 기존 `/api/status`
WebSocket은 worker realtime event를 client message로 bridge한다. `off`/`shadow`에서는
기존 main-process `StatusManager`가 production owner다.
runtime v2의 workspace delete와 terminal tab delete는 Storage Worker SQLite
transaction이 cleanup 대상 session을 반환하고, Supervisor가 subscriber close와
Terminal Worker `kill-session` cleanup을 수행한다.
runtime v2 terminal tab restart는 legacy layout에 남은 같은 tab id/session name을
Supervisor가 Storage Worker에 다시 `pending_terminal`로 등록하고 Terminal Worker가 같은
`rtv2-` tmux session을 재생성한 뒤 `ready`로 finalize한다. Terminal Worker가 crash 또는
service restart 중 종료되면 Supervisor는 붙어 있던 terminal WebSocket을 retryable `1001
Terminal worker exited`로 닫아 client가 `/api/v2/terminal`을 새로 열게 한다. 실제 session이
없으면 reconnect는 `session-not-found` 복구 overlay로 넘어간다.

이 runtime은 구현 첫 단계의 process-level smoke와 platform smoke를 통과하기 전까지
기본 production terminal/timeline/status 경로를 대체하지 않는다.

## 모듈 경계

| 영역 | 주요 파일 | 책임 |
| --- | --- | --- |
| Server entry | `server.ts` | process lifecycle, Next.js, WebSocket upgrade, auth gate, startup/shutdown |
| Terminal | `src/lib/terminal-server.ts`, `src/lib/tmux.ts` | tmux attach, stdin/stdout/resize, terminal session lifecycle |
| Timeline | `src/lib/timeline-server.ts`, `src/lib/timeline-server-state.ts`, `src/lib/timeline-file-watcher-service.ts`, `src/lib/timeline-subscription-service.ts`, `src/lib/timeline-resume-service.ts` | Codex JSONL subscribe, file watch, resume, timeline init/append |
| Session Index | `src/lib/session-index.ts`, `src/lib/session-list.ts`, `src/pages/api/timeline/sessions.ts`, `src/lib/runtime/timeline/worker-service.ts` | 로컬 Codex session 목록 인덱스, session list snapshot, runtime v2 default read projection |
| Status | `src/lib/status-manager.ts`, `src/lib/status-server.ts`, `src/lib/status-session-history-adapter.ts`, `src/lib/status-web-push-adapter.ts` | tab status polling, hook event merge, notification/history side effect dispatch |
| Workspace | `src/lib/workspace-store.ts`, `src/lib/layout-store.ts`, `src/lib/runtime/storage-read-owner.ts` | workspace list, layout tree, pane/tab mutation, persisted metadata, runtime v2 default read projection |
| Provider | `src/lib/providers/*`, `src/lib/codex-session-detection.ts` | Codex command/session/jsonl adapter |
| Sync | `src/lib/sync-server.ts` | workspace/layout/config change broadcast |
| Config/Auth | `src/lib/config-store.ts`, `src/lib/auth*.ts` | config persistence, password/session token, onboarding |
| Perf | `src/lib/perf-metrics.ts`, `src/pages/api/debug/perf.ts` | runtime snapshot, duration/counter aggregation |
| Platform shell | `electron/`, `android/`, `android-web/` | client shell and server URL/connectivity UX |

## Server 시작 로직

`server.ts`의 `start()`가 프로세스 전체 lifecycle을 소유한다.

1. `PORT`와 app directory를 결정한다.
2. `~/.codexmux/cmux.lock`을 획득해 단일 인스턴스를 보장한다.
3. `config.json`과 shell `PATH`를 초기화한다.
4. auth credential을 로드하고 `AUTH_PASSWORD`, `NEXTAUTH_SECRET` 환경값을 채운다.
5. tmux session을 scan하고 `src/config/tmux.conf`를 적용한다.
6. workspace store와 layout을 초기화한다.
7. 저장된 Codex session이 있으면 startup resume을 시도한다.
8. `StatusManager` polling과 상태 복구를 시작한다.
9. `SessionIndexService`가 persisted index를 로드하고 백그라운드 refresh를 시작한다.
10. network access 설정으로 bind host와 request allowlist를 결정한다.
11. development이면 Next.js dev server를 직접 붙이고, production이면 standalone Next.js server를 내부 port에 띄운 뒤 외부 server가 proxy한다.
12. WebSocket upgrade route를 연결한다.
13. hook/statusline bridge, CLI token, upload/stats cleanup을 정리한다.

## HTTP와 WebSocket 라우팅

HTTP 요청은 Next.js Pages Router가 처리한다. custom server는 access filter를 먼저 적용하고, production에서는 내부 standalone server로 proxy한다.

WebSocket은 path별 전용 server로 분기한다.

| Path | Auth | Handler | 역할 |
| --- | --- | --- | --- |
| `/api/install` | 없음 | `handleInstallConnection` | onboarding/preflight 설치 흐름 |
| `/api/terminal` | session cookie | `handleConnection` | terminal byte stream |
| `/api/timeline` | session cookie | `handleTimelineConnection` | Codex timeline stream |
| `/api/status` | session cookie | `handleStatusConnection` | tab status broadcast |
| `/api/sync` | session cookie | `handleSyncConnection` | workspace/layout/config invalidation |

인증은 HTTP page/API는 Next.js middleware와 API helper가 맡고, WebSocket upgrade는 custom server가 `session-token` cookie를 검증한다. `/api/install`은 초기 설정 전에도 연결되어야 하므로 예외다.

`/api/debug/perf`는 HTTP debug endpoint지만 middleware 예외가 아니다. session cookie 또는 `x-cmux-token` CLI token 인증을 통과한 요청에만 process memory, event loop, WebSocket count, watcher count, poll duration 같은 숫자 지표를 반환한다.

`CODEXMUX_BRIDGE_TRACE_URL`이 설정된 서버에서는 status update broadcast 뒤
`bridge-trace-forwarder`가 같은 update를 codex-ai-bridge의 loopback external trace
ingress로 best-effort POST한다. 이 경로는 Discord 직접 전송이 아니라 bridge-owned
trace 정책 적용을 위한 로컬 event feed이며, payload는 workspace directory와 status
summary로 제한한다.

## 상태 저장 로직

codexmux가 쓰는 영속 상태는 `~/.codexmux/` 아래에 둔다.

| 데이터 | Source of truth | 변경 방송 |
| --- | --- | --- |
| config/auth/theme/network | `config.json` | sync/config |
| workspace 목록과 그룹 | `workspaces.json` | sync/workspace |
| pane/tab layout | `workspaces/{wsId}/layout.json` | sync/layout |
| message history | `workspaces/{wsId}/message-history.json`; runtime storage default mode에서는 `runtime-v2/state.db` | 없음 또는 API 응답 |
| keybindings/sidebar/quick prompts | 각 JSON 파일 | 필요 시 sync/config 또는 client refresh |
| status/session history/stats | `session-history.json`, `stats/` | status/timeline |
| session list index | `session-index.json` | timeline/session-list |
| live terminal process | tmux | terminal/status/timeline |
| Codex transcript | `~/.codex/sessions/**/*.jsonl` | timeline/status |

`CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=default`에서는 workspace/layout/message-history read가
`~/.codexmux/runtime-v2/state.db`의 SQLite projection을 우선 사용한다. 기존 JSON write
path와 sync broadcast는 유지하며, write 직후 runtime v2 import mirror가 SQLite projection을
갱신한다. Message history는 default mode에서 SQLite read/write를 우선 사용하고 rollback용
JSON 파일을 함께 갱신한다. SQLite read가 실패하거나 projection이 비어 있으면 legacy JSON
read로 fail closed한다. Config, keybindings, sidebar items는 아직 기존 JSON store가 owner다.

custom server와 Next.js API route는 같은 Node process 안에서도 module graph가 분리될 수 있다. 공유 singleton은 `globalThis`에 저장하고 재초기화를 guard한다.

## Workspace 서비스 로직

Workspace는 사용자가 보는 작업 단위이며 layout과 tmux session 이름의 상위 key다.

1. workspace 생성 시 기본 directory를 검증한다.
2. `ws-{id}`를 발급하고 `workspaces.json`에 저장한다.
3. `workspaces/{wsId}/layout.json`에 기본 pane/tab tree를 만든다.
4. tab은 `pt-{workspaceId}-{paneId}-{tabId}` tmux session에 대응한다.
5. pane/tab 추가, 삭제, 이동, 분할, rename은 layout file mutation 후 sync event를 broadcast한다.
6. workspace rename/group 변경은 `workspaces.json`을 갱신하고 모든 client가 sync로 재조회한다.
7. layout에는 UI state와 tab metadata만 저장하고, terminal process 자체는 tmux가 유지한다.

중요한 규칙:

- layout mutation은 lock으로 직렬화한다.
- tab을 닫으면 해당 tmux session도 종료한다.
- browser reload나 mobile reconnect는 layout을 다시 읽어 UI를 재구성한다.
- 저장된 cwd가 사라지면 존재하는 상위 directory 또는 workspace directory로 보정한다.

## Terminal 서비스 로직

Terminal WebSocket은 binary protocol로 xterm.js와 tmux attach process를 연결한다.

```text
client xterm
  -> /api/terminal?session=pt-...
  -> terminal-server
  -> node-pty
  -> tmux -u -L codexmux attach-session -t pt-...
```

| Message | 방향 | 처리 |
| --- | --- | --- |
| `MSG_STDIN` | client -> server | pty stdin write |
| `MSG_STDOUT` | server -> client | xterm output write |
| `MSG_RESIZE` | client -> server | pty/tmux resize |
| `MSG_HEARTBEAT` | 양방향 | stale connection 감지 |
| `MSG_KILL_SESSION` | client -> server | tmux session 종료 |
| `MSG_WEB_STDIN` | client -> server | Codex web input bar text 전달 |

`Ctrl+D`는 terminal/Codex 입력에 포커스가 있으면 앱 단축키가 아니라 EOF(`0x04`)로 전달한다. Linux/Windows의 오른쪽 pane 분할 기본 단축키는 이 충돌을 피하기 위해 `Ctrl+Alt+D`다.

## Codex 세션 감지 로직

Codex provider는 현재 유일한 등록 agent provider다. UI와 저장 field는 호환성을 위해 `agent*` 이름을 유지한다.
Codex CLI의 experimental `app-server` protocol은 `src/lib/providers/codex-app-server`에 guarded adapter로만
둔다. 이 adapter는 protocol fixture를 timeline entry로 변환하고 provider별 record identity 기반 stable id를
검증하지만, `listProviders()`에는 등록하지 않는다. runtime provider 전환은 app-server protocol의 approval/status
event와 lifecycle 안정성이 확인된 뒤 별도 gate로 판단한다.

감지 순서:

1. pane shell PID를 가져온다.
2. pane 아래 child process tree에서 `codex` process를 찾는다.
3. process cwd, command args, process start time을 읽는다.
4. command args나 저장 metadata에서 session id를 추출한다.
5. `~/.codex/sessions/**/*.jsonl`을 session id로 찾는다.
6. session id가 없으면 같은 cwd에서 process start time과 가까운 JSONL을 찾는다.
7. live Codex process가 확인된 경우에 한해 cwd 최신 JSONL fallback을 마지막으로 허용한다.

Codex CLI가 process 시작 후 JSONL을 늦게 생성할 수 있으므로 process start time 매칭은 120초 허용치를 둔다. 일반 JSONL 검색은 cwd만으로 최신 파일을 고르지 않는다. 같은 workspace에서 여러 Codex tab이 동시에 실행될 수 있기 때문이다. 단, timeline attach에서 active process가 없거나 active JSONL이 interrupted 상태이고 저장된 JSONL보다 같은 cwd의 최신 JSONL이 더 새 파일이면 최신 파일로 전환한다. 이 fallback은 API/외부 Codex 세션처럼 tmux pane의 child process로 잡히지 않는 세션을 모바일 CODEX 탭에 동기화하기 위한 경로다.

## Timeline 서비스 로직

Timeline은 terminal scrollback을 그대로 보여주는 기능이 아니라 Codex JSONL을 구조화해 보여주는 기능이다.

1. client가 `/api/timeline?session=...&panelType=codex`에 연결한다.
2. server가 pane PID로 active Codex session을 감지한다.
3. JSONL path가 확인되면 file watcher를 공유 singleton에 등록한다.
4. 초기 응답은 tail snapshot을 `timeline:init`으로 보낸다. 같은 file size/mtime/maxEntries면 watcher의 tail snapshot cache를 재사용한다.
5. 파일 append가 생기면 추가 byte range만 읽어 `timeline:append`로 보낸다.
6. session id가 바뀌면 `timeline:session-changed`를 보낸다.
7. 오래된 항목은 HTTP `/api/timeline/entries`로 페이지 단위 load-more 한다.

`timeline-server`는 WebSocket lifecycle과 tmux/provider 연결을 유지하고, init meta/last user message 계산은
`timeline-file-watcher-service`, session connection filtering은 `timeline-subscription-service`,
resume session id validation은 `timeline-resume-service`로 분리한다. 이 분리는 runtime v2 WebSocket bridge와
legacy file watcher가 같은 순수 helper를 쓰도록 만든 경계다.

`CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=default`일 때 7번의 HTTP read path와 session list,
message counts는 legacy URL을 유지하면서 Timeline Worker command로 처리된다. WebSocket
init/append/session-changed/resume은 아직 legacy `timeline-server`가 소유한다.

같은 tmux session에서 `agentSessionId`만 바뀐 경우에도 client는 timeline WebSocket을 새로 연다. Android WebView처럼 기존 connection이 살아 보이지만 stale JSONL을 보고 있는 상태를 피하기 위함이다.

중복 방지 정책:

- entry id는 JSONL provider에서는 byte offset과 record identity를, protocol provider에서는 provider id와
  record identity를 기반으로 만든다.
- 같은 assistant text가 `event_msg.agent_message`와 `response_item.message` pair로 들어오면 near-duplicate로 합친다.
- foreground reconnect 중 init/append 범위가 겹쳐도 client merge에서 중복을 제거한다.
- client render는 append burst를 frame 단위로 합치고, 기존 timeline row는 entry object reference가 유지되면 memo로 재렌더를 건너뛴다.

## Session Index 서비스 로직

`SessionIndexService`는 session list API에서 JSONL 전체를 직접 스캔하지 않도록 로컬 Codex JSONL을 snapshot으로 정규화한다.

1. startup에서 `~/.codexmux/session-index.json`을 읽어 즉시 사용 가능한 snapshot을 만든다.
2. 백그라운드 refresh가 `~/.codex/sessions/**/*.jsonl`의 `mtime`/size를 비교한다.
3. 변경된 JSONL만 본문을 파싱해 첫 user message, turn count, cwd, activity time을 갱신한다.
4. `/api/timeline/sessions`는 `codex` panel 요청에서 live tmux session 존재 여부와 무관하게 index snapshot의 요청 page만 public session shape로 변환해 반환한다.
5. Codex provider의 `findCodexSessionJsonl()`은 먼저 index에서 session id, cwd, process start time 후보를 찾고, index miss 때만 기존 filesystem scan으로 fallback한다.
6. refresh 결과가 이전 persisted snapshot과 같으면 `session-index.json` write를 건너뛴다.
7. `/api/debug/perf`는 session index의 indexed file 수, cache hit/miss, build duration, persist write/skip count를 숫자로 노출한다.

Session 선택은 `codex resume <sessionId>` 경로를 유지한다.

## Status 서비스 로직

StatusManager는 tab마다 다음 신호를 합쳐 `cliState`를 정한다.

| 신호 | 출처 | 역할 |
| --- | --- | --- |
| terminal connection | terminal WebSocket | client 연결 여부 |
| agent process | process tree poll | Codex 실행 여부 |
| JSONL event | timeline/parser | task start/complete, current action |
| hook/statusline event | `/api/status/*` | Codex hook 보조 신호 |
| live pane capture | tmux pane snapshot | permission/input prompt, interrupted prompt 보정 |
| layout metadata | `layout.json` | tab/workspace/session id 보존 |

상태 전이는 `status-state-machine`의 순수 reducer가 담당한다.

```text
inactive
  -> idle
  -> busy
  -> needs-input
  -> ready-for-review
  -> idle
```

운영 규칙:

- `task_complete`가 확인되어야 작업 완료로 본다.
- `ready-for-review`는 사용자가 focus/dismiss하기 전까지 유지한다.
- 서버 재시작 전 `busy`였던 tab은 `unknown`으로 복구를 시작한다.
- notification dedupe key는 session id와 turn id를 우선 사용한다.
- foreground toast, native notification, Web Push는 같은 notification policy를 따른다.
- Codex permission/input prompt가 JSONL/hook event 없이 live pane에만 보이면 pane capture recovery가 `needs-input`을 합성한다. Resume directory prompt처럼 persisted state가 `idle`이어도 실제 CLI가 선택을 기다리면 `needs-input`으로 복구한다.
- `/api/tmux/permission-options`는 live pane capture에서 latest prompt block만 파싱해 option list, focused index, `captureEmpty`, sanitized approval metadata를 반환한다. Metadata는 `command`, `file`, `permission`, `resume-directory`, `conversation`, `unknown` prompt type과 `allow`, `deny`, `trust`, `directory`, `input`, `unknown` kind, `low|medium|high|unknown` risk, sanitized command preview, basename-only file hint만 포함한다. API option label은 기존 index 선택 호환을 위해 CLI 선택지 텍스트를 유지하지만, status/Web Push/log payload에는 full command, cwd, session name, JSONL path, prompt body, assistant text, terminal output을 넣지 않는다.
- Codex가 `Conversation interrupted` 입력 프롬프트에 멈췄지만 JSONL interrupt marker를 남기지 않으면 pane capture recovery가 stale `busy`를 `idle`로 되돌린다.
- poll duration, tab/pane count, broadcast count는 perf snapshot에 남겨 polling 비용을 확인한다.
- `/login` 같은 인증 전 public route는 status/native notification/Web Push/service worker runtime service를 마운트하지 않는다. fresh install 또는 app data clear 후 auth WebSocket 실패와 service worker registration console noise가 없어야 한다. `/sw.js` 자체는 PWA/Web Push 설치를 위한 static service worker script이므로 auth redirect 없이 public asset으로 제공한다.
- PWA manifest는 `/api/manifest`에서 제공하고 iOS startup image는 `public/splash/*.png` 정적 파일로 제공한다. Startup image는 `scripts/generate-splash.js`에서 `codexmux` branding으로 생성하며, 기존 Home Screen 앱이 이전 이미지를 계속 보이면 iOS cache 문제로 보고 재설치를 안내한다.
- `smoke:permission`은 임시 HOME/server/tmux tab에서 permission prompt 모양의 pane output을 만들고 `/api/status` WebSocket, `/api/tmux/permission-options`, `/api/tmux/send-input`, `status:ack-notification` 전환을 함께 검증한다. Resume directory prompt와 interrupted prompt는 `permission-prompt`/`codex-pane-state` unit test가 parser 회귀를 잡는다.

## Sync 서비스 로직

Sync WebSocket은 데이터 자체를 계속 스트리밍하지 않고 invalidation event를 broadcast한다.

```text
store mutation
  -> broadcastSync({ type })
  -> connected clients
  -> client refetch workspace/layout/config
```

사용처:

- workspace create/rename/delete/reorder/group 변경
- layout pane/tab mutation
- config 변경
- foreground 복귀 후 workspace/layout 재동기화

이 방식은 여러 browser/mobile client가 동시에 열려 있어도 파일 저장을 server source of truth로 유지한다.

## 성능 Cache와 Lazy Guard

성능 최적화는 source of truth를 바꾸지 않는 짧은 cache와 hidden-state guard부터 적용한다.

- `/api/debug/perf`는 process와 service별 숫자 지표만 반환한다.
- stats page의 여러 endpoint가 동시에 cache build를 요청하면 `getStatsCache()`의 in-flight promise를 공유한다.
- stats cache가 이미 있으면 `/api/stats/cache-status`는 JSONL 파일 수 scan을 생략한다.
- diff full response는 `cwd + diff hash` 기준의 짧은 server memory cache를 사용한다.
- diff panel은 browser hidden 상태의 hash polling을 건너뛰고 visible 복귀 때 다시 확인한다.

## 모바일 foreground reconnect 로직

Android WebView와 모바일 브라우저는 background에서 WebSocket 객체가 `OPEN`이어도 실제 TCP 연결이 끊길 수 있다. client hook들은 다음 신호를 감지한다.

- `visibilitychange`
- `pagehide`
- `pageshow`
- `focus`
- `online`
- Android native `codexmux:native-app-state`

일정 시간 이상 hidden 상태였거나 bfcache restore/native foreground 복귀가 감지되면 terminal/status/timeline/sync WebSocket을 readyState와 관계없이 새로 연결한다. Android native background 이벤트에서는 stale WebSocket과 retry timer를 닫고, foreground 복귀 때 `/api/health` readiness probe가 응답한 뒤 socket을 다시 연다. sync hook은 foreground 복귀 시 workspace/layout도 다시 가져온다.

Android foreground 복귀 직후 stale socket이 닫히며 발생하는 expected terminal/timeline connection error는 짧은 foreground reconnect grace window 안에서 console error로 남기지 않는다. 이 억제는 Android lifecycle 복귀 중 expected reconnect noise에만 적용하고, UI 복구 여부는 새 socket attach와 workspace/layout/status/timeline 재조회 결과로 판단한다. WebView main-frame network/HTTP/SSL 실패는 native client가 현재 load를 중단한 뒤 다음 UI tick에서 launcher를 열어 recovery path가 renderer load와 겹치지 않게 한다.

모바일 CODEX `check` 화면은 timeline attach 전에도 terminal preview를 보여준다. 이 preview는 tmux의 실제 Codex 출력을 그대로 보여주므로 JSONL attach 지연이나 permission prompt 대기 상태를 확인할 수 있다.

Android WebView에는 `CodexmuxAndroid` JavaScript interface가 주입된다. 런처와 서버 접속 후 모바일 내비게이션은 이 bridge를 통해 앱 versionName/versionCode, package, device, Android version을 읽고, 사용자가 요청하면 현재 Activity를 새 task로 다시 열어 WebView를 재시작한다. 서버 버전은 React bundle의 `package.json` version과 `NEXT_PUBLIC_COMMIT_HASH`를 표시한다.

Android WebView DevTools 기반 smoke는 `smoke:android:foreground`, `smoke:android:recovery`, `smoke:android:runtime-v2`, `smoke:android:timeline-foreground`로 유지한다. foreground smoke는 native bridge와 `triggerEvent` fallback, blocking console/logcat, foreground reconnect를 확인하고, recovery smoke는 network/HTTP 4xx/SSL main-frame 실패가 launcher로 복귀한 뒤 저장 서버로 재연결되는지 확인한다. recovery smoke는 DevTools target lifetime flake를 제품 failure로 오판하지 않도록 failure class별 독립 app start로 실행한다. runtime v2 smoke는 temp server를 Tailscale IP로 열고 Android WebView page context에서 `/api/v2/terminal` attach/output과 foreground reconnect를 검증한다. timeline foreground smoke는 Android background 중 Codex JSONL을 append한 뒤 foreground 복귀 시 `/api/timeline` WebSocket init이 증가한 `totalEntries`를 받는지 확인해 stale JSONL reconnect를 잡는다.

## Notification 서비스 로직

알림은 status state와 notification policy의 결과로만 발생한다.

| 상황 | 상태 | 알림 |
| --- | --- | --- |
| Codex가 permission/input을 기다림 | `needs-input` | toast/native/Web Push 가능 |
| Codex turn 완료 | `ready-for-review` | 작업 완료 알림 가능 |
| reconnect나 polling으로 같은 완료를 다시 관측 | 기존 상태 유지 | dedupe로 차단 |
| 사용자가 tab focus/dismiss | `idle`로 정리 | 추가 알림 없음 |

`soundOnCompleteEnabled=false`이면 toast sound뿐 아니라 native/background notification도 silent로 요청한다.

전역 approval queue는 `needs-input` tab을 notification panel에 모아 `/api/tmux/permission-options`의 option list와 sanitized metadata를 표시한다. 사용자가 선택하면 기존 `/api/tmux/send-input`에 option index를 보내고 `status:ack-notification`으로 `needs-input -> busy` 전이를 요청한다. 선택지 조회나 전송이 실패하면 terminal tab 이동 fallback을 유지한다. 선택지가 표시된 시점, fallback, 선택 전송 성공/실패는 `~/.codexmux/approval-audit.jsonl`에 원문 없이 append한다. Needs-input Web Push는 기존 tab navigation payload를 유지하고, 새 창 fallback에서는 workspace/tab/session id만 담은 root deep link query로 복구한다. Push payload와 deep link에는 prompt 본문이나 raw command/file path를 싣지 않는다.

## 운영 서비스 로직

Linux 상시 실행은 `systemd --user`를 기준으로 한다.

```text
systemd --user codexmux.service
  -> node bin/codexmux.js
  -> dist/server.js
  -> .next/standalone/server.js
```

운영 원칙:

- root/system-wide service로 실행하지 않는다.
- `~/.codexmux/`, `~/.codex/`, tmux socket, NVM Node path가 모두 동일 user 기준이어야 한다.
- source 변경 후 production 반영은 `corepack pnpm deploy:local`로 build, service restart, health check를 함께 수행한다.
- live checkout에서 `.next/standalone`을 다시 만드는 packaging/build smoke를 실행한 뒤에는 service process cwd가 삭제된 standalone directory를 가리킬 수 있으므로 service를 재시작해 cwd를 정상화한다.
- native Android 파일을 바꾸지 않은 React/server 변경은 APK 재배포 없이 `corepack pnpm deploy:local`로 반영된다.
- `android/` native bridge나 `android-web/` launcher asset을 바꾸면 `corepack pnpm android:install` 또는 release APK/AAB 재배포가 필요하다.

## 장애 대응 기준

| 증상 | 우선 확인 | 기준 문서 |
| --- | --- | --- |
| terminal 출력 없음 | tmux capture, `/api/terminal`, xterm ready state | `TMUX.md` |
| CODEX timeline이 비어 있음 | `detectActiveCodexSession`, JSONL path, session id | `STATUS.md` |
| 모바일 복귀 후 끊김 | foreground reconnect, sync refetch, server health | `ANDROID.md` |
| workspace가 엇갈림 | `workspaces.json`, `layout.json`, sync broadcast | `DATA-DIR.md` |
| 서비스가 안 뜸 | user service, port, lock, journal | `SYSTEMD.md` |
| 중복 메시지/알림 | timeline entry id, dedupe, completion key | `STATUS.md` |

## 변경 시 문서 갱신 기준

- server startup, WebSocket routing, shared singleton을 바꾸면 이 문서와 `ADR.md`를 갱신한다.
- tmux/session/process 감지나 terminal protocol을 바꾸면 `TMUX.md`를 갱신한다.
- `TCliState`, `ITabState`, `StatusManager`, provider metadata를 바꾸면 `STATUS.md`를 갱신한다.
- Android/Electron shell 또는 mobile reconnect 정책을 바꾸면 `ANDROID.md`/`ELECTRON.md`를 갱신한다.
- 저장 파일 구조를 바꾸면 `DATA-DIR.md`를 갱신한다.
