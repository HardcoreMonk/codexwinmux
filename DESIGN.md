# codexwinmux 설계 문서

codexwinmux는 Windows-first Codex workspace/session manager다. 범용 터미널
대시보드가 아니라 여러 Codex 세션을 Windows 서비스, Electron shell, Android WebView에서
실행, 재개, 모니터링, 검토하기 위한 내부 폐쇄망 전용 제품이다. 현재 기본 topology는
`codexwinmux-core`와 `codexwinmux-backend` split service이며, Core가 runtime v2
source of truth를 소유하고 Backend는 HTTP/API/WebSocket adapter로 동작한다.

## 구현 상태

- 서비스 이름과 실행 파일은 `codexwinmux`, 짧은 별칭은 `cwmux`다.
- 데이터 디렉터리는 `~/.codexwinmux`, Windows service account는 `codexwinmux-svc`다.
- Android app ID는 `com.hardcoremonk.codexwinmux`이며 visible app name은 `codexwinmux`다.
- tmux socket `codexmux`, CLI header `x-cmux-token`, 일부 `Codexmux*` native bridge 이름은 compatibility surface로만 유지한다.
- 현재 canonical 진행 상황은 `docs/PROJECT-STATUS.md`를 우선한다.
- provider registry에는 `codex` panel type만 등록한다.
- Codex 실행은 `codex`, 재개는 `codex resume <sessionId>`를 사용한다.
- process detection은 tmux pane 아래의 `codex` process를 찾고 session id, process start time, live process cwd fallback 순서로 JSONL path를 연결한다.
- timeline, history, stats, daily report는 `~/.codex/sessions/**/*.jsonl`을 읽어 구성한다.
- `~/.codex`는 Codex CLI 소유 데이터이며 codexwinmux는 읽기 전용으로만 접근한다.
- terminal과 Codex 입력 포커스의 `Ctrl+D`는 앱 단축키가 아니라 EOF/EOT로 전달한다.
- 모바일 foreground 복귀 시 terminal/status/timeline/sync WebSocket은 stale `OPEN` 상태를 신뢰하지 않고 재연결할 수 있다.
- 성능 최적화는 `/api/debug/perf` snapshot으로 계측한 뒤 좁게 적용한다. timeline append/render, diff, stats는 source of truth를 바꾸지 않는 batch/memo/short cache를 우선한다.

## 주요 구성

| 영역 | 파일 | 역할 |
|---|---|---|
| provider | `src/lib/providers/codex/` | Codex adapter와 provider contract 구현 |
| command | `src/lib/codex-command.ts` | Codex launch/resume command 생성 |
| detection | `src/lib/codex-session-detection.ts` | process tree와 JSONL session 연결 |
| parser | `src/lib/codex-session-parser.ts` | Codex JSONL을 timeline entry로 변환 |
| stats | `src/lib/stats/` | token, cost, session, daily report 집계 |
| status | `src/lib/status-manager.ts` | tab state, polling, Web Push, WebSocket broadcast |
| performance | `src/lib/perf-metrics.ts` | runtime metric, duration/counter, authenticated perf snapshot |
| docs | `docs/ARCHITECTURE-LOGIC.md` | 서버와 서비스 로직의 최신 구현 기준 |

## 데이터 모델

새 layout과 status payload는 다음 neutral field를 사용한다.

- `panelType: "codex"`
- `agentSessionId`
- `agentJsonlPath`
- `agentSummary`

Workspace 이름과 group은 `workspaces.json`이 source of truth이며, rename/group 변경은 sync event로 모든 client에 전파한다.

오래된 provider alias는 runtime에서 허용하지 않는다. 새 기능도 provider-neutral boundary 또는 Codex provider 내부에 추가한다.

## 리스크

- Codex JSONL 형식은 CLI 버전에 따라 바뀔 수 있다. parser는 permissive하게 두고 fixture를 계속 보강한다.
- Codex CLI가 process 시작 후 JSONL을 늦게 쓰는 경우가 있어 process start time 매칭은 여유를 두고, cwd fallback은 live Codex process가 확인된 경우에만 쓴다.
- `~/.codex`에는 auth와 local history가 들어갈 수 있으므로 원본 config/auth 파일을 브라우저에 노출하지 않는다.
- process detection은 플랫폼 의존성이 크다. Linux `/proc`, `pgrep`, `ps` fallback은 helper에 격리한다.
- foreground reconnect 중 timeline init/append가 겹칠 수 있으므로 stable id와 near-duplicate 제거가 UI 중복 방지의 핵심이다.
- timeline virtualization과 adaptive status polling은 scroll anchoring, notification, unknown 복구 지연 리스크가 있어 perf snapshot 수치가 쌓인 뒤 단계적으로 검증한다.
- Codex app-server protocol은 안정화 전까지 post-MVP 후보로 둔다.

## post-MVP 방향

- app-server adapter가 안정화되면 approval/status event만 단계적으로 도입한다.
- 전체 세션의 pending approval을 모아 보는 approval queue를 만든다.
- fork/sub-agent 관계를 UI에 표시한다.
- Codex CLI 버전별 JSONL fixture와 smoke test를 확장한다.
