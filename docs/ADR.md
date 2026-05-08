# Architecture Decision Records

이 문서는 codexmux에서 이미 선택한 오래가는 설계 결정을 한 곳에 모은다. 세부 구현 흐름은 `ARCHITECTURE-LOGIC.md`에 두고, 영역별 구현 문서는 `STATUS.md`, `TMUX.md`, `DATA-DIR.md`, `SYSTEMD.md`, `STYLE.md`, `ELECTRON.md`, `ANDROID.md`에 둔다.

## ADR 작성 기준

다음 변경은 이 문서를 함께 갱신한다.

- framework, router, server boundary 변경
- tmux/session/process 감지 방식 변경
- provider model 또는 `agent*` metadata 의미 변경
- `~/.codexmux/` 저장 구조나 auth/security 동작 변경
- Electron/Android 같은 platform client 동작 변경
- notification, locale, mobile UX, terminal input, reconnect/dedupe 같은 cross-platform 정책 변경

작은 copy, 단일 컴포넌트 스타일, 버그 수정은 기존 ADR의 결정과 충돌하지 않으면 새 ADR이 필요 없다.

## Accepted: Bridge-Owned External Trace

- Status: Accepted
- Decision: codexmux는 Discord로 직접 전송하지 않고, `CODEXMUX_BRIDGE_TRACE_URL`과
  `CODEXMUX_BRIDGE_TRACE_TOKEN`이 설정된 경우에만 status update summary를
  codex-ai-bridge의 loopback external trace ingress로 best-effort POST한다.
- Rationale: Discord token, channel routing, `/추적` preference, turn history ownership은
  codex-ai-bridge가 이미 소유한다. codexmux가 Discord client를 중복 구현하면 보안 경계와
  trace 정책이 분산된다.
- Consequences: payload는 workspace directory, tab id/name, Codex session id,
  `cliState`, `currentAction`, `lastAssistantMessage`, `lastUserMessage`로 제한한다. raw
  transcript, 전체 stdout, Discord token은 codexmux에서 전송하지 않는다. 같은 tab의 동일
  state/action 조합은 forwarder가 dedupe하며, 전송 실패는 status update broadcast를 막지
  않는다.

## Proposed: Supervisor And Worker Runtime

- Status: Proposed
- Decision: Pages Router와 custom Node server는 유지하되, public routing과
  worker lifecycle, typed IPC command routing을 소유하는 Supervisor 역할을 도입한다.
  Supervisor singleton, in-flight start promise, 준비된 runtime DB path는
  `globalThis`에 두어 custom server와 Next.js API route가 하나의 runtime을 공유한다.
- Rationale: terminal IO, storage mutation, JSONL parsing, process polling은 명시적인
  failure boundary와 ownership boundary를 가져야 한다.
- Consequences: runtime v2 API route는 direct store/tmux helper가 아니라 worker-backed
  Supervisor service를 호출한다. API route는 singleton을 가져와 `ensureStarted()`를
  기다린 뒤 필요한 Supervisor method만 호출하며 worker client를 직접 만들지 않는다.
  `ensureStarted()`는 stale pending terminal tab뿐 아니라 ready terminal tab과 실제
  runtime v2 tmux session 존재 여부도 reconciliation한 뒤에만 started 상태가 된다.
  Timeline Worker는 read-only foundation으로 먼저 들어가며 session list, older entry,
  message count command를 typed IPC로 처리한다.
  `CODEXMUX_RUNTIME_TIMELINE_V2_MODE=default`에서는 legacy HTTP read routes
  (`/api/timeline/sessions`, `/api/timeline/entries`, `/api/timeline/message-counts`)가
  내부적으로 Supervisor의 Timeline Worker read command를 호출한다. 같은 mode에서
  client-facing `/api/timeline` WebSocket URL은 유지하되 `handleRuntimeTimelineConnection()`이
  Supervisor의 Timeline Worker live/session-watch command를 사용해 init/append/error와
  `timeline:session-changed` delivery를 소유한다. Resume message execution은 기존 server
  helper의 unsafe-process guard와 `sendKeys` path를 재사용하지만, runtime bridge가 직접
  worker live subscription으로 전환하므로 legacy file watcher에는 붙지 않는다. Rollback은
  `CODEXMUX_RUNTIME_TIMELINE_V2_MODE=off`로 같은 URL의 legacy timeline server implementation을
  다시 사용한다.
  Status Worker는 policy foundation과 live default bridge를 함께 가진다.
  `CODEXMUX_RUNTIME_STATUS_V2_MODE=shadow`는 hook/Codex/client-event/side-effect policy를
  legacy pure helper와 비교하고, `default`는 worker process 안의 `StatusManager`가
  polling/JSONL watcher/hook application/ack/dismiss/session-history/Web Push/rate-limit update를
  소유한다. 기존 `/api/status` WebSocket URL은 유지하고 server는 worker realtime event를
  기존 client protocol로 변환한다. Rollback은 `CODEXMUX_RUNTIME_STATUS_V2_MODE=off`다.
  Phase 6 이후 `CODEXMUX_RUNTIME_V2=1`에서 per-surface mode env가 unset이면 code fallback은
  terminal `new-tabs`, storage/timeline/status `default`로 해석한다. 명시적 `off`는 계속
  rollback이고, 잘못된 명시 값은 `off`로 fail closed한다.

