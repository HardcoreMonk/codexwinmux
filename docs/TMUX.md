# tmux, 터미널, agent process 감지

codexmux는 오래 살아야 하는 터미널 backend로 tmux를 사용한다. 브라우저는 xterm.js를 렌더링하고, 서버는 node-pty로 tmux session에 붙는다.

## 구조

```text
Browser (xterm.js)
  │ WebSocket /api/terminal
  ▼
terminal-server.ts
  │ node-pty attach-session
  ▼
tmux -L codexmux
  ├─ pt-{workspaceId}-{paneId}-{tabId}
  └─ ...
```

- socket name: `codexmux`
- session name: `pt-{workspaceId}-{paneId}-{tabId}`
- config: `src/config/tmux.conf`
- 사용자 `~/.tmux.conf`: 읽지 않음

## tmux 설정

| 설정 | 값 | 목적 |
|---|---|---|
| `prefix` | disabled | key를 shell/Codex로 직접 전달 |
| `status` | off | tmux chrome 숨김 |
| `set-titles` | on | foreground process와 cwd 전달 |
| `set-titles-string` | `#{pane_current_command}\|#{pane_current_path}` | process/cwd 감지 protocol |
| `status-interval` | `2` | 2초마다 title metadata refresh |
| `mouse` | on | scroll/copy 활성화 |
| `history-limit` | `5000` | tmux scrollback |

## terminal WebSocket

Legacy local endpoint는 `/api/terminal?session={name}&clientId={id}`다.

| code | 이름 | 방향 | payload |
|---|---|---|---|
| `0x00` | `MSG_STDIN` | client -> server | key byte |
| `0x01` | `MSG_STDOUT` | server -> client | terminal output |
| `0x02` | `MSG_RESIZE` | client -> server | `cols`, `rows` |
| `0x03` | `MSG_HEARTBEAT` | 양방향 | keepalive |
| `0x04` | `MSG_KILL_SESSION` | client -> server | tmux session 종료 |
| `0x05` | `MSG_WEB_STDIN` | client -> server | web input bar text |

일반 stdout burst는 8ms 또는 64KiB 중 먼저 도달한 조건으로 짧게 coalescing한 뒤 `MSG_STDOUT`으로 보낸다. stdin, web stdin, resize, heartbeat, kill session message는 지연하지 않는다. WebSocket backpressure가 커지면 pty output을 잠시 멈추고 client가 따라잡으면 재개한다.

## Experimental Runtime v2 Terminal

기존 `/api/terminal`은 production terminal WebSocket으로 유지된다. 실험용
`/api/v2/terminal`은 `CODEXWINMUX_RUNTIME_V2=1`에서만 열리는 Terminal Worker-owned
경로이며, `rtv2-` session만 받는다.

새로 생성되는 legacy terminal-backed tab은 `runtimeVersion: 1`, runtime v2 tab은
`runtimeVersion: 2`를 가진다. 기존 JSON layout에 이 field가 없으면 legacy runtime
1로 해석한다.

`CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs`의 첫 production slice는 plain terminal
tab 생성만 runtime v2로 보낸다. Codex, diff, web-browser, resume, command-start tab은
legacy `pt-` 경로에 남긴다. 이 단계에서 legacy JSON layout은 계속 UI source of truth이며,
runtime v2 tab을 만들 때 legacy workspace/pane id를 SQLite에 mirror한 뒤 반환된
`rtv2-` tab을 JSON layout에 `runtimeVersion: 2`로 append한다. Desktop/mobile terminal
surface는 이 field로 `/api/terminal`과 `/api/v2/terminal`을 선택한다.

v2 attach/stdin/stdout/resize 흐름은 browser WebSocket에서 Supervisor IPC를 거쳐
Terminal Worker의 `node-pty` attach로 이어진다.

```text
Browser /api/v2/terminal
  -> custom server upgrade router
  -> Supervisor attach/write/resize
  -> Terminal Worker IPC
  -> node-pty
  -> tmux -u -L codexmux-runtime-v2 attach-session -t rtv2-...
```

