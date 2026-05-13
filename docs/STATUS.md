# Agent 상태 감지

codexmux는 tab마다 세 가지 상태를 분리해 추적한다.

1. terminal WebSocket 연결 여부.
2. tmux pane 아래 agent process 실행 여부.
3. UI badge와 notification에 표시할 agent 작업 상태.

등록된 provider는 Codex 하나이며 payload와 client store field는 `agent*` 이름을 사용한다.

## 흐름

```text
tmux pane
  ├─ process tree poll      -> provider.detectActiveSession()
  ├─ title update           -> current process + cwd
  └─ Codex JSONL change     -> timeline + metadata

StatusManager
  ├─ tab별 status 저장
  ├─ status-state-machine reducer로 상태 전이 판정
  ├─ status-session-mapping으로 session id/completion key 정규화
  ├─ status-notification-policy로 hook notification 처리 여부 판정
  ├─ live Codex pane capture로 permission/interrupted 입력 프롬프트 보정
  ├─ layout.json에 cliState/session metadata 저장
  ├─ session history와 Web Push side effect adapter 호출
  ├─ /api/status WebSocket broadcast
  └─ review/input 상태에서 toast/native/Web Push 알림 전송
```

## Experimental Runtime v2 Status

`CODEXWINMUX_RUNTIME_V2=1`의 SQLite schema에는 `tab_status`가 포함된다. runtime v2에는
Status Worker foundation도 있으며, 현재 범위는 `status-state-machine`과
`status-notification-policy`, `status-side-effect-policy`, `status-client-event-policy` 같은
순수 정책을 typed IPC 뒤에서 평가하는 것이다. `CODEXWINMUX_RUNTIME_STATUS_V2_MODE=shadow`에서는
`StatusManager.applyCliState()`가 legacy side-effect intent와 Status Worker
`status.evaluate-side-effects` intent를 비교하고 `/api/debug/perf` counter에 match,
mismatch, error만 기록한다. `dismissTab()`과 `ackNotificationInput()`도
`status.evaluate-client-event`로 ready-for-review dismiss와 needs-input ack acceptance를
shadow 비교한다. 이 shadow 비교는 Web Push payload, prompt, cwd, JSONL path, terminal
output을 기록하지 않는다.
production status source of truth는 계속 `StatusManager`와 layout metadata다.

Status Worker에는 session history write command foundation도 있다.
`status.add-session-history-entry`와 `status.update-session-history-dismissed-at`는
`CODEXWINMUX_RUNTIME_STATUS_V2_MODE=default`에서만 `StatusManager`의 write adapter가 사용한다.
`off`와 `shadow`에서는 기존 `session-history.json` write path를 유지한다. Broadcast는 아직
`StatusManager`가 담당하므로 이 foundation은 `/api/status` WebSocket ownership 전환이 아니다.

Web Push send command foundation도 있다. `status.send-web-push`는 `StatusManager`가 만든
기존 safe payload와 main process에서 계산한 foreground visibility boolean을 받아 worker에서
background Web Push 전송과 expired subscription 제거를 수행한다. 이 path 역시
`CODEXWINMUX_RUNTIME_STATUS_V2_MODE=default`에서만 사용하며, 실패 시 legacy send path로 fallback한다.
main-process production path에서도 session history write와 Web Push 전송은
`status-session-history-adapter`, `status-web-push-adapter` 뒤에서 실행한다. `StatusManager`는
상태 전이, dedupe, workspace/config 조회까지만 소유하고, runtime default/legacy fallback 선택과
전송 세부 구현은 adapter가 맡는다.

2026-05-05 live bridge 이후 `CODEXWINMUX_RUNTIME_STATUS_V2_MODE=default`에서는 Status Worker가
별도 process 안에서 `StatusManager` state machine을 실행한다. custom server는 startup 때
`status.live-start`를 호출하고, `/api/status` WebSocket은 `subscribeStatusLive()`로 worker의
`status.sync`, `status.update`, `status.session-history-update`, `status.hook-event`,
`status.rate-limits-update` event를 기존 client message shape로 변환해 fan-out한다.
`/api/status/hook`, `status:ack-notification`, `status:tab-dismissed`,
timeline의 last-user-message notify, tab register/remove, Web Push foreground visibility도
`status.live-*` command로 worker에 전달한다. 이 모드에서는 worker가 polling, JSONL watcher,
ack/dismiss mutation, session history write, Web Push send, rate-limit watcher를 소유한다.
`off`와 `shadow`에서는 기존 main-process `StatusManager`가 그대로 production owner다.
Phase 6 code fallback 이후 `CODEXWINMUX_RUNTIME_V2=1`이고
`CODEXWINMUX_RUNTIME_STATUS_V2_MODE`가 unset이면 status mode는 `default`로 해석된다.
명시적으로 `CODEXWINMUX_RUNTIME_STATUS_V2_MODE=off`를 설정하면 기존 main-process
`StatusManager`로 rollback된다. 잘못된 명시 값도 `off`로 fail closed한다.