## Proposed: SQLite App State

- Status: Proposed
- Decision: workspace/layout/tab/status metadata의 runtime v2 source of truth는
  Storage Worker가 소유하는 `~/.codexmux/runtime-v2/state.db`다.
  `CODEXMUX_RUNTIME_V2_RESET=1`은 `state.db`, `state.db-wal`,
  `state.db-shm`을 독립적으로 timestamp `.bak` 파일로 이동한 뒤 새 DB를 만든다.
- Rationale: normalized entities, transactions, invariant enforcement, indexed
  queries, durable event logs는 JSON 파일과 직접 module caller 조합으로 안전하게
  유지하기 어렵다.
- Consequences: 첫 구현 slice에서 legacy JSON migration은 요구하지 않는다. 기존 JSON
  store는 유지하고 runtime v2는 parallel experimental state로 동작한다.
  Phase 2 terminal `new-tabs` 전환 중에는 legacy JSON layout을 UI source of truth로
  유지하고, plain terminal v2 tab 생성 시 legacy workspace/pane id를 Storage Worker에
  mirror한 뒤 생성된 `rtv2-` tab을 JSON layout에 `runtimeVersion: 2`로 append한다.
  이 mirror는 SQLite workspace/layout default ownership 전환이 아니다.
  Storage schema v2는 `tabs.runtime_version`과 `workspaces.active_pane_id`를 추가해
  JSON-to-SQLite import가 legacy `pt-` terminal tab, runtime v2 `rtv2-` terminal tab,
  non-terminal tab, split layout, active pane, status metadata를 같은 DB에 보존할 수
  있게 한다. Runtime v2 terminal attach authorization과 cleanup intent는 계속
  `runtime_version=2` terminal tab만 대상으로 삼아 imported legacy `pt-` sessions를
  v2 worker가 kill하지 않는다.
  Storage schema v3는 `workspace_directories`, `app_state`, `message_history`를 추가해
  workspace directory list, active workspace, sidebar collapsed/width, message history를
  SQLite projection에 보존한다.
  `CODEXMUX_RUNTIME_STORAGE_V2_MODE=write|default`는 production read source를 즉시
  바꾸지 않고 legacy JSON write 직후 같은 import path로 SQLite를 mirror한다. `default`
  mode에서는 workspace/layout/message-history read가 SQLite projection을 우선 사용하고
  실패 시 legacy JSON으로 fail closed한다. Message history write는 default mode에서
  SQLite를 우선 갱신하고 rollback용 JSON 파일을 함께 쓴다. Production live mode는 별도
  rollout 전까지 `write`로 유지했고, Phase 6 이후 unset storage mode는
  `CODEXMUX_RUNTIME_V2=1`에서 `default`로 해석한다. 명시적 `off`는 legacy JSON rollback이다.
  `better-sqlite3`는 optional dependency이며 lazy load된다. runtime v2가 꺼진
  install/build는 native binding load에 의존하지 않고, runtime v2가 켜졌을 때 binding
  부재는 `runtime-v2-sqlite-unavailable`로 실패한다.