v2 terminal stdout은 realtime-only stream이며 SQLite에 저장하지 않는다. 첫 slice는
Worker-to-Supervisor IPC가 무한히 커지지 않도록 byte-accounted stdout coalescing과
backpressure cap을 둔다. cap을 넘으면 해당 attach stream을 닫고, buffered partial
output은 flush하지 않는다.

runtime v2 startup은 terminal lifecycle을 한 번 reconciliation한다. stale
`pending_terminal` tab은 기존처럼 failed로 전환하고 matching v2 tmux session을
best-effort kill한다. `ready` terminal tab은 Terminal Worker의
`terminal.has-session` IPC로 `tmux -L codexmux-runtime-v2 has-session`을 확인하며,
tmux session이 없거나 session name이 invalid이면 Storage Worker가 해당 tab을
`failed`로 전환한다. failed tab은 layout projection과 v2 terminal attach
authorization에서 제외된다.

v2 client reconnect는 production terminal hook과 같은 heartbeat, retry backoff,
foreground/focus/online/BFCache/native app-state reconnect 정책을 사용하되
`/api/v2/terminal`에 연결한다. Terminal Worker crash 뒤 자동 stdout replay나
server-side resubscribe는 제공하지 않는다. client는 fresh WebSocket attach로 tmux에
다시 붙는다. Terminal Worker가 종료되면 subscriber socket은 retryable `1001`로 닫혀
client reconnect를 유도한다. 실제 tmux session이 사라진 `session-not-found` 상태에서는
복구 overlay가 같은 tab/session을 재생성하는 restart action을 제공하고, overlay 뒤의
floating reconnect control은 렌더하지 않는다.

tab/pane/workspace cleanup은 `runtimeVersion`을 기준으로 나뉜다. legacy 또는 missing
runtime tab은 `tmux -L codexmux`의 `pt-` session을 kill하고, runtime v2 tab은 Supervisor
delete command를 통해 SQLite state와 `tmux -L codexmux-runtime-v2`의 `rtv2-` session을
함께 정리한다.

runtime v2 server smoke는 다음 terminal properties를 검증한다.

```bash
corepack pnpm smoke:runtime-v2
```

- v2 health, workspace create/list, terminal tab create
- `/api/v2/terminal` attach, stdin/stdout, `100x30` resize
- Codex web input과 같은 `MSG_WEB_STDIN` frame이 pty stdin으로 전달되는지 확인
- client heartbeat frame이 heartbeat echo를 받는지 확인
- client detach 후 같은 `sessionName`으로 fresh attach
- 같은 `sessionName`에 대한 multiple WebSocket subscriber stdout fanout
- oversized queued input이 `1011 Terminal input backpressure`로 닫히는지 확인
- terminal tab delete 후 삭제된 session attach가 `1011`로 닫히는 cleanup rejection
- 남은 workspace delete cleanup

`CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=off` rollback에서는 신규 v2 tab 생성이
막힌다. 이미 legacy JSON layout에 남아 있는 `runtimeVersion: 2` tab은 삭제하지
않고, client가 `/api/v2/runtime/health` preflight에서 `runtime-v2-disabled`를 확인해
desktop/mobile surface에 명시적인 rollback diagnostic을 표시한다.

## terminal input과 앱 단축키

터미널 제어 입력은 앱 단축키보다 우선한다. 특히 `Ctrl+D`는 Codex CLI와 shell에서 EOF/EOT로 쓰이므로 포커스된 xterm 또는 Codex web input bar에서 `0x04`를 stdin으로 전달한다.

| 입력 위치 | 전송 경로 | 동작 |
|---|---|---|
| xterm viewport | `MSG_STDIN` | `0x04`를 pty에 직접 write |
| Codex web input bar | `MSG_WEB_STDIN` | tmux copy mode를 빠져나온 뒤 `0x04`를 pty에 write |
| mobile surface | `MSG_STDIN` 또는 `MSG_WEB_STDIN` | desktop과 같은 EOF 처리 |