Storage import는 legacy `layout.json`의 `cliState`, `agentSessionId`,
`agentJsonlPath`, `agentSummary`, `lastUserMessage`, `lastCommand`, `dismissedAt` 같은
tab status metadata를 SQLite `tabs`/`tab_status`/`agent_sessions` projection으로 복사한다.
이 import와 side-effect/client-event shadow는 status live ownership 전환과 별개다.
Status event persistence와 SQLite `tab_status` write-through는 아직 후속 작업이다.
runtime v2는 startup 때 terminal tab lifecycle도 reconciliation한다. stale `pending_terminal` tab과 tmux session을
잃은 `ready` terminal tab은 `failed`로 전환되지만, agent work status 전환 의미는 기존
production 경로를 유지한다. legacy layout에 남은 runtime v2 tab이 `session-not-found`
상태가 되면 restart action은 같은 tab id/session name을 Supervisor에 다시 등록해
`pending_terminal`에서 `ready`로 복구할 수 있다. 이 복구 overlay가 활성화된 동안에는
desktop/mobile 공통으로 floating `ConnectionStatus` reconnect button을 숨겨, 화면에는
보이지만 overlay에 막혀 클릭되지 않는 중복 reconnect UI를 만들지 않는다.

## process state

`agentProcess`는 tmux pane 아래에 agent process가 있는지를 나타낸다.

| 값 | 의미 |
|---|---|
| `null` | 아직 확인하지 않음 |
| `true` | Codex process를 찾음 |
| `false` | Codex process가 없음 |

client는 `check` view에서 `agentProcess=true`를 받으면 timeline으로 전환한다. 사용자가
명시적으로 연 `session-list` view는 active Codex process가 있어도 유지한다. 이 목록에는
로컬 `~/.codex/sessions/**/*.jsonl`에서 인덱싱한 resume 대상만 표시된다. `codex`
panel의 session list API는 service restart 뒤 layout에 남은 tmux session이 사라져도 전역
session index를 반환하며, session list 화면도 process 감지 완료를 기다리지 않고 목록 fetch
상태만 따른다.

Codex 감지는 pane PID 아래 child process를 따라가며 `codex`를 찾고, session id 또는
process start time으로 `~/.codex/sessions/YYYY/MM/DD/*.jsonl`을 연결한다. Linux에서는
`src/lib/session-detection.ts`의 `/proc` 기반 helper로 child PID, command, cwd, start time을
읽어 상태 polling 중 `pgrep`/`ps` subprocess 생성을 피한다. Codex CLI가
프로세스 시작 후 늦게 JSONL을 남기는 경우를 고려해 process start time 매칭은 120초
허용치를 둔다. cwd fallback은 live Codex process가 확인된 `detectActiveCodexSession`
경로에서만 마지막 보정으로 사용한다. 일반 JSONL 검색은 cwd만으로 가장 최근 JSONL을
선택하지 않는다. 같은 workspace에서 여러 Codex tab이 동시에 실행될 수 있으므로, tab에
저장된 `agentSessionId`/`agentJsonlPath`를 우선 보존하고 rollout 파일명은 plain Codex
UUID로 정규화한다.

Timeline attach는 예외적으로 active process가 없거나 active JSONL이 interrupted 상태일 때
같은 cwd의 더 최신 JSONL을 선택할 수 있다. 이 경로는 API/외부 Codex 세션처럼 tmux child
process로 직접 잡히지 않는 세션을 CODEX 패널에 동기화하기 위한 보정이며, 전환 시
`agentSessionId`와 `agentJsonlPath`를 layout에 다시 저장하고 client는 timeline WebSocket을
새로 연다.

## resume 실패 분류

session list에서 JSONL path가 없는 Codex session을 다시 열면 timeline WebSocket은
`codex resume <sessionId>`를 terminal pane에 전송한다. 이때 실패는
`timeline:resume-error` payload의 `reason`으로 분류한다.

