# codexwinmux

Windows 전용 Codex 작업 공간/세션 관리자입니다. 이 저장소는 기존
`codexmux` 기반을 Windows 설치형 제품으로 전환하는 `codexwinmux` 제품
저장소입니다.

앱은 Electron Shell Host, 로컬 Backend/Core Engine, Next.js Frontend Engine을
같은 Windows 제품 안에서 실행합니다. 기본 접속 포트는 `8121`이며, 창을 닫아도
엔진이 바로 내려가지 않도록 UI 수명과 엔진 수명을 분리합니다.

## 현재 상태

| 항목 | 값 |
| --- | --- |
| 저장소 | <https://github.com/HardcoreMonk/codexwinmux> |
| 제품 표시명 | `codexwinmux` |
| 실행 파일/패키지명 | `codexwinmux` |
| 현재 버전 | `0.4.14` |
| 대상 플랫폼 | Windows 전용 |
| 기본 URL | `http://127.0.0.1:8121` |
| UI 기본 언어 | 한국어 |
| 지원 UI 언어 | 한국어, English |
| 패키지 매니저 | pnpm |
| 런타임 | Next.js Pages Router, custom Node server, Electron, Runtime v2 Windows adapter |

현재 Windows 제품 identity는 `codexwinmux`입니다. Electron `productName`,
`appId`, 설치 파일명, 실행 파일명, updater cache, 앱 데이터 디렉터리는
`codexwinmux` 기준으로 분리합니다. `CODEXMUX_*` 환경 변수와 `cmux` CLI
token/header는 기존 운영 호환 레이어로 유지합니다.

## 설치와 실행

내부 배포용 GitHub Release에서 Windows 설치 파일을 내려받아 실행합니다.

```text
codexwinmux-Setup-<version>.exe
```

설치 프로그램은 설치 진행 과정을 볼 수 있는 상세 로그 pane을 표시합니다. 설치
중 파일 복사, 권한, 실행 후크 문제가 생기면 이 로그를 먼저 확인합니다.

설치가 끝나면 시작 메뉴 또는 설치된 실행 파일에서 앱을 실행합니다. 앱이 정상
부팅되면 Electron 창이 열리고, 같은 로컬 UI를 브라우저에서도 확인할 수 있습니다.

```text
http://127.0.0.1:8121
```

창 닫기는 앱을 tray로 숨깁니다. 엔진까지 종료해야 할 때는 tray/menu의
`UI와 엔진 종료` 흐름을 사용합니다.

## 로컬 개발

```bash
git clone https://github.com/HardcoreMonk/codexwinmux.git
cd codexwinmux
corepack enable
corepack pnpm install
```

웹 서버만 실행합니다.

```bash
corepack pnpm dev
```

Electron Shell Host와 로컬 서버를 함께 실행합니다.

```bash
corepack pnpm dev:electron
```

이미 `8121` 포트에서 개발 서버가 실행 중이면 Electron만 붙일 수 있습니다.

```bash
corepack pnpm dev:electron:attach
```

## Windows 패키징

릴리스 빌드 전 기본 검증입니다.

```bash
corepack pnpm tsc --noEmit
corepack pnpm lint
corepack pnpm test
corepack pnpm build:electron
```

Windows unpacked package를 만듭니다.

```bash
corepack pnpm pack:electron:dev
```

Windows NSIS installer와 zip package를 만듭니다.

```bash
corepack pnpm pack:electron
```

패키징 산출물은 `release/` 아래 생성됩니다.

| 산출물 | 용도 |
| --- | --- |
| `release/win-unpacked/codexwinmux.exe` | 설치 전 launch/runtime smoke |
| `release/codexwinmux-Setup-<version>.exe` | 내부 배포용 Windows installer |
| `release/codexwinmux-Setup-<version>.exe.blockmap` | auto update differential metadata |
| `release/latest.yml` | electron-updater release feed metadata |
| `release/*-win.zip` | zip package artifact |

## Windows Smoke

Windows 패키지 계약과 실제 실행을 확인합니다.

```bash
corepack pnpm smoke:windows:electron-packaging
corepack pnpm smoke:windows:packaged-launch
corepack pnpm smoke:windows:engine-lifecycle
corepack pnpm smoke:windows:packaged-runtime-v2
```

installer 설치와 Runtime v2 terminal까지 확인합니다.

```bash
corepack pnpm smoke:windows:installer-install
corepack pnpm smoke:windows:installer-runtime-v2
```

패키지 릴리스 gate 전체를 순차 실행합니다.

```bash
corepack pnpm smoke:windows:package-gate
```

GitHub Release 기반 updater channel은 다음 asset이 모두 있을 때 유효합니다.

- `latest.yml`
- `codexwinmux-Setup-<version>.exe`
- `codexwinmux-Setup-<version>.exe.blockmap`

로컬 feed와 published channel은 각각 다음 smoke로 확인합니다.

```bash
corepack pnpm smoke:windows:updater-local-feed
corepack pnpm smoke:windows:updater-published-channel
```

설치된 이전 버전에서 GitHub-hosted 최신 버전으로 `download -> update-downloaded
-> quitAndInstall -> 재실행 -> runtime v2 terminal`까지 확인할 때는 다음 smoke를
사용합니다.