## Proposed: Typed IPC

- Status: Proposed
- Decision: worker transport는 `child_process.fork` 기반 typed envelope IPC를 사용한다.
  첫 slice는 command registry와 event registry를 두고 command payload, successful reply
  payload, first-slice event payload를 모두 검증한다.
- Rationale: Node IPC는 별도 internal port 없이 TypeScript type/schema 재사용과
  process boundary 검증을 시작하기에 가장 단순한 경로다.
- Consequences: envelope validation만으로는 충분하지 않다. command-specific payload와
  successful reply payload validation, registered event constructor validation, correlation
  id, timeout, structured error, retryability 보존이 worker/Supervisor contract의 일부다.
  `timeline.*` read commands와 `status.*` policy commands도 같은 registry와 reply schema를
  통과해야 한다.

## Proposed: Terminal Streams Are Ephemeral

- Status: Proposed
- Decision: terminal stdin/stdout/resize stream은 realtime ephemeral data다. Terminal
  lifecycle과 status fact는 durable state가 될 수 있지만 terminal byte stream은 SQLite에
  저장하지 않는다.
- Rationale: tmux가 이미 terminal runtime source다. terminal byte를 별도 저장하면 큰
  저장 비용과 replay 복잡도가 생기지만 첫 번째 안정성 문제를 해결하지 못한다.
- Consequences: runtime v2 terminal stdout은 reconnect replay 대상이 아니다. client는
  Terminal Worker를 통해 tmux에 다시 attach해서 복구한다. runtime v2 ready terminal
  tab이 startup 시점에 tmux session을 잃은 경우 Storage Worker가 durable `failed`
  lifecycle로 전환하고 layout/attach surface에서 제외한다.

## ADR-001: Next.js Pages Router와 Custom Server 유지

- Status: Accepted
- Decision: Next.js Pages Router를 사용하고 `server.ts` custom Node server가 Next.js, WebSocket, tmux lifecycle을 함께 관리한다.
- Rationale: terminal WebSocket, tmux session lifecycle, CLI bridge, status manager가 한 프로세스 안에서 낮은 지연으로 협력해야 한다.
- Consequences: App Router와 `"use client"`를 도입하지 않는다. 인증 middleware 경로는 현재 Next.js 버전에 맞춰 `src/proxy.ts`를 사용한다.

## ADR-002: tmux를 영속 터미널 백엔드로 사용

- Status: Accepted
- Decision: terminal session은 `tmux -L codexmux`의 `pt-{workspaceId}-{paneId}-{tabId}` 세션으로 유지한다.
- Rationale: 브라우저, PWA, Android, Electron이 끊겨도 shell/Codex 작업은 유지되어야 한다.
- Consequences: terminal title, pane PID, cwd, process tree, Codex JSONL은 기존 helper를 통해 읽는다. 새 코드에서 `pgrep`, `ps`, `lsof`를 직접 흩뿌리지 않는다.

## ADR-003: Codex Provider 중심 모델

- Status: Accepted
- Decision: 현재 등록 provider는 Codex 하나이며 client/store field는 호환성을 위해 `agent*` 이름을 유지한다. Codex CLI의 experimental `app-server` protocol은 guarded adapter로만 검토하고, production provider registry에는 등록하지 않는다.
- Rationale: Codex 전환 이후에도 UI와 저장 데이터의 migration 범위를 줄이고 provider-neutral 경계를 유지한다.
- Consequences: `TCliState`, `ITabState`, `StatusManager`, provider detection, `agentSessionId`, `agentSummary` 변경 시 `docs/STATUS.md`도 함께 갱신한다. Codex JSONL 연결은 session id, 같은 cwd의 process start time, live process 확인 후 cwd fallback 순서로 제한하고, 일반 검색에서는 cwd만으로 최신 JSONL을 선택하지 않는다. app-server adapter fixture는 provider record identity 기반 stable timeline id를 검증하지만, approval/status event 안정성이 확인되기 전까지 tmux/JSONL production path를 대체하지 않는다.

## ADR-004: Shared State는 `globalThis` Singleton에 둔다