| reason | 의미 |
|---|---|
| `invalid-session-id` | provider가 session id 형식을 거부함 |
| `command-build-failed` | provider가 resume command를 만들 수 없음 |
| `send-failed` | tmux/terminal pane에 resume command를 전송하지 못함 |
| `unknown` | process safety 확인이나 후속 처리 중 분류되지 않은 오류 |

terminal pane에서 shell이 아닌 process가 실행 중이면 실패가 아니라 기존
`timeline:resume-blocked`/`process-running`으로 유지한다. Resume command 전송 뒤 JSONL
파일이 아직 없으면 Codex CLI가 뒤늦게 파일을 만들 수 있으므로 error로 처리하지 않고
`timeline:resume-started`와 빈 init 상태를 유지한다. UI toast는 reason별 번역 문구만 표시하고,
원본 error message, cwd, command, session name, JSONL path, terminal output은 표시하지 않는다.

## work state

| 상태 | 의미 |
|---|---|
| `inactive` | agent process가 없거나 초기 상태 |
| `idle` | 다음 입력 대기 |
| `busy` | Codex가 작업 중 |
| `ready-for-review` | 한 turn이 끝났고 아직 사용자가 확인하지 않음 |
| `needs-input` | permission, resume directory, 기타 Codex 입력 선택 대기 |
| `unknown` | 서버 재시작 전 `busy`였고 복구 중 |
| `cancelled` | tab close 중인 client-local 상태 |

`ready-for-review`는 사용자가 tab을 focus하거나 dismiss할 때만 `idle`로 돌아간다.

## notification

- foreground window는 `use-toast-notification`이 작업 완료 toast를 표시한다.
- Electron/native notification은 `use-native-notification`이 처리한다.
- background Web Push는 `StatusManager`가 `status-web-push-adapter`를 통해 전송한다.
- `soundOnCompleteEnabled=false`이면 작업 완료 toast sound를 재생하지 않고, native/background system notification도 silent로 요청한다.
- 현재 Codex CLI permission/input prompt는 hook event로 직접 전달되지 않는 경우가 있으므로, codexmux는 live Codex pane capture에서 prompt 선택지를 감지해 내부 `notification(permission_prompt)` 이벤트처럼 `needs-input`으로 전환한다. 여기에는 permission approval, resume working directory 선택, 기타 option list prompt가 포함된다. 일반 작업 완료 notification은 review flow를 따른다.
- 전역 approval queue는 pane capture에서 파싱한 option list와 sanitized metadata를 표시한다.
  metadata는 `command`, `file`, `permission`, `resume-directory`, `conversation`, `unknown`
  prompt type, `allow|deny|trust|directory|input|unknown` approval kind,
  `low|medium|high|unknown` risk enum, basename-only file hint, sanitized command preview만
  포함한다. Latest prompt block 범위에서만 metadata를 계산해 scrollback contamination을
  피한다. API option label은 선택 index 호환을 위해 CLI 선택지 텍스트를 유지하지만,
  full command, cwd, session name, JSONL path, prompt body, assistant text, terminal output은
  status payload나 Web Push payload에 넣지 않는다. Pane capture 실패 log도 terminal 내용이
  아니라 error class만 남긴다.
- pane recovery가 permission/input prompt를 파싱하면 `StatusManager`는 sanitized
  `approvalPromptMetadata`를 `needs-input` status entry에 저장한다. Web Push lock-screen
  copy는 이 metadata의 command/file/permission type, risk, concise detail을 사용하며,
  metadata가 없으면 기존 last user message 또는 tab name fallback을 유지한다.
- approval queue는 선택지가 표시된 시점, fallback, 선택 전송 성공/실패를
  `~/.codexmux/approval-audit.jsonl`에 append한다. 이 audit record는 workspace id, tab id,
  prompt/risk/approval enum, option count, selected option index, fallback reason만 저장하고
  option label, command preview, cwd, session name, JSONL path, prompt body, terminal output은
  저장하지 않는다.
- Codex CLI가 `Conversation interrupted - tell the model what to do differently` 입력 프롬프트에 멈췄지만 JSONL에 `turn_aborted` 또는 `[Request interrupted by user` marker를 남기지 않는 경우, `StatusManager`는 live pane capture를 보정 신호로 사용해 stale `busy`를 `idle`로 되돌리고 `currentAction`을 비운다.
- persisted `cliState`가 `idle`이어도 live pane에 Codex 입력 선택지가 보이면 `StatusManager`는 `needs-input`으로 복구한다. 이 경로는 server restart 후 Codex resume directory prompt가 남아 있는 tab을 Android/Electron/mobile notification surface에 다시 노출하기 위한 보정이다.
- `corepack pnpm smoke:permission`은 임시 서버와 tmux prompt를 사용해 `notification` hook의 `needs-input` 전환, permission option parsing, stdin 선택 전달, `status:ack-notification` 후 `busy` 복귀를 검증한다.