```bash
corepack pnpm smoke:windows:updater-github-feed
```

## 런타임 구조

```text
Electron Shell Host
  - BrowserWindow, tray, menu, updater
  - 창 닫기와 엔진 종료를 분리
  - 기존 127.0.0.1:8121 engine이 healthy하면 attach
  - 없으면 owned Backend/Core Engine을 시작

Backend/Core Engine
  - custom Node server
  - Next.js Pages Router API
  - workspace/session/tab 상태
  - Runtime v2 terminal adapter
  - Windows process inspector
  - Codex session detection / JSONL mapping

Frontend Engine
  - Next.js UI
  - terminal, Codex, diff, settings 화면
  - 한국어 기본 locale과 English locale
```

엔진 host mode에서는 `8121` 포트를 고정합니다. 다른 프로세스가 포트를 점유한
상태에서 조용히 다른 포트로 fallback하지 않습니다.

## 데이터 위치

현재 앱 상태는 사용자 홈의 `.codexwinmux` 디렉터리에 저장합니다.

```text
%USERPROFILE%\.codexwinmux\
```

Codex CLI 원본 세션 JSONL은 다음 위치를 읽기 전용으로 참조합니다.

```text
%USERPROFILE%\.codex\sessions\
```

주요 파일은 다음과 같습니다.

| 경로 | 내용 |
| --- | --- |
| `config.json` | 인증, locale, theme, notification, server 설정 |
| `workspaces.json` | workspace 목록과 active workspace |
| `workspaces/<wsId>/layout.json` | pane/tab layout과 tab metadata |
| `quick-prompts.json` | 사용자 quick prompt |
| `keybindings.json` | 앱 단축키 override |
| `logs/` | 로컬 서버 로그 |
| `session-index.json` | Codex session list metadata cache |

## 주요 기능

- Windows 설치형 Electron 앱
- 기본 포트 `8121` 고정
- `codexwinmux` 로고와 타이틀
- tray-first lifecycle
- UI 종료와 Backend/Core Engine 수명 분리
- workspace, session, terminal, Codex, diff 화면
- Runtime v2 Windows terminal integration
- Windows process inspector 기반 Codex 실행 감지
- Codex JSONL session mapping
- GitHub Release 기반 updater smoke
- 설치 과정 상세 로그 표시
- 한국어 기본 UI와 English UI 병행

## 현재 경계

- 이 제품은 Windows 전용 릴리스 흐름을 기준으로 운영합니다.
- 비-Windows 배포 흐름은 현재 제품 목표가 아닙니다.
- 프론트엔드 프레임워크 교체, 백엔드 프레임워크 교체, Vercel 전환은 이번 전환
  범위가 아닙니다.
- app id, data dir, executable/artifact name은 `codexwinmux` 기준으로 독립되어
  있습니다. 기존 `codexmux` 데이터는 자동 병합하지 않습니다.
- Windows code signing과 timestamp 증거는 `0.4.14`부터 확보했습니다. 내부 전용
  배포에서는 trusted root distribution 범위의 SmartScreen 판정을 사용하며, 외부 공개
  배포를 시작할 때만 public SmartScreen reputation을 별도 gate로 둡니다.

## 문제 확인

앱 창은 열렸지만 화면이 뜨지 않거나 브라우저에서 `500 Internal Server Error`가
보이면 먼저 engine health와 포트 점유 상태를 확인합니다.

```powershell
Invoke-WebRequest http://127.0.0.1:8121/api/health
Get-NetTCPConnection -LocalPort 8121 -ErrorAction SilentlyContinue
```

패키지 앱 기준으로는 launch smoke가 같은 경로를 자동 확인합니다.

```bash
corepack pnpm smoke:windows:packaged-launch
```

터미널 생성이나 접근이 안 되면 Runtime v2 terminal smoke를 먼저 실행합니다.

```bash
corepack pnpm smoke:windows:packaged-runtime-v2
corepack pnpm smoke:windows:installer-runtime-v2
```

## 관련 문서

| 문서 | 내용 |
| --- | --- |
| [docs/README.md](docs/README.md) | 내부 문서 맵과 갱신 규칙 |
| [docs/ADR.md](docs/ADR.md) | 아키텍처 결정 기록 |
| [docs/ELECTRON.md](docs/ELECTRON.md) | Electron Shell Host와 Windows packaging |
| [docs/TESTING.md](docs/TESTING.md) | 테스트와 smoke 계층 |
| [docs/RUNTIME-V2-CUTOVER.md](docs/RUNTIME-V2-CUTOVER.md) | Runtime v2 전환 단계 |
| [docs/RUNTIME-V2-PARITY.md](docs/RUNTIME-V2-PARITY.md) | Runtime v2 parity matrix |
| [docs/WINDOWS-ONLY-GAP-AUDIT.md](docs/WINDOWS-ONLY-GAP-AUDIT.md) | Windows-only gap audit |
| [docs/DATA-DIR.md](docs/DATA-DIR.md) | `.codexwinmux` 데이터 디렉터리 |
| [docs/operations/](docs/operations/) | 릴리스와 운영 handoff |

## 라이선스

[MIT](LICENSE)