이 정책 때문에 Linux/Windows의 오른쪽 pane 분할 기본 단축키는 `Ctrl+Alt+D`다. macOS는 terminal EOF가 `Ctrl+D`이고 앱 분할은 `⌘D`라 충돌하지 않는다. 사용자가 `keybindings.json`에서 앱 단축키를 바꾸더라도 터미널/Codex 입력에 포커스가 있으면 `Ctrl+D`는 EOF로 남긴다.

## title metadata

tmux title은 다음 형식이다.

```text
{pane_current_command}|{pane_current_path}
```

`src/lib/tab-title.ts`는 이 값을 파싱해 foreground process, cwd, tab title, shell readiness를 갱신한다.

## Codex 감지

`src/lib/codex-session-detection.ts`는 다음 순서로 Codex session을 감지한다.

1. `codex --version` 또는 `~/.codex/` 존재 확인.
2. pane shell PID 아래 child process 탐색.
3. Linux는 `/proc/{pid}/task/{pid}/children`을 우선 사용하고, 다른 플랫폼은 process utility fallback을 사용한다.
4. process command에서 `codex`를 확인하고 cwd를 읽는다.
5. `~/.codex/sessions/` 아래 JSONL을 session id 또는 같은 cwd의 process start time으로 매칭.

Codex CLI가 process 시작 후 JSONL을 늦게 쓰는 경우가 있어 start time 매칭은 120초 허용치를 둔다. `detectActiveCodexSession`은 live Codex process가 확인된 뒤에도 session id/start time으로 JSONL을 찾지 못하면 같은 cwd의 최신 JSONL을 마지막 보정으로 사용한다. 일반 JSONL 검색은 cwd만으로 최신 파일을 고르지 않는다.

새 코드에서 process/title/session 정보를 다룰 때는 직접 process command를 흩뿌리지 않고 기존 helper를 우선 사용한다.

| helper | 파일 | 용도 |
|---|---|---|
| `getPaneCurrentCommand(session)` | `src/lib/tmux.ts` | foreground process name |
| `getSessionCwd(session)` | `src/lib/tmux.ts` | pane cwd |
| `getSessionPanePid(session)` | `src/lib/tmux.ts` | pane shell PID |
| `checkTerminalProcess(session)` | `src/lib/tmux.ts` | resume 전 shell 확인 |
| `getChildPids(panePid)` | `src/lib/session-detection.ts` | pane 아래 process tree 조회 |
| `isCodexRunning(panePid)` | `src/lib/codex-session-detection.ts` | Codex process 감지 |
| `detectActiveCodexSession(panePid)` | `src/lib/codex-session-detection.ts` | active Codex session metadata |

## Timeline WebSocket

Endpoint는 `/api/timeline?session={name}&panelType={provider}`다. 서버는 provider가 감지한 JSONL을 tail하면서 초기 tail snapshot과 append event를 보낸다. 같은 JSONL의 file size/mtime/maxEntries가 그대로이면 watcher의 tail snapshot cache를 재사용해 foreground reconnect와 reload의 초기 tail 재파싱을 줄인다. active process가 없거나 active JSONL이 interrupted 상태이고 저장된 JSONL보다 같은 cwd의 최신 JSONL이 더 새 파일이면 최신 파일로 전환해 API/외부 Codex 세션 내용도 CODEX 탭에 붙인다.

| 모듈 | 책임 |
|---|---|
| `src/lib/timeline-server.ts` | timeline WebSocket request, subscribe/resume flow, file watch orchestration |
| `src/lib/timeline-server-state.ts` | connection/file watcher/session watcher singleton, send/backpressure helper |
| `src/lib/timeline-entry-id.ts` | JSONL offset과 record identity 기반 stable entry id |
| `src/lib/timeline-entry-dedupe.ts` | 같은 record 재수신과 paired assistant record 중복 방지용 fingerprint |
| `src/lib/timeline-entry-merge.ts` | init/append/load-more 병합, pending user message 보존 |