- Status: Accepted
- Decision: custom server와 Next.js API route가 공유해야 하는 singleton state는 `globalThis`에 저장하고 재초기화를 guard한다.
- Rationale: 같은 Node process 안에서도 server bundle과 API route module graph가 분리될 수 있다.
- Consequences: 새 key는 일반적으로 `__pt` plus PascalCase를 사용한다. 기존 `__codexmux*`, `__cmux*` key는 주변 코드와 맞춰 유지한다.

## ADR-005: App State는 `~/.codexmux/`, Codex State는 Read-only

- Status: Accepted
- Decision: codexmux 영속 상태는 `~/.codexmux/`에 저장하고, Codex CLI session JSONL은 `~/.codex/sessions/`에서 읽기 전용으로 참조한다.
- Rationale: codexmux 설정과 Codex CLI 소유 데이터를 분리해야 안전한 초기화와 migration이 가능하다.
- Consequences: `config.json` 삭제는 locale/theme/network/Codex option까지 초기화한다. 비밀번호만 초기화하려면 `authPassword`, `authSecret`만 제거한다.

## ADR-006: 한국어 기본, 영어 병행 지원

- Status: Accepted
- Decision: 지원 locale은 `ko`, `en`만 유지하고 기본 locale은 `ko`다.
- Rationale: 제품의 현재 운영 언어를 한국어 중심으로 고정하면서 영어 문서는 병행 제공한다.
- Consequences: SSR page는 저장된 locale로 message bundle과 `html lang`을 맞춘다. 새 copy는 Korean/English message file을 함께 갱신한다.

## ADR-007: Electron과 Android는 Client Shell이다

- Status: Accepted
- Decision: Electron과 Android 앱은 Codex/tmux를 직접 재구현하지 않고 실행 중인 codexmux 서버에 연결하는 shell로 유지한다.
- Rationale: Codex와 tmux execution은 서버 환경에 두고, desktop/mobile 앱은 연결성과 UX를 담당하는 편이 안정적이다.
- Consequences: Electron remote/local server mode는 `~/.codexmux/config.json`을 공유한다. Android 런처는 서버 URL 저장, 최근 서버, 자동 연결, 연결 실패 복구, 앱 정보/재시작을 담당한다. Android WebView 안에서는 `CodexmuxAndroid` native bridge로 versionName/versionCode, package, device, Android version을 읽고 WebView/Activity를 재시작한다. Android main-frame network/HTTP/SSL 실패는 현재 WebView load를 중단한 뒤 launcher로 전환한다. Android WebView smoke는 ADB와 WebView DevTools로 foreground reconnect, failure recovery, fresh app data clear first-run을 반복 검증한다.

## ADR-008: Notification Sound는 공통 설정으로 제어

- Status: Accepted
- Decision: 작업 완료 사운드는 `soundOnCompleteEnabled` 하나로 toast, native notification, background Web Push를 함께 제어한다.
- Rationale: 사용자는 foreground/background나 shell 종류와 관계없이 동일한 알림 정책을 기대한다.
- Consequences: `soundOnCompleteEnabled=false`이면 completion sound를 재생하지 않고 system notification도 silent로 요청한다. Permission/input 요청 상태는 `needs-input` flow를 유지한다. Hook/JSONL에 직접 기록되지 않는 Codex CLI prompt는 live pane capture로 보정해 notification panel queue에 연결한다.

## ADR-009: 모바일 UX는 터미널 안정성을 우선한다