## event model

```ts
export type TEventName =
  | 'session-start'
  | 'prompt-submit'
  | 'notification'
  | 'stop'
  | 'interrupt';
```

일반 hook 상태 전이는 다음처럼 단순하게 유지한다.

```text
session-start -> idle
prompt-submit -> busy
notification  -> needs-input
stop          -> ready-for-review
interrupt     -> idle
```

Hook event와 Codex JSONL/process metadata의 다음 상태 판단은
`src/lib/status-state-machine.ts`의 순수 reducer가 담당한다. session id 추출,
completion dedupe key, input 요청성 notification 판정, JSONL metadata merge는
`status-session-mapping`, `status-notification-policy`, `status-metadata`의 순수
helper가 담당한다. `StatusManager`는 tmux/process/JSONL 신호 수집, 상태 적용,
history 저장, notification 같은 부수효과를 처리한다.

현재 Codex hook bridge는 `SessionStart`, `UserPromptSubmit`, `Stop`을
생성된 `~/.codexmux/hooks.json`에 등록한다. Codex tab 실행 명령은
`-c 'hooks={path="~/.codexmux/hooks.json"}'`를 포함해 앱 소유 hook 설정을 명시적으로
로드한다. Codex CLI `0.128.0` 기준 permission request 전용 hook은 제공되지 않으므로,
permission/input prompt는 pane capture 기반 `recoverPendingInputFromPane` 경로에서 합성
`notification(permission_prompt)`로 복구한다. CLI 자체 prompt와 사용자의 선택 경로는
Codex가 계속 소유한다.

Codex tab에서는 legacy `stop` hook을 바로 `ready-for-review`로 전환하지 않는다. `stop`은
JSONL 재확인을 예약하는 신호이며, 실제 완료 판정은 같은 turn의
`event_msg.payload.type="task_complete"` 기록이 확인될 때만 한다. `StopFailure`는
`stop-failure`로 전달되며 상태 전이를 만들지 않는다.

`task_complete.turn_id`는 완료 correlation key의 일부로 사용한다. Web Push와 session
history 저장은 `sessionId:turnId` 기준으로 dedupe되어, 같은 Codex turn이 JSONL watch,
poll, stop-hook 재확인 경로에서 여러 번 관측되어도 완료 알림과 history가 중복 생성되지
않는다. turn id를 확인할 수 없는 legacy 경로는 기존 상태 전이 동작을 유지한다.

생성된 hook/statusline bridge file도 event를 POST할 수 있지만 Codex 상태의 주 경로는 process detection, JSONL metadata, terminal state, polling이다. Permission prompt나 resume directory prompt처럼 JSONL completion 전에 즉시 사용자 입력이 필요한 경로는 pane capture recovery가 hook 공백을 보완하는 신호다.

`CODEXMUX_BRIDGE_TRACE_URL`과 `CODEXMUX_BRIDGE_TRACE_TOKEN`이 설정되면
`StatusManager.broadcastUpdate`는 status update를 summary-only payload로
codex-ai-bridge external trace ingress에 best-effort POST한다. payload에는 workspace
directory, tab id/name, Codex session id, `cliState`, `currentAction`,
`lastAssistantMessage`, `lastUserMessage`만 포함한다. Discord token, raw transcript,
전체 stdout은 codexmux가 소유하지 않고 전송하지 않는다. 같은 tab에서 동일 state/action
조합은 forwarder가 dedupe한다.

## JSONL metadata

Codex parser는 `session_meta`, `turn_context`, `event_msg`, `response_item` 계열 record를 읽어 message, tool call, tool result, reasoning summary, token usage를 추출한다. StatusManager는 active tab의 JSONL을 tail하면서 `lastAssistantMessage`, `currentAction`, `agentSessionId`, `jsonlPath`를 갱신한다.

`response_item`의 synthetic user context, 예를 들어 `# AGENTS.md instructions for ...`나
`<environment_context>`는 visible timeline message로 표시하지 않는다.