재연결이나 모바일 foreground 복귀 중 같은 JSONL 구간이 `timeline:init`과 `timeline:append`로 겹쳐 도착할 수 있다. client는 stable id와 fingerprint를 함께 사용해 중복 assistant output, tool result, pending user message를 한 번만 표시한다. append burst는 animation frame 단위로 merge하고, 기존 timeline row는 entry reference가 유지되면 memo로 재렌더를 건너뛴다. 같은 tmux session에서 `agentSessionId`만 바뀐 경우도 timeline WebSocket을 다시 열어 stale JSONL에 머무르지 않게 한다.

Codex CLI는 같은 assistant 문장을 `event_msg.agent_message`와 paired `response_item.message` 두 record로 기록할 수 있다. parser와 client merge는 exact timestamp가 아니라 normalized role/text와 짧은 시간창을 기준으로 near-duplicate를 제거한다.

## Git DIFF 패널

DIFF 패널은 별도 git workspace를 저장하지 않고 현재 tab의 tmux session cwd를 기준으로 동작한다. `/api/layout/diff?session={name}`는 `getSessionCwd(session)`로 cwd를 얻고, 해당 디렉터리가 Git work tree이면 status, diff, history, sync 정보를 계산한다.

대량 변경사항이 있는 저장소에서 DIFF 클릭이 terminal session을 막거나 browser render를 멈추지 않도록 다음 제한을 둔다.

| 항목 | 정책 |
|---|---|
| tracked diff | `git diff --no-ext-diff HEAD`, 최대 5MB buffer |
| untracked 목록 | `git ls-files --others --exclude-standard -z` 사용 |
| untracked 포함 수 | 최대 50개 파일 |
| untracked text 파일 | 256KB 이하만 inline diff 생성 |
| untracked 전체 diff | 최대 2MB까지 포함 |
| binary/대용량 파일 | 실제 내용을 읽지 않고 binary placeholder diff로 표시 |
| client fetch | 15초 timeout 후 오류 toast와 panel message 표시 |
| render | 파일 20개 초과 또는 hunk line 1200줄 초과 시 기본 접힘 |
| full diff cache | 같은 `cwd + diff hash`는 짧은 서버 메모리 cache로 재사용 |

`hashOnly=true` polling은 전체 diff를 만들지 않고 hash, ahead/behind, fetch 여부만 확인한다. browser tab이 hidden 상태이면 client는 polling을 건너뛰고 visible 복귀 시 즉시 다시 확인한다. refresh나 최초 진입처럼 전체 diff가 필요한 경우에도 제한을 초과한 untracked 파일 수는 응답의 `untrackedSkipped`, `untrackedTotal`로 내려 보내 사용자에게 생략 안내를 표시한다.

## 서버 시작 순서

1. `~/.codexmux/cmux.lock` 획득.
2. config와 shell `PATH` 로드.
3. auth credential 초기화.
4. tmux session scan과 cleanup.
5. `src/config/tmux.conf` 적용.
6. workspace와 layout 로드.
7. 설정된 경우 agent session 자동 resume.
8. `StatusManager` polling 시작.
9. Next.js와 WebSocket route 준비.
10. `~/.codexmux/port`, CLI token, bridge file 갱신.

## 관련 파일

| 파일 | 역할 |
|---|---|
| `src/lib/tmux.ts` | tmux command wrapper |
| `src/lib/terminal-server.ts` | terminal WebSocket과 node-pty bridge |
| `src/lib/terminal-output-buffer.ts` | stdout burst coalescing helper |
| `src/lib/terminal-protocol.ts` | binary protocol constant |
| `src/lib/timeline-server.ts` | timeline WebSocket과 JSONL watcher |
| `src/lib/timeline-server-state.ts` | timeline shared singleton state |
| `src/lib/codex-session-detection.ts` | Codex process/session detection |
| `src/lib/status-manager.ts` | process/status polling |
| `src/lib/tab-title.ts` | client title parser |