- Status: Accepted
- Decision: 모바일 UI 개선은 Android 런처, navigation sheet, header, bottom tab bar, 상태 surface를 중심으로 적용하고 terminal input/reconnect 구조는 보수적으로 유지한다. WebView foreground 복귀 시 terminal/status/timeline/sync WebSocket은 stale `OPEN` 상태를 신뢰하지 않고 필요하면 강제 재연결한다.
- Rationale: 모바일에서 입력 draft 보존과 재접속 안정성이 시각 변화보다 중요하다.
- Consequences: touch target, `active`, `focus-visible`, safe-area, Korean-first typography를 적용하되 xterm, input, textarea, code/path 영역은 줄바꿈 예외로 둔다. Android native shell은 원격 page에 Capacitor bridge가 없어도 `triggerEvent` fallback을 설치하고 page load 후 다시 보강한다. Foreground forced reconnect 중 expected stale WebSocket connection error는 짧은 grace window에서 console noise로 남기지 않고, 실제 복구 판단은 새 socket attach와 workspace/layout/status/timeline 재조회로 한다. `/login` 같은 인증 전 public route는 status/native notification/Web Push/service worker runtime service를 마운트하지 않아 fresh install과 app data clear 이후 auth WebSocket/service worker registration console noise를 만들지 않는다. `/sw.js`는 PWA/Web Push 설치용 static service worker script라 auth redirect 없이 public asset으로 제공한다. iOS startup image는 `scripts/generate-splash.js`에서 `codexmux` branding으로 생성한 `public/splash/*.png`만 사용한다. 모바일 CODEX `check` 화면은 timeline이 아직 붙지 않아도 하단 terminal preview를 보여 실제 tmux 출력을 확인할 수 있게 한다. 모바일 내비게이션의 앱 정보 화면은 Android 앱 버전/기기 정보와 서버 버전을 표시하고 앱 재시작 진입점을 제공한다.

## ADR-010: 상태와 타임라인 정책은 순수 모듈로 분리한다

- Status: Accepted
- Decision: 완료 판정, 알림 판정, session id mapping, 타임라인 entry merge/dedupe, stable id 생성은 `StatusManager`나 React hook 내부가 아니라 순수 helper 모듈에서 처리한다.
- Rationale: 모바일 재연결, JSONL watcher, polling, stop-hook 재확인이 같은 Codex turn을 여러 경로로 관측하고, Codex CLI가 같은 assistant text를 paired `event_msg`/`response_item` record로 남길 수 있다. 부수효과가 있는 서버 클래스 안에서 정책을 직접 유지하면 중복 알림과 중복 timeline 출력이 쉽게 생긴다.
- Consequences: `status-state-machine`, `status-session-mapping`, `status-notification-policy`, `status-side-effect-policy`, `status-client-event-policy`, `status-metadata`, `permission-prompt`, `codex-pane-state`, `timeline-entry-id`, `timeline-entry-dedupe`, `timeline-entry-merge`는 단위 테스트를 동반한다. Timeline dedupe는 stable id뿐 아니라 normalized role/text 기반 near-duplicate도 다룬다. `StatusManager`, `timeline-server`, `use-timeline`은 신호 수집, 상태 적용, WebSocket 송신 같은 부수효과를 담당한다. Live pane capture 보정은 permission/input prompt를 `needs-input`으로, JSONL marker 없는 interrupted prompt를 `idle`로 복구하는 서버 부수효과로 유지한다.

## ADR-011: DIFF 패널은 제한된 Git snapshot으로 렌더링한다

- Status: Accepted
- Decision: DIFF 패널은 현재 tmux session cwd의 Git snapshot을 보여주되 tracked diff, untracked 파일 수, untracked 파일 크기, 전체 untracked diff 크기, client fetch 시간을 제한한다.
- Rationale: Codex 작업 디렉터리에는 screenshot, build output, generated file 같은 untracked 파일이 대량으로 생길 수 있다. 모든 파일을 diff로 만들고 한 번에 펼치면 API 응답과 browser render가 함께 hang처럼 보일 수 있다.
- Consequences: `/api/layout/diff`는 제한을 초과한 untracked 파일을 생략하고 생략 수를 응답한다. binary와 대용량 파일은 placeholder로 표시한다. 같은 `cwd + diff hash`의 full diff는 짧은 서버 메모리 cache로 재사용하고, browser hidden 상태에서는 hash polling을 건너뛴다. client는 대량 파일이나 큰 hunk를 기본 접힘으로 렌더링하고 timeout/error 상태를 사용자에게 표시한다.

## ADR-012: 터미널 제어 입력은 앱 단축키보다 우선한다

