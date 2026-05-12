# `~/.codexwinmux/` 데이터 디렉터리

codexwinmux의 영속 상태는 `~/.codexwinmux/`에 저장된다. Windows-only host 전환에서는 같은 앱 상태가 `%USERPROFILE%\.codexwinmux\`에 남고, 서버 로그는 Windows 운영 경로인 `%LOCALAPPDATA%\codexwinmux\logs\`에 기록된다. Codex CLI의 원본 세션 기록은 `~/.codex/sessions/` 또는 Windows의 `%USERPROFILE%\.codex\sessions\`에 있으며 codexwinmux는 이 파일을 읽기 전용으로만 사용한다.

## 구조

```text
~/.codexwinmux/
├── config.json
├── workspaces.json
├── workspaces/{wsId}/layout.json
├── workspaces/{wsId}/message-history.json
├── hooks.json
├── status-hook.sh
├── statusline.sh
├── rate-limits.json
├── session-history.json
├── session-index.json
├── approval-audit.jsonl
├── lifecycle-actions.jsonl
├── quick-prompts.json
├── sidebar-items.json
├── keybindings.json
├── vapid-keys.json
├── push-subscriptions.json
├── cli-token
├── port
├── cmux.lock
├── logs/                         # non-Windows compatibility
├── uploads/
├── runtime-v2/
│   └── state.db
├── backups/
│   └── runtime-v2-storage-{timestamp}/
└── stats/
```

`hooks.json`, `status-hook.sh`, `statusline.sh`는 local hook/statusline bridge가 서버로 상태를 POST할 때 쓰는 생성 파일이다. Codex tab 실행 명령은 `-c 'hooks={path="~/.codexwinmux/hooks.json"}'`를 포함해 이 앱 소유 hook 설정을 명시적으로 로드한다. Codex CLI `0.128.0` 기준 permission request 전용 hook은 없으므로, live permission/input prompt는 StatusManager의 pane capture recovery가 `notification(permission_prompt)`처럼 복구해 notification panel의 `needs-input` queue와 연결한다. Resume directory 선택과 interrupted prompt 보정, approval queue prompt type/risk metadata는 pane snapshot에서 계산한다. 사용자가 approval queue에서 선택하거나 선택지 조회/전송 fallback이 발생하면 `approval-audit.jsonl`에 enum, 선택 index, option count, fallback reason만 durable append하고 command, cwd, session name, JSONL path, prompt body, terminal output은 저장하지 않는다.

`/experimental/runtime`의 Lifecycle Control actions는 `lifecycle-actions.jsonl`에 append-only audit event를 남긴다. 저장 필드는 action id, status, timestamp, duration, exit code, sanitized failure label뿐이며 stdout/stderr, env, cwd, token, session name, JSONL path, prompt body, terminal output은 저장하지 않는다.

Electron remote/local server mode는 같은 `~/.codexwinmux/config.json`을 사용한다. Android 런처의 최근 서버와 마지막 서버 URL은 Android WebView `localStorage`에 저장되며 `~/.codexwinmux/`에는 기록되지 않는다. Android 앱 정보와 앱 재시작은 native package metadata와 현재 Activity를 사용하므로 codexwinmux 데이터 디렉터리에 별도 파일을 만들지 않는다.

이전 빌드에서 만든 `remote/codex/` 아래 파일은 현재 앱에서 읽지 않는다. 필요 없으면 수동으로 삭제할 수 있으며, 로컬 `~/.codex/sessions/` 원본과 codexwinmux workspace 상태에는 영향을 주지 않는다.

`session-index.json`은 로컬 `~/.codex/sessions`의 session list metadata cache다. Codex JSONL 원본을 대체하지 않으며, 삭제해도 서버가 다음 refresh에서 다시 만든다.

Linux `systemd --user` 등록 파일은 legacy 운영 경로인 `~/.config/systemd/user/codexmux.service`에 둔다. 서비스 파일은 실행 방식과 `HOST`/`PORT`를 고정하는 운영 설정이며, codexwinmux 앱 상태인 `~/.codexwinmux/`에는 포함되지 않는다.

## 주요 파일

| 파일 | 내용 |
|---|---|
| `config.json` | password hash, session secret, locale, theme, Codex option, editor/network/notification 설정 |
| `workspaces.json` | workspace 목록, active workspace, sidebar 상태 |
| `workspaces/{wsId}/layout.json` | pane/tab tree와 tab metadata |
| `workspaces/{wsId}/message-history.json` | workspace별 web input history |
| `hooks.json` | Codex `SessionStart`, `UserPromptSubmit`, `Stop` hook과 statusline bridge 설정 |
| `status-hook.sh`, `statusline.sh` | Codex hook/statusline bridge script |
| `cli-token` | CLI와 hook bridge가 `x-cmux-token`으로 보내는 token |
| `port` | 현재 server port |
| `cmux.lock` | 단일 인스턴스 guard |
| `rate-limits.json` | optional statusline payload 최신값 |
| `session-history.json` | 완료된 Codex session summary |
| `session-index.json` | 로컬 Codex session list metadata cache |
| `approval-audit.jsonl` | approval queue 선택/fallback audit event. 원문 command/path/session/prompt는 저장하지 않음 |
| `lifecycle-actions.jsonl` | Lifecycle Control action 실행 audit event. stdout/stderr/env/cwd/session/prompt는 저장하지 않음 |
| `sidebar-items.json` | sidebar 고정 항목과 표시 상태 |
| `quick-prompts.json` | 사용자 quick prompt와 built-in prompt 표시 상태 |
| `keybindings.json` | 앱 keyboard shortcut override |
| `vapid-keys.json` | Web Push VAPID key pair |
| `push-subscriptions.json` | Web Push subscription |
| `uploads/` | 임시 첨부 파일 |
| `logs/` | 비-Windows 호환 경로의 서버 로그. Windows host에서는 `%LOCALAPPDATA%\codexwinmux\logs\`를 사용 |
| `runtime-v2/state.db` | Experimental runtime v2 SQLite app state for workspace, pane, tab, message history, status projection, and durable event logs |
| `backups/runtime-v2-storage-{timestamp}/` | `runtime-v2:storage-backup`이 만든 storage cutover용 JSON/SQLite snapshot |
| `stats/cache.json` | Codex JSONL에서 계산한 usage cache. 런타임 build는 in-flight promise로 중복 계산을 피함 |
| `stats/daily-reports/` | `codex exec`로 생성한 일별 report |

비밀값이 들어갈 수 있는 파일은 `0600` 권한으로 쓰며, 저장은 임시 파일을 쓴 뒤 rename하는 방식으로 처리한다.

## Runtime v2 SQLite 초기화

`CODEXMUX_RUNTIME_V2=1`은 실험용 runtime v2를 켜고, 기본 DB 경로로
`~/.codexwinmux/runtime-v2/state.db`를 사용한다. `CODEXMUX_RUNTIME_DB`가 있으면 smoke나
개발 검증용으로 다른 DB 파일을 지정할 수 있다.

Runtime schema v2는 `tabs.runtime_version`과 `workspaces.active_pane_id`를 포함한다.
schema v3는 `workspace_directories`, `app_state`, `message_history`를 포함한다. 이 필드는
`runtime-v2:storage-import`가 legacy JSON layout을 SQLite로 복사할 때 legacy `pt-`
terminal tab과 runtime v2 `rtv2-` terminal tab을 구분하고, active pane, active
workspace, sidebar 상태, workspace directory list, message history를 복원하기 위해 필요하다. Runtime v2
terminal attach/cleanup은 `runtime_version=2`인 terminal tab만 대상으로 삼는다.

`CODEXMUX_RUNTIME_STORAGE_V2_MODE=default`에서는 workspace/layout/message-history read가 SQLite
projection을 먼저 사용한다. projection이 없거나 DB open/read가 실패하면 legacy
`workspaces.json`, `workspaces/{wsId}/layout.json`,
`workspaces/{wsId}/message-history.json` read로 fallback한다. Message history write는 SQLite를
우선 갱신하고 rollback용 JSON 파일도 함께 쓴다. Config, keybindings, sidebar items는 기존
JSON 파일이 owner다.

`CODEXMUX_RUNTIME_V2_RESET=1`을 함께 설정하면 runtime 시작 전에 기존
`runtime-v2/state.db`, `runtime-v2/state.db-wal`, `runtime-v2/state.db-shm` 파일을 각각
timestamp가 붙은 `.bak` 파일로 이동한다. `state.db` 없이 WAL/SHM sidecar만 남은 경우도
각 sidecar를 독립적으로 백업하고 원래 경로에 stale sidecar를 남기지 않는다.

runtime v2 tab 삭제는 `state.db`의 `tabs` row 삭제 transaction이 source of truth다.
Storage Worker는 삭제된 terminal tab의 session cleanup intent를 반환하고, Supervisor가
해당 runtime v2 tmux session을 kill한다. 삭제된 tab의 `tab_status` row는 SQLite foreign
key cascade로 함께 제거된다.

Storage cutover 전 백업은 `corepack pnpm runtime-v2:storage-backup`으로 만든다. 기본 출력은
`~/.codexwinmux/backups/runtime-v2-storage-{timestamp}/`이며 `workspaces.json`,
`workspaces/**.json`, `runtime-v2/state.db`, `runtime-v2/state.db-wal`,
`runtime-v2/state.db-shm`를 복사한다. `CODEXMUX_RUNTIME_V2_STORAGE_BACKUP_DATA_DIR`,
`CODEXMUX_RUNTIME_V2_STORAGE_BACKUP_OUTPUT_DIR`,
`CODEXMUX_RUNTIME_V2_STORAGE_BACKUP_TIMESTAMP`로 data/output/timestamp를 override할 수 있다.
이 명령은 원본 파일을 삭제하거나 migration을 수행하지 않는다.

Runtime v2 Timeline Worker foundation은 새 영속 파일을 만들지 않는다. v2 timeline read
API는 기존 `session-index.json`과 `~/.codex/sessions/**/*.jsonl`을 읽기 전용으로
사용하며, message count cache는 worker process memory에만 둔다.

## `config.json` 주요 설정

| 필드 | 내용 |
|---|---|
| `locale` | UI 언어. 기본값은 `ko`이고 지원값은 `ko`, `en`이다. |
| `appTheme`, `terminalTheme`, `customCSS` | 앱/터미널 표시 설정 |
| `networkAccess` | 서버 listen 범위 설정 |
| `codexModel`, `codexSandbox`, `codexApprovalPolicy`, `codexSearchEnabled`, `codexShowTerminal` | Codex 실행 option |
| `notificationsEnabled` | 작업 완료 시스템 알림 사용 여부 |
| `soundOnCompleteEnabled` | 작업 완료 toast/native/Web Push 알림 사운드 사용 여부 |
| `toastOnCompleteEnabled`, `toastDuration`, `toastPositionDesktop`, `toastPositionMobile` | foreground toast 동작 |
| `editorUrl`, `editorPreset` | 외부 editor deep link 설정 |

## `keybindings.json` 범위

`keybindings.json`은 pane 분할, tab 전환, mode 전환 같은 앱 단축키 override만 저장한다. 터미널 제어 입력은 저장 파일의 앱 단축키보다 우선한다. 예를 들어 `Ctrl+D`는 터미널과 Codex 입력창에 포커스가 있을 때 Codex CLI/shell EOF(`0x04`)로 전달되며, Linux/Windows 오른쪽 pane 분할 기본값은 `Ctrl+Alt+D`다.

## 삭제 기준

| 초기화 대상 | 삭제할 것 |
|---|---|
| 비밀번호만 초기화 | `config.json`에서 `authPassword`, `authSecret` 필드만 제거 |
| 로그인과 onboarding, 앱 설정 | `config.json` |
| 모든 workspace | `workspaces.json`, `workspaces/` |
| 특정 workspace layout | `workspaces/{wsId}/layout.json` |
| quick prompt/sidebar/keybinding | 해당 JSON 파일 |
| 사용량 통계와 report | `stats/` |
| 이전 빌드의 원격 Codex 복사본 | `remote/codex/` |
| push subscription | `push-subscriptions.json` |
| stale lock | process가 없음을 확인한 뒤 `cmux.lock` |
| 전체 앱 상태 | `~/.codexwinmux/` |

비밀번호는 평문이 아니라 scrypt 해시로 저장된다. 잊어버린 비밀번호는 복구하지 않고 `authPassword`와 `authSecret`을 제거한 뒤 onboarding에서 새로 설정한다. `config.json` 전체를 삭제하면 network/theme/Codex option도 같이 초기화된다.

`~/.codex/`는 Codex CLI의 auth, state, session history를 포함한다. 의도적으로 Codex 상태까지 지우려는 경우가 아니면 삭제하지 않는다. 이전 빌드에서 남은 `remote/codex/` 복사본은 현재 앱에서 읽지 않으며 필요하면 수동으로 삭제한다.