Timeline entry id는 JSONL record offset과 record identity 기반으로 생성한다. 재연결,
tail 재읽기, load-more 과정에서 같은 record가 다시 파싱되어도 entry id가 안정적으로
유지되고, client merge/dedupe 로직은 id 재생성이나 중복 append에 의존하지 않는다.
`use-timeline`은 WebSocket 상태와 React state 연결을 담당하고, init/append/load-more
병합 정책은 `timeline-entry-merge`에서 처리한다.
같은 tmux session에서 `agentSessionId`만 바뀐 경우도 stale JSONL에 머무르지 않도록
timeline WebSocket을 다시 연결한다.

Codex CLI는 정상 동작 중 같은 visible assistant text를 `event_msg.payload.type="agent_message"`와
paired `response_item.payload.type="message"` record로 몇 ms 간격에 남길 수 있다.
`codex-session-parser`는 같은 role/text가 `MESSAGE_PAIR_DEDUPE_WINDOW_MS` 안에 들어오면
하나의 entry로 취급한다. file watch가 두 record를 서로 다른 append batch로 보낸 경우에는
`timeline-entry-dedupe`와 `timeline-entry-merge`가 같은 near-duplicate 규칙으로 한 번만
표시한다. 이 때문에 assistant message identity를 timestamp 단독으로 잡지 않는다.

Codex `spawn_agent` 또는 `Agent` function call이 matching `function_call_output`과 함께
읽히면 parser는 일반 tool-call row 대신 `agent-group` entry를 만든다. 이 entry는 agent
type, spawn prompt/description, sub-agent output summary를 보존하며 기존 timeline
`AgentGroupItem`으로 접힌 관계 카드에 표시된다.

`agent_message`는 commentary/final text 모두에 쓰일 수 있어 완료 신호로 보지 않는다.
예를 들어 "이제 파일을 편집합니다" 같은 중간 commentary 뒤에 바로 tool call이 이어질
수 있다. 따라서 작업 완료 알림과 `ready-for-review` 전환은 현재 turn의
`task_complete`가 가장 최근 turn activity 뒤에 기록된 경우에만 발생한다.

## client field

| field | 의미 |
|---|---|
| `terminalConnected` | terminal WebSocket 연결 여부 |
| `agentProcess` | process 감지 결과 |
| `agentInstalled` | Codex 설치/초기화 gate |
| `cliState` | badge와 notification 상태 |
| `sessionView` | session-list, check, timeline 중 현재 view |
| `agentSessionId` | Codex session id |
| `agentSummary` | session 요약 |
| `lastEvent`, `eventSeq` | event 순서 보장 |
| `currentAction` | 현재 tool/action 요약 |

## 관련 파일

| 파일 | 역할 |
|---|---|
| `src/lib/status-manager.ts` | 서버 상태, polling, JSONL watch, Web Push |
| `src/lib/status-state-machine.ts` | hook/process/JSONL 상태 전이 reducer |
| `src/lib/status-session-mapping.ts` | Codex session id 정규화와 completion key 생성 |
| `src/lib/status-notification-policy.ts` | notification hook 처리/전송 정책 |
| `src/lib/status-side-effect-policy.ts` | status transition side-effect intent 산출 |
| `src/lib/status-client-event-policy.ts` | ack/dismiss client event intent 산출 |
| `src/lib/status-session-history-adapter.ts` | runtime v2/legacy session history write fallback |
| `src/lib/status-web-push-adapter.ts` | runtime v2/legacy Web Push payload와 send fallback |
| `src/lib/status-metadata.ts` | JSONL metadata merge helper |
| `src/lib/runtime/status/worker-service.ts` | runtime v2 Status Worker 정책 평가 command service |
| `src/hooks/use-agent-status.ts` | status WebSocket hook |
| `src/hooks/use-tab-store.ts` | client tab state |
| `src/lib/providers/codex/index.ts` | Codex provider adapter |
| `src/lib/codex-session-detection.ts` | Codex process/session detection |
| `src/lib/codex-session-parser.ts` | Codex JSONL parser |
| `src/lib/timeline-entry-id.ts` | JSONL 기반 stable timeline entry id 생성 |
| `src/lib/timeline-entry-dedupe.ts` | timeline entry fingerprint와 중복 제거 |
| `src/lib/timeline-entry-merge.ts` | timeline init/append/load-more 병합 정책 |
| `src/lib/timeline-server-state.ts` | timeline WebSocket shared singleton state |
| `src/lib/terminal-recovery.ts` | session 복구 overlay와 floating reconnect 표시 조건 |
| `src/pages/api/check-agent.ts` | process check API |