- Status: Accepted
- Decision: 포커스된 xterm, Codex web input, 모바일 surface에서 `Ctrl+D`는 앱 단축키로 처리하지 않고 EOF/EOT(`0x04`)로 pty에 전달한다.
- Rationale: codexmux는 Codex CLI를 웹에서 감싸는 제품이므로 shell/Codex CLI의 기본 제어 키가 유지되어야 한다. 특히 Codex CLI는 `Ctrl+D`로 프로세스 종료 흐름을 제공한다.
- Consequences: Linux/Windows의 오른쪽 pane 분할 기본 단축키는 `Ctrl+D` 대신 `Ctrl+Alt+D`를 사용한다. macOS는 앱 분할을 `⌘D`로 유지한다. `keybindings.json`은 앱 단축키 override만 저장하며, terminal/Codex 입력 포커스의 `Ctrl+D` EOF 처리는 override보다 우선한다. 새 terminal key handling은 desktop xterm, web input bar, mobile surface를 함께 검증한다.

## ADR-013: 성능 계측은 인증된 Snapshot API로 노출한다

- Status: Accepted
- Decision: 성능 최적화는 먼저 `globalThis.__ptPerfStore` 기반 런타임 계측과 인증된 `/api/debug/perf` snapshot으로 관측한 뒤 좁게 진행한다.
- Rationale: 현재 병목 후보는 Node server, WebSocket, tmux, JSONL parsing, React render 경로에 분산되어 있다. rewrite나 큰 구조 변경 전에 process memory, event loop, watcher, poll, WebSocket, parse 비용을 같은 기준으로 확인해야 한다.
- Consequences: perf snapshot은 숫자와 duration/counter만 반환한다. session id, cwd, JSONL path, prompt, assistant text, terminal output 본문은 노출하지 않는다. endpoint는 middleware auth를 통과해야 하며 public health check로 쓰지 않는다. Runtime v2 Worker diagnostics는 worker name별 lifecycle/command counter와 sanitized last error만 `services.runtimeWorkers`에 노출한다. 성능 개선은 timeline append batching/row memo, JSONL tail snapshot cache, DIFF short cache, stats in-flight dedupe처럼 source of truth를 바꾸지 않는 좁은 변경을 우선한다.

## ADR-014: Windows 기기 연동 기능은 제거한다

- Status: Accepted
- Decision: 이전 원격 기기 동기화, 원격 terminal sidecar, 원격 session filter, 전용 page/API route, helper script를 제품 surface에서 제거한다. Session list와 timeline은 로컬 `~/.codex/sessions/**/*.jsonl`만 인덱싱하고, terminal WebSocket은 tmux-backed `/api/terminal`과 runtime v2 `/api/v2/terminal`만 유지한다.
- Rationale: codexmux의 핵심 안정성은 tmux-backed session, 로컬 Codex JSONL, 모바일/desktop reconnect에 있다. 별도 Windows sidecar 경로는 다른 lifecycle, 별도 auth/token 배포, 읽기 전용 timeline, 별도 terminal queue를 요구해 운영면과 테스트면을 넓혔지만 핵심 session 안정성에 직접 기여하지 않았다.
- Consequences: 이전 빌드가 만든 `~/.codexmux/remote/codex/` 파일은 삭제하지 않지만 현재 앱은 읽지 않는다. 필요하면 운영자가 수동으로 지울 수 있다. 새 Windows 연동을 다시 도입하려면 별도 ADR, lifecycle spec, platform smoke 기준을 먼저 갱신해야 한다.

## ADR-015: Session list는 백그라운드 인덱스를 사용한다

- Status: Accepted
- Decision: `/api/timeline/sessions`는 요청마다 Codex JSONL을 재귀 스캔하지 않고 `SessionIndexService`의 `globalThis.__ptSessionIndex` snapshot을 읽는다. 인덱스는 `~/.codexmux/session-index.json`에 persist하고 백그라운드 refresh로 갱신한다.
- Rationale: 로컬 Codex 세션이 늘어나면 session list 요청 경로에서 전체 JSONL 파싱, 정렬, slice가 반복되어 메모리와 CPU가 급증한다. session 목록은 실시간 terminal byte stream보다 지연 허용치가 크므로 request path에서 source scan을 제거하는 편이 안정적이다.
- Consequences: 로컬 Codex JSONL은 mtime/size가 바뀐 파일만 다시 파싱한다. session list API는 index snapshot을 페이지네이션만 해서 반환한다. Codex provider의 JSONL lookup은 index를 먼저 사용하고 miss 때만 filesystem scan으로 fallback한다. `/api/debug/perf`는 session index의 파일 수, cache hit/miss, build duration을 노출한다.

