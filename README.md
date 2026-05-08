# codexmux

**언어 선택 / Language:** [한국어 기본](#ko) | [English](#en)

> 기본 표시 언어는 한국어입니다. English is available below.

<a id="ko"></a>

## 한국어

Codex 작업을 tmux 기반 웹 세션으로 관리하는 self-hosted session manager입니다.

한 화면에서 여러 Codex 세션을 확인하고, 모바일에서도 같은 작업 공간에 다시 접속할 수 있습니다.

**문서 언어 / Document languages: 한국어, English**

## 현재 저장소

- Repository: <https://github.com/HardcoreMonk/codexwinmux>
- Upstream reference: <https://github.com/subicura/purplemux>
- Runtime: Next.js Pages Router + custom Node server + tmux
- Package manager: pnpm
- Current version: 0.4.8
- Supported languages: 한국어, English
- Default language: 한국어
- Target: Codex-focused web session manager

## 빠른 시작

npm 배포본을 사용할 때:

```bash
npx codexmux
```

브라우저에서 접속합니다.

```text
http://localhost:8121
```

> Node.js 20 이상과 tmux가 필요합니다. 서버 실행은 macOS와 Linux를 지원합니다.

## 서버 실행 옵션

기본 포트는 `8121`입니다.

```bash
codexmux
```

포트와 접속 허용 범위를 고정하려면 `PORT`와 `HOST`를 지정합니다.

```bash
HOST=localhost,tailscale PORT=8121 codexmux
```

`HOST`는 콤마로 여러 값을 받을 수 있습니다.

| 값 | 의미 |
|---|---|
| `localhost` | 로컬 접속만 허용 |
| `tailscale` | Tailscale 대역만 허용 |
| `lan` | 사설 LAN 대역 허용 |
| `all` | 모든 네트워크 허용 |
| CIDR | 예: `192.168.0.0/16`, `100.64.0.0/10` |

자주 쓰는 실행값은 `~/.zshrc`에 함수로 고정할 수 있습니다.

```zsh
codexmux() {
  HOST=localhost,tailscale,192.168.0.0/16 PORT=8121 command codexmux "$@"
}
```

Linux에서 상시 실행하려면 system-wide service보다 user service를 권장합니다. codexmux는 `~/.codexmux/`와 사용자 tmux socket을 사용하므로 `systemd --user`로 실행해야 권한과 데이터 경로가 자연스럽게 유지됩니다.

현재 워크스테이션 등록값:

```text
~/.config/systemd/user/codexmux.service
HOST=localhost,tailscale,192.168.0.0/16
PORT=8121
```

관리 명령:

```bash
systemctl --user status codexmux.service
systemctl --user restart codexmux.service
systemctl --user stop codexmux.service
journalctl --user -u codexmux.service -f
```

로그인하지 않은 상태에서도 user service를 자동 시작하려면 linger가 필요합니다.

```bash
loginctl enable-linger "$USER"
```

세부 등록 절차는 [docs/SYSTEMD.md](docs/SYSTEMD.md)를 참고하세요.

`systemd --user` 프로덕션 서비스는 소스 파일을 직접 실행하지 않고 `corepack pnpm build`가 만든 `dist/server.js`와 Next.js standalone 산출물을 실행합니다. 서버, 타임라인 parser, dedupe, 배포 관련 코드를 수정한 뒤에는 `deploy:local`로 빌드, 서비스 재시작, health check를 같이 수행합니다.

```bash
corepack pnpm deploy:local
curl -fsS http://127.0.0.1:8121/api/health
```

소스 체크아웃 상태에서 `codexmux`가 `../dist/server.js`를 찾지 못하면 아직 배포용 빌드가 없는 상태입니다. 개발 중에는 아래 명령을 사용합니다.

```bash
corepack pnpm dev
```

## 소스에서 실행

```bash
git clone https://github.com/HardcoreMonk/codexwinmux.git
cd codexwinmux
corepack enable
corepack pnpm install
corepack pnpm dev
```

프로덕션 모드 확인:

```bash
corepack pnpm build
corepack pnpm start
```

## 주요 기능

- tmux 기반 영속 세션: 브라우저를 닫아도 터미널과 Codex 작업 상태 유지
- 멀티 워크스페이스: 패널 분할, 탭, 작업 디렉터리, 이름/그룹 편집, 사이드바 상태 저장
- Codex 상태 감지: 작업중, 입력 대기, 리뷰 대기, 세션 resume, 지연 생성 JSONL, live prompt 복구 상태 표시
- Codex CLI 호환 입력: 터미널과 Codex 입력창에서 `Ctrl+D`를 EOF로 전달해 프로세스 종료 처리
- 라이브 타임라인: Codex JSONL과 live pane prompt를 읽어 메시지, tool call, permission/input prompt, reasoning summary 표시
- 안정적인 재연결: 타임라인 entry id와 중복 제거를 JSONL record identity 기준으로 처리
- 모바일 UI: PWA, iPad Safari, Android 앱, Web Push, foreground 재접속, 입력 draft 보존, CODEX 확인 중 터미널 preview
- 알림 제어: 작업 완료 toast, 시스템 알림, 완료 사운드 on/off, 전역 approval queue의 prompt type/risk 표시
- Git 워크플로: status, diff, history, fetch, pull, push, 충돌/dirty 상태 전달
- DIFF 안정성: 대량 diff와 untracked 파일은 제한, 생략 안내, 짧은 서버 캐시, 기본 접힘, timeout으로 UI hang 방지
- 사용량 통계: token, cache read/write, 비용 추정, 프로젝트별 분석, 일별 리포트, cold-start 중복 계산 방지
- 성능 관측: 인증된 `/api/debug/perf` snapshot으로 process/event loop/WebSocket/watcher/poll/cache/terminal stdout 지표 확인
- 빠른 프롬프트: 기본 내장 프롬프트는 `Commit`만 제공하며 사용자 프롬프트를 추가할 수 있음
- CLI bridge: `codexmux tab ...` 명령으로 workspace/tab/browser API 제어

## 공식 Remote Control과 차이

공식 Remote Control은 단일 Codex 세션 원격 제어에 가깝습니다. codexmux는 여러 세션을 동시에 운영하고, tmux로 상태를 유지하며, 모바일 알림과 재접속을 함께 쓰는 흐름에 맞춰져 있습니다.

## 모바일과 Tailscale

모바일에서 같은 세션을 쓰려면 서버를 Tailscale 대역에서 접근 가능하게 실행합니다.

```bash
HOST=localhost,tailscale PORT=8121 codexmux
```

Tailscale 앱 설치와 로그인 후 HTTPS로 노출합니다.

```bash
tailscale serve --bg --https=443 http://localhost:8121
```

접속 주소는 Tailscale이 제공하는 MagicDNS 주소입니다.

```text
https://<machine>.<tailnet>.ts.net
```

해제:

```bash
tailscale serve off --https=443
```

기본 포트 `8121`로 실행 중이면 마지막 인자만 바꿉니다.

```bash
tailscale serve --bg --https=443 http://localhost:8121
```

iPad에서는 현재 Safari로 접속한 뒤 홈 화면에 추가하는 방식이 권장됩니다. iPadOS 네이티브 앱은 아직 포함되어 있지 않으며, 필요하면 Capacitor iOS project를 별도로 추가해야 합니다. iOS 시작 화면은 `public/splash/*.png` 정적 이미지이며 `scripts/generate-splash.js`로 `codexmux` branding을 생성합니다. 이미 홈 화면에 추가된 아이콘에서 이전 startup image가 계속 보이면 iOS cache 때문에 홈 화면 앱을 삭제한 뒤 다시 추가합니다.

## 보안

최초 접속 시 비밀번호를 설정합니다. 비밀번호는 평문이 아니라 scrypt 해시로 `~/.codexmux/config.json`에 저장됩니다.

비밀번호만 초기화하려면 `config.json`에서 아래 필드만 제거한 뒤 서버를 다시 시작합니다.

```json
{
  "authPassword": "...",
  "authSecret": "..."
}
```

`config.json` 전체를 삭제하면 비밀번호뿐 아니라 locale, theme, network, Codex option 같은 앱 설정도 함께 초기화됩니다.

외부에서 접속할 때는 HTTPS를 사용하세요.

- Tailscale Serve: WireGuard 터널과 자동 HTTPS 인증서 사용
- Nginx/Caddy: WebSocket 업그레이드 헤더 전달 필요

## 데이터 디렉터리

codexmux 상태는 `~/.codexmux/`에 저장됩니다. Codex CLI 원본 세션은 `~/.codex/sessions/` 아래 JSONL을 읽기 전용으로 참조합니다.

| 경로 | 내용 |
|---|---|
| `config.json` | 인증 해시, session secret, locale/theme/network/Codex 설정 |
| `workspaces.json` | workspace 목록, active workspace, sidebar 상태 |
| `workspaces/{wsId}/layout.json` | pane/tab tree와 tab metadata |
| `quick-prompts.json` | 사용자 quick prompt와 내장 prompt 표시 상태 |
| `keybindings.json` | 앱 단축키 override. 터미널 제어 입력인 `Ctrl+D`는 포커스된 터미널/Codex 입력창에서 EOF로 전달 |
| `vapid-keys.json` | Web Push VAPID key |
| `push-subscriptions.json` | Web Push 구독 정보 |
| `cli-token` | CLI와 hook bridge의 `x-cmux-token` |
| `port` | 현재 실행 중인 server port |
| `session-index.json` | 로컬 Codex session list metadata cache |
| `stats/` | Codex usage cache와 daily report. 런타임 stats build는 in-flight promise로 중복 계산을 피함 |
| `logs/` | 서버 로그 |
| `uploads/` | 임시 첨부 파일 |

이전 버전에서 생성된 `~/.codexmux/remote/codex/` 데이터는 현재 앱에서 읽지 않습니다. 필요 없으면 수동으로 삭제해도 codexmux 로컬 상태와 `~/.codex/sessions/` 원본에는 영향을 주지 않습니다.

자세한 삭제 기준은 [docs/DATA-DIR.md](docs/DATA-DIR.md)를 참고하세요.

## 개발 명령

```bash
corepack pnpm dev
corepack pnpm dev:electron
corepack pnpm dev:electron:attach
corepack pnpm build
corepack pnpm build:electron
corepack pnpm deploy:local
corepack pnpm start
corepack pnpm lint
corepack pnpm tsc --noEmit
corepack pnpm test
corepack pnpm exec playwright install chromium
corepack pnpm smoke:electron:attach
corepack pnpm smoke:electron:runtime-v2
corepack pnpm smoke:permission
corepack pnpm smoke:runtime-v2:phase2
corepack pnpm smoke:android:install
corepack pnpm smoke:android:foreground
corepack pnpm smoke:android:recovery
corepack pnpm smoke:android:runtime-v2
corepack pnpm smoke:android:timeline-foreground
corepack pnpm build:landing
corepack pnpm android:sync
corepack pnpm android:open
corepack pnpm android:run
corepack pnpm android:build
corepack pnpm android:build:debug
corepack pnpm android:build:release
corepack pnpm android:bundle:release
corepack pnpm android:install
corepack pnpm android:keystore
```

로그 레벨:

```bash
LOG_LEVEL=debug corepack pnpm dev
LOG_LEVELS=status=debug,tmux=trace corepack pnpm dev
```

인증된 session cookie 또는 `x-cmux-token`이 있으면 `/api/debug/perf`에서 process memory, event loop delay, WebSocket 연결 수, timeline watcher, status poll, diff/stats cache 지표를 확인할 수 있습니다. prompt, terminal output, cwd, JSONL path 같은 본문/경로 데이터는 반환하지 않습니다.

Playwright는 웹 UI 회귀 확인용 dev dependency로 포함되어 있습니다. 새 개발 환경에서 Chromium이 없으면 `corepack pnpm exec playwright install chromium`을 한 번 실행합니다. 테스트/smoke 계층과 병렬 실행 주의사항은 [docs/TESTING.md](docs/TESTING.md)를 참고하세요.

## Electron 개발

Electron 데스크톱 앱은 `electron/` 아래 main/preload 코드와 Next.js 웹 서버를 함께 사용합니다.

개발 모드는 한 명령으로 실행합니다.

```bash
corepack pnpm dev:electron
```

이미 `corepack pnpm dev`로 웹 서버를 띄운 상태에서 Electron만 붙이고 싶으면 attach 명령을 사용합니다.

```bash
corepack pnpm dev:electron:attach
```

Electron 빌드 확인:

```bash
corepack pnpm build:electron
```

Electron shell attach와 runtime v2 terminal attach smoke:

```bash
corepack pnpm smoke:electron:attach
corepack pnpm smoke:electron:runtime-v2
```

`smoke:electron:runtime-v2`는 temp runtime v2 서버와 Electron shell을 띄우고,
기본 2회 page reload/reconnect 후 `/api/v2/terminal` marker output을 확인합니다.

로컬 macOS 패키징 확인:

```bash
corepack pnpm pack:electron:dev
```

이 명령은 macOS 호스트에서 실행해야 합니다. Linux에서는 `corepack pnpm build:electron`로 Electron bundle까지만 확인하고, `.app`/`.dmg` 최종 산출물은 Mac에서 생성합니다.

릴리스용 패키징은 서명/노터라이즈 환경을 준비한 뒤 실행합니다.

```bash
corepack pnpm pack:electron
```

세부 구조와 운영 메모는 [docs/ELECTRON.md](docs/ELECTRON.md)를 참고합니다.

## Android 앱 개발

Android 앱은 Capacitor 기반 클라이언트 shell로 `android/`에 포함되어 있습니다. 모바일 기기에서 Codex/tmux를 직접 실행하는 구조가 아니라, 데스크톱 또는 서버에서 실행 중인 codexmux에 안전하게 접속합니다.

서버가 내려주는 React 코드가 terminal/status/timeline/sync WebSocket의 foreground reconnect를 담당하므로, native Android 파일을 바꾸지 않는 UI/연결성 수정은 APK 재배포 없이 `corepack pnpm deploy:local`로 반영됩니다. `CodexmuxAndroid` native bridge를 바꾸는 앱 정보/재시작 기능은 APK를 다시 빌드해 설치해야 합니다.

구성:

- `capacitor.config.ts`: Android 앱 ID, WebView navigation, cookie 설정
- `android-web/index.html`: 서버 URL 저장, 최근 서버, 자동 연결, 연결 실패 복구, 앱 정보/재시작을 담당하는 Android 런처
- `android/`: Capacitor가 생성한 Android native project와 앱 정보/재시작 native bridge

Android 프로젝트 동기화:

```bash
corepack pnpm android:sync
```

Android Studio 열기:

```bash
corepack pnpm android:open
```

기기 또는 에뮬레이터 실행:

```bash
corepack pnpm android:run
```

Debug APK 빌드:

```bash
corepack pnpm android:build
```

기기에 debug APK 설치:

```bash
corepack pnpm android:install
```

설치 상태 확인:

```bash
~/Android/Sdk/platform-tools/adb shell pm path com.hardcoremonk.codexmux
~/Android/Sdk/platform-tools/adb shell dumpsys package com.hardcoremonk.codexmux
corepack pnpm smoke:android:install
corepack pnpm smoke:android:foreground
corepack pnpm smoke:android:recovery
corepack pnpm smoke:android:runtime-v2
corepack pnpm smoke:android:timeline-foreground
```

릴리스 빌드는 keystore signing 설정을 준비한 뒤 실행합니다.

```bash
corepack pnpm android:keystore
corepack pnpm android:build:release
corepack pnpm android:bundle:release
```

예상 개발 전제:

- Android Studio
- JDK 17 이상
- Android SDK
- 모바일 기기에 Tailscale 설치 및 같은 tailnet 로그인
- codexmux 서버는 `HOST=localhost,tailscale` 또는 Tailscale Serve HTTPS로 노출

앱은 저장된 서버 또는 기본 Tailscale 서버로 자동 연결합니다. 연결 전 `/api/health`를 확인하고, HTTPS/HTTP/network/timeout 실패를 구분해 재시도 또는 서버 변경 흐름으로 되돌립니다. 최근 서버 목록, 서버 변경, 연결 실패 시 재시도 흐름, 앱 정보와 앱 재시작 기능을 제공합니다. 서버 접속 후에도 모바일 내비게이션의 앱 정보 화면에서 앱 versionName/versionCode, package, device, Android version, 서버 버전을 확인하고 WebView/Activity를 재시작할 수 있습니다. 로그인처럼 인증 전 public route에서는 status/native notification/Web Push/service worker runtime service를 시작하지 않아 fresh install 또는 app data clear 후 auth WebSocket과 service worker redirect console noise를 만들지 않습니다. 런처와 모바일 내비게이션은 한국어 우선 타이포그래피, safe-area, 터치 눌림 상태, focus-visible 상태를 기준으로 조정되어 있습니다. Android 버전은 `package.json` semver와 자동 동기화되며, patch가 `0`이면 앱 표기에서 마지막 `.0`을 생략합니다. 마이너 기능 변경은 `0.0.1`, 메이저 기능 묶음은 `0.1` 단위로 올립니다. 현재 `package.json` version은 `0.4.8`이며 Android 설치 상태는 다음 APK 빌드/설치 후 `versionName=0.4.8`, `versionCode=408`가 됩니다. HTTPS Tailscale Serve 주소를 우선 사용하고, 로컬 개발용 HTTP는 Android manifest와 Capacitor 설정에서 허용합니다.

세부 구조와 빌드 메모는 [docs/ANDROID.md](docs/ANDROID.md)를 참고합니다.

## CLI

서버가 실행되면 `~/.codexmux/port`와 `~/.codexmux/cli-token`이 생성됩니다. CLI는 이 값을 자동으로 읽습니다.

```bash
codexmux workspaces
codexmux tab list -w <workspace-id>
codexmux tab create -w <workspace-id> -t codex -n "new task"
codexmux tab send -w <workspace-id> <tab-id> "요청 내용"
codexmux tab status -w <workspace-id> <tab-id>
codexmux tab result -w <workspace-id> <tab-id>
```

외부 스크립트에서 직접 지정할 수도 있습니다.

```bash
CMUX_PORT=8121 CMUX_TOKEN=<token> codexmux workspaces
```

## 아키텍처

```text
Browser / PWA
  | HTTP + WebSocket
  v
custom Node server
  | Next.js Pages Router
  | /api/terminal, /api/timeline, /api/status, /api/sync
  v
tmux -L codexmux
  | session: pt-{workspaceId}-{paneId}-{tabId}
  v
shell / codex

Codex JSONL
  ~/.codex/sessions/YYYY/MM/DD/*.jsonl
  -> timeline, status, stats
```

- 터미널 I/O는 xterm.js, WebSocket, node-pty, tmux로 연결됩니다.
- 터미널과 Codex 입력창에서 `Ctrl+D`는 앱 단축키보다 우선해 EOF(`0x04`)로 전달됩니다. Linux/Windows의 오른쪽 분할 기본 단축키는 `Ctrl+Alt+D`이고, macOS는 `⌘D`입니다.
- 상태 감지는 tmux pane PID 아래 Codex process, Codex JSONL 변경, live pane prompt를 함께 봅니다. Codex CLI가 프로세스 시작 후 JSONL을 늦게 남기는 경우를 고려해 session id, process start time, live process 확인 후 cwd fallback 순서로 연결합니다. Permission/input prompt, resume directory 선택, JSONL marker 없는 interrupted prompt는 pane capture로 보정해 tab이 stale `busy`나 잘못된 `idle`에 남지 않게 합니다.
- 상태 전이, 알림 정책, session id mapping, 타임라인 병합/dedupe는 순수 모듈로 분리되어 있습니다.
- 타임라인 entry id는 JSONL byte offset과 record identity 기반으로 생성되며, Codex가 같은 assistant text를 `event_msg.agent_message`와 `response_item.message`로 나눠 기록하는 경우도 near-duplicate 규칙으로 한 번만 표시합니다.
- DIFF 패널은 tmux session cwd를 기준으로 Git 상태를 읽고, 대량 untracked 파일과 렌더링 비용을 제한합니다.
- 서버와 Next.js API route의 공유 상태는 `globalThis` singleton으로 유지합니다.
- 전용 tmux socket인 `codexmux`를 사용하므로 사용자의 기존 tmux 세션과 분리됩니다.

관련 문서:

| 문서 | 내용 |
|---|---|
| [docs/README.md](docs/README.md) | 내부 문서 맵과 갱신 규칙 |
| [docs/ADR.md](docs/ADR.md) | 아키텍처 결정 기록과 변경 기준 |
| [docs/ARCHITECTURE-LOGIC.md](docs/ARCHITECTURE-LOGIC.md) | 아키텍처 흐름과 서비스 로직 |
| [docs/STATUS.md](docs/STATUS.md) | Codex 작업 상태 감지와 status flow |
| [docs/TMUX.md](docs/TMUX.md) | tmux, terminal WebSocket, session 관리 |
| [docs/DATA-DIR.md](docs/DATA-DIR.md) | `~/.codexmux/` 구조와 삭제 기준 |
| [docs/TESTING.md](docs/TESTING.md) | 테스트 계층, Playwright/Chromium, platform smoke, live deploy 검증 |
| [docs/RUNTIME-V2-CUTOVER.md](docs/RUNTIME-V2-CUTOVER.md) | runtime v2 production 전환 단계와 rollback gate |
| [docs/RUNTIME-V2-PARITY.md](docs/RUNTIME-V2-PARITY.md) | runtime v2 surface별 parity matrix |
| [docs/SYSTEMD.md](docs/SYSTEMD.md) | Linux user service 등록과 운영 |
| [docs/STYLE.md](docs/STYLE.md) | theme와 color 사용 규칙 |
| [docs/ELECTRON.md](docs/ELECTRON.md) | Electron desktop app 개발과 패키징 |
| [docs/ANDROID.md](docs/ANDROID.md) | Android Capacitor app 개발, 앱 정보/재시작, 빌드 |
| [docs/FOLLOW-UP.md](docs/FOLLOW-UP.md) | 릴리스 전 확인과 post-MVP 백로그 |
| [docs/operations/](docs/operations/) | 배포와 smoke test 후 운영 handoff |

<a id="en"></a>

## English

codexmux is a self-hosted web session manager for Codex. It keeps Codex work in tmux-backed terminal sessions so you can manage multiple sessions from a browser or reconnect from mobile.

### Repository

- Repository: <https://github.com/HardcoreMonk/codexwinmux>
- Upstream reference: <https://github.com/subicura/purplemux>
- Runtime: Next.js Pages Router + custom Node server + tmux
- Package manager: pnpm
- Current version: 0.4.8
- Supported languages: English, Korean
- Default language: Korean

### Quick Start

For a published npm package:

```bash
npx codexmux
```

Open:

```text
http://localhost:8121
```

Requirements: Node.js 20 or newer and tmux. Server execution is supported on macOS and Linux.

### Server Options

The default port is `8121`.

```bash
codexmux
```

Pin the port and allow only localhost plus Tailscale clients:

```bash
HOST=localhost,tailscale PORT=8121 codexmux
```

Recommended `~/.zshrc` wrapper:

```zsh
codexmux() {
  HOST=localhost,tailscale,192.168.0.0/16 PORT=8121 command codexmux "$@"
}
```

For long-running Linux use, prefer a user service over a system-wide service. codexmux uses `~/.codexmux/` and the user's tmux socket, so `systemd --user` preserves the expected permissions and state paths.

Current workstation registration:

```text
~/.config/systemd/user/codexmux.service
HOST=localhost,tailscale,192.168.0.0/16
PORT=8121
```

Service commands:

```bash
systemctl --user status codexmux.service
systemctl --user restart codexmux.service
systemctl --user stop codexmux.service
journalctl --user -u codexmux.service -f
```

Enable linger if the service must start without an active login session:

```bash
loginctl enable-linger "$USER"
```

See [docs/SYSTEMD.md](docs/SYSTEMD.md) for the full service setup.

When running from a source checkout, use the dev server unless the package has already been built:

```bash
corepack pnpm dev
```

Production check:

```bash
corepack pnpm build
corepack pnpm start
```

For the Linux user service used by this workstation, prefer the deploy wrapper:

```bash
corepack pnpm deploy:local
curl -fsS http://127.0.0.1:8121/api/health
```

### Electron Development

The Electron desktop app uses the main/preload code under `electron/` together with the Next.js web server.

Run the development flow with one command:

```bash
corepack pnpm dev:electron
```

If `corepack pnpm dev` is already running, attach Electron only:

```bash
corepack pnpm dev:electron:attach
```

Build the Electron app:

```bash
corepack pnpm build:electron
```

Smoke Electron shell attach and runtime v2 terminal attach:

```bash
corepack pnpm smoke:electron:attach
corepack pnpm smoke:electron:runtime-v2
```

`smoke:electron:runtime-v2` starts a temp runtime v2 server and Electron shell,
then verifies `/api/v2/terminal` marker output after two page reload/reconnect rounds by default.

Local macOS packaging check:

```bash
corepack pnpm pack:electron:dev
```

Run this command on a macOS host. On Linux, use `corepack pnpm build:electron` to verify the Electron bundle and produce the final `.app`/`.dmg` artifacts on a Mac.

Release packaging requires the signing and notarization environment:

```bash
corepack pnpm pack:electron
```

### Android App Development

The Android app is included under `android/` as a Capacitor-based client shell. It connects to a running codexmux server instead of running Codex/tmux directly on the phone.

Foreground reconnect for terminal/status/timeline/sync WebSockets lives in the React code served by the codexmux server. UI and connection fixes that do not touch native Android files are picked up after `corepack pnpm deploy:local`, without rebuilding the APK. Changes to the `CodexmuxAndroid` native bridge, including app info and app restart behavior, require rebuilding and reinstalling the APK.

Structure:

- `capacitor.config.ts`: Android app id, WebView navigation, and cookie settings
- `android-web/index.html`: Android launcher for saved servers, recent servers, auto-connect, connection-failure recovery, app info, and app restart
- `android/`: generated Capacitor Android native project and app info/restart native bridge

Sync Android project files:

```bash
corepack pnpm android:sync
```

Open Android Studio:

```bash
corepack pnpm android:open
```

Run on a device or emulator:

```bash
corepack pnpm android:run
```

Build Android:

```bash
corepack pnpm android:build
```

Install the debug APK on a device:

```bash
corepack pnpm android:install
```

Verify installation:

```bash
~/Android/Sdk/platform-tools/adb shell pm path com.hardcoremonk.codexmux
~/Android/Sdk/platform-tools/adb shell dumpsys package com.hardcoremonk.codexmux
corepack pnpm smoke:android:install
corepack pnpm smoke:android:foreground
corepack pnpm smoke:android:recovery
corepack pnpm smoke:android:runtime-v2
corepack pnpm smoke:android:timeline-foreground
```

Release builds require keystore signing settings:

```bash
corepack pnpm android:keystore
corepack pnpm android:build:release
corepack pnpm android:bundle:release
```

Expected prerequisites:

- Android Studio
- JDK 17 or newer
- Android SDK
- Tailscale installed on the phone and logged into the same tailnet
- codexmux exposed through `HOST=localhost,tailscale` or Tailscale Serve HTTPS

The app automatically connects to the saved server or the default Tailscale server. Before navigation it probes `/api/health` and separates HTTPS, HTTP, network, and timeout failures so the launcher can return to retry or server-change flows. The launcher supports recent servers, server changes, retry flow after connection failures, app info, and app restart. After connecting to the server, the mobile navigation app info screen shows app versionName/versionCode, package, device, Android version, and server version, and can restart the WebView/Activity. Public pre-auth routes such as `/login` do not mount status/native notification/Web Push/service worker runtime services, which keeps fresh install and app data clear flows free of auth WebSocket or service worker redirect console noise. Launcher and mobile navigation surfaces are tuned for Korean-first typography, safe-area handling, touch pressed states, and focus-visible states. Android versioning is synchronized with `package.json` semver, and milestone versions with patch `0` drop the final `.0` in the app label. Minor feature changes increment by `0.0.1`; major feature batches increment by `0.1`. The current `package.json` version is `0.4.8`, so the next Android build/install should report `versionName=0.4.8` and `versionCode=408`. Prefer HTTPS through Tailscale Serve; HTTP is enabled only for local development paths.

### Tailscale

Run codexmux on a Tailscale-accessible interface:

```bash
HOST=localhost,tailscale PORT=8121 codexmux
```

Expose it over HTTPS with Tailscale Serve:

```bash
tailscale serve --bg --https=443 http://localhost:8121
```

Open:

```text
https://<machine>.<tailnet>.ts.net
```

Disable Serve:

```bash
tailscale serve off --https=443
```

On iPad, use Safari and add codexmux to the Home Screen. A native iPadOS app is not included yet; it would require adding a Capacitor iOS target and building with Xcode. The iOS startup screen is served from static `public/splash/*.png` images generated by `scripts/generate-splash.js`, and those assets must use `codexmux` branding. If an existing Home Screen app still shows an older startup image, remove it from the Home Screen and add it again so iOS refreshes its cached splash asset.

### Features

- Persistent tmux sessions for browser and mobile reconnects
- Multi-workspace layout with panes, tabs, working directories, workspace rename/group editing, and sidebar state
- Codex status detection for busy, idle, input-needed, review-needed, resume, delayed JSONL attach, and live prompt recovery states
- Codex CLI-compatible input, including `Ctrl+D` EOF delivery from terminal and Codex input focus
- Live timeline from Codex JSONL logs
- PWA, iPad Safari, Android app, Web Push, foreground reconnect, input draft preservation, and terminal preview while CODEX is checking
- Stable timeline entry ids and duplicate suppression across reconnects and paired Codex records
- Notification controls for task-complete toast, system notifications, completion sound, and global approval queue prompt type/risk badges
- Git status, diff, history, fetch, pull, and push flows
- Diff safety for large changes through bounded untracked handling, skipped-file notices, short server cache, default collapse, and request timeouts
- Usage stats, token cache analysis, cost estimates, daily reports, and in-flight cache build dedupe
- Authenticated `/api/debug/perf` snapshot for process, event loop, WebSocket, watcher, polling, cache, and terminal stdout metrics
- Quick prompts with the built-in `Commit` prompt plus user-defined prompts
- CLI bridge through `codexmux tab ...`

Playwright is included as developer tooling for browser UI regression checks. On a new checkout, run `corepack pnpm exec playwright install chromium` once before adding or running Playwright specs. See [docs/TESTING.md](docs/TESTING.md) for the smoke matrix and sequencing notes.

### Related Docs

| Document | Contents |
|---|---|
| [docs/README.md](docs/README.md) | Internal documentation map and update rules |
| [docs/ADR.md](docs/ADR.md) | Architecture decisions and change triggers |
| [docs/ARCHITECTURE-LOGIC.md](docs/ARCHITECTURE-LOGIC.md) | Architecture flow and service logic |
| [docs/STATUS.md](docs/STATUS.md) | Codex work-state detection and status flow |
| [docs/TMUX.md](docs/TMUX.md) | tmux, terminal WebSocket, and session management |
| [docs/DATA-DIR.md](docs/DATA-DIR.md) | `~/.codexmux/` layout and deletion guidance |
| [docs/TESTING.md](docs/TESTING.md) | Test tiers, Playwright/Chromium, platform smoke, and live deploy checks |
| [docs/RUNTIME-V2-CUTOVER.md](docs/RUNTIME-V2-CUTOVER.md) | Runtime v2 production cutover phases and rollback gates |
| [docs/RUNTIME-V2-PARITY.md](docs/RUNTIME-V2-PARITY.md) | Runtime v2 surface-by-surface parity matrix |
| [docs/SYSTEMD.md](docs/SYSTEMD.md) | Linux user service operation |
| [docs/STYLE.md](docs/STYLE.md) | Theme and color rules |
| [docs/ELECTRON.md](docs/ELECTRON.md) | Electron desktop development and packaging |
| [docs/ANDROID.md](docs/ANDROID.md) | Android Capacitor development, app info/restart, and build |
| [docs/FOLLOW-UP.md](docs/FOLLOW-UP.md) | Release checks and post-MVP backlog |
| [docs/operations/](docs/operations/) | Deployment and smoke-test handoffs |

### Security And Data

The first login sets a password. codexmux stores a scrypt hash in `~/.codexmux/config.json`, not the plain password.

To reset only the password, remove these fields from `config.json` and restart:

```json
{
  "authPassword": "...",
  "authSecret": "..."
}
```

Deleting the whole `config.json` also resets app settings such as locale, theme, network access, and Codex options.

The app stores its own state in `~/.codexmux/` and reads Codex CLI JSONL sessions from `~/.codex/sessions/`. Data left by older builds under `~/.codexmux/remote/codex/` is ignored by current codexmux versions and can be deleted manually without affecting local app state or original `~/.codex/sessions/` files.

## 라이선스

[MIT](LICENSE)