## ADR-016: Approval Queue Metadata는 Sanitized Projection으로 유지

- Status: Accepted
- Decision: Codex permission/input prompt의 approval queue metadata는 live pane capture에서 계산한 non-durable projection으로 유지한다. `/api/tmux/permission-options`는 기존 option index 선택 호환을 위해 CLI 선택지와 focused index를 반환하고, 별도로 `promptType`, `approvalKind`, `riskLevel`, sanitized command preview, basename-only file hint를 포함한 metadata를 반환한다.
- Rationale: 실제 prompt source는 tmux pane과 Codex CLI이며, codexmux가 별도 approval database나 정책 engine을 만들면 CLI 상태와 drift가 생긴다. 동시에 notification panel, fallback copy, Web Push target은 command/file/permission/resume/conversation 같은 최소 분류와 위험도 표시가 필요하다.
- Consequences: Metadata는 latest prompt block 범위에서만 계산해 scrollback contamination을 피한다. Full command, cwd, session name, JSONL path, prompt body, assistant text, terminal output, token-like 값은 metadata, status payload, Web Push payload, capture failure log에 넣지 않는다. API option label은 선택 index 호환을 위해 CLI 선택지 텍스트를 유지하므로 sanitized metadata와 같은 보안 경계로 취급하지 않는다. 현재 Web Push click routing은 기존 workspace/tab navigation을 유지하며, status state가 parsed prompt metadata를 소유하기 전까지 push payload에는 raw prompt detail을 추가하지 않는다. Durable approval action audit은 ADR-018의 sanitized event log로만 다룬다.

## ADR-017: Bridge Trace Forwarding은 Env-gated Local Feed로 제한

- Status: Accepted
- Decision: `CODEXMUX_BRIDGE_TRACE_URL`과 `CODEXMUX_BRIDGE_TRACE_TOKEN`이 설정된 경우에만 `StatusManager.broadcastUpdate` 뒤 status summary를 codex-ai-bridge external trace ingress로 best-effort POST한다. codexmux는 Discord API나 bot token을 직접 다루지 않는다.
- Rationale: Discord/bridge 추적은 codexmux status source와 분리된 운영 소비자다. status update를 bridge-owned ingress로만 전달하면 codexmux는 기존 status lifecycle을 유지하면서 외부 알림/추적 정책을 codex-ai-bridge에 맡길 수 있다.
- Consequences: Forwarding 실패는 status broadcast, notification, session history를 막지 않는다. Payload는 workspace directory, tab id/name, Codex session id, `cliState`, `currentAction`, `lastAssistantMessage`, `lastUserMessage`의 summary-only shape로 제한하고 field length를 cap한다. Discord token, raw transcript, terminal stdout, full JSONL path, auth cookie는 전송하지 않는다. 같은 tab의 동일 state/action/session 조합은 forwarder가 dedupe한다.

## ADR-018: Approval Audit은 Sanitized Action Log로 제한한다

- Status: Accepted
- Decision: approval queue의 durable history는 `~/.codexmux/approval-audit.jsonl` append-only action log로 제한한다. 저장 필드는 event type, workspace id, tab id, prompt/risk/approval enum, option count, selected option index, fallback reason이다.
- Rationale: 운영자는 approval queue가 실제로 표시됐는지, fallback이 있었는지, 선택 전송이 성공했는지 확인할 수 있어야 한다. 그러나 Codex permission prompt의 원문 command, file path, cwd, session name, JSONL path, prompt body, terminal output은 lock screen, status payload, local audit file 어디에도 장기 저장하지 않는 편이 안전하다.
- Consequences: `/api/approval/audit`는 POST body에서 whitelist field만 받아 store에 append하고, GET은 최신 event를 제한된 개수로 반환한다. Client는 option label이나 command preview를 audit에 보내지 않고 selected option index와 enum metadata만 보낸다. Web Push 새 창 fallback은 root deep link query에 workspace/tab/session id만 넣고 workspace name, workspace dir, command/file detail은 cache/message path에만 남긴다.

## ADR-019: Lifecycle Actions는 Allowlist와 Sanitized Audit으로 제한한다

- Status: Accepted
- Decision: `/experimental/runtime`에서 실행 가능한 lifecycle control은 서버 allowlist action id로 제한한다. 현재 action은 `phase6-gate`, `restart-service`, `deploy-local`이며 API는 임의 command text를 받지 않는다. Restart/deploy 계열 action은 exact confirmation phrase를 요구한다.
- Rationale: 운영 UI에서 Phase 6 gate, service restart, local deploy를 빠르게 실행할 필요는 있지만, codexmux server를 일반 원격 shell로 만들면 auth, audit, prompt/cwd/token 유출 위험이 커진다. Named action allowlist와 confirmation을 분리하면 좁은 운영 편의만 제공하면서 command injection과 accidental restart를 줄일 수 있다.
- Consequences: 실행 기록은 `~/.codexmux/lifecycle-actions.jsonl` append-only event로 남긴다. 저장 필드는 action id, status, timestamps, duration, exit code, sanitized failure label뿐이며 stdout/stderr, env, cwd, token, session name, JSONL path, prompt body, terminal output은 저장하지 않는다. 한 서버 process에서는 lifecycle action 하나만 실행된다. Rollback flag mutation, systemd drop-in 편집, arbitrary command execution은 별도 spec 없이는 UI action으로 추가하지 않는다.

## ADR-020: Windows-only 제품 타깃

- Status: Accepted
- Decision: codexmux의 다음 제품 전환 타깃은 Windows-only service/product다. 현재 tmux 중심 macOS/Linux server, Linux `systemd` operation, macOS Electron packaging, Android Capacitor shell은 전환 대상 current-state surface로 본다. 이 결정은 ADR-014에서 제거한 Windows companion sync, remote terminal sidecar, remote source model을 되살리지 않는다.
- Rationale: 사용자 목표는 기존 codexmux 기반을 Windows 전용 제품으로 전환해 구축하고 제공하는 것이다. 이를 기존 Windows companion integration의 복구로 해석하면 제거된 remote data/source/terminal model과 충돌하고, 실제 필요한 terminal runtime, process inspection, service host, installer, smoke gate 전환을 흐리게 만든다.
- Consequences: Windows-only gap audit과 transition plan을 먼저 유지한다. Terminal runtime은 `tmux` 자체가 아니라 adapter boundary 뒤의 구현으로 다뤄야 하며, process/session detection도 Linux `/proc`, `pgrep`, `ps`, `lsof`에 직접 묶이지 않게 분리해야 한다. Public terminal/timeline protocol은 가능한 유지하되, Windows runtime parity test가 생기기 전에는 tmux path를 제거하지 않는다. README, `TMUX.md`, `SYSTEMD.md`, `ELECTRON.md`, `ANDROID.md`, smoke command, release checklist는 Windows runtime implementation slice가 승인된 뒤 staged cutover한다.

## ADR-021: codexwinmux 전환은 release channel부터 적용한다

- Status: Accepted
- Decision: `0.4.8` Windows release에서는 GitHub repository와 updater publish channel을 `HardcoreMonk/codexwinmux`로 전환하되, Electron `productName`, `appId`, installer artifact basename, CLI binary, and data dir remain `codexmux`.
- Rationale: 제품명/app id/data dir rename은 installer identity, updater cache, Windows Start Menu/app shortcuts, `~/.codexmux` migration, CLI binary compatibility, docs, and rollback behavior를 동시에 바꾸는 hard-to-reverse decision이다. 현재 우선순위는 기존 `0.4.2` 설치 사용자가 published `0.4.8` Windows update channel로 안정적으로 올라오는지 증명하는 것이다.
- Consequences: `latest.yml`, `codexmux-Setup-<version>.exe`, and matching `.blockmap` are published under the `codexwinmux` GitHub release channel, but installed app identity and persisted data stay compatible with previous `codexmux` builds. A future full identity migration must include a separate spec, migration/rollback plan, signed installer evidence, user data preservation smoke, and explicit release notes. Do not opportunistically rename `~/.codexmux`, `com.hardcoremonk.codexmux`, `codexmux.exe`, or `codexmux`/`cmux` binaries in unrelated Windows runtime work.
