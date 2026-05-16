# Electron Development

codexwinmux의 Electron 앱은 Windows 설치형 제품의 Shell Host입니다. 로컬 모드는
기존 `127.0.0.1:8121` Backend/Core Engine에 attach하거나, 없으면 같은 packaged
executable을 engine process로 시작합니다. 창 닫기는 UI를 tray로 숨기며 engine을
중지하지 않습니다. Phase 2 service owner slice부터 packaged executable은
`--codexwinmux-engine` 인자로 Backend/Core Engine 전용 bootstrap을 시작할 수 있습니다.
Core/Backend physical separation P2부터 같은 executable은 `--codexwinmux-core` 인자로
BrowserWindow 없이 Core Supervisor/workers만 시작하는 standalone Core host도 제공합니다.
`0.4.18`부터 Backend adapter 기본 Core transport는 loopback TCP입니다. UI-owned local
engine은 `--codexwinmux-core`와 `--codexwinmux-engine` paired process를 함께 시작하고,
Windows service runbook 기본값은 `codexwinmux-core`/`codexwinmux-backend` split mode입니다.
combined Windows service start/install과 Backend in-process Core client fallback은 제거됐고,
기존 combined service는 `-Mode combined` stop/uninstall migration cleanup에만 사용합니다.

## 명령

```bash
corepack pnpm dev:electron
corepack pnpm dev:electron:attach
corepack pnpm build:electron
corepack pnpm smoke:electron:attach
corepack pnpm smoke:electron:runtime-v2
corepack pnpm smoke:windows:electron-env
corepack pnpm smoke:windows:electron-packaging
corepack pnpm smoke:windows:zip-artifact
corepack pnpm smoke:windows:update-metadata
corepack pnpm smoke:windows:signing-evidence
corepack pnpm smoke:windows:smartscreen-public-evidence
corepack pnpm smoke:windows:updater-local-feed
corepack pnpm smoke:windows:updater-published-channel
corepack pnpm smoke:windows:packaged-launch
corepack pnpm smoke:windows:engine-lifecycle
corepack pnpm smoke:windows:core-backend-external-transport
corepack pnpm smoke:windows:packaged-runtime-v2
corepack pnpm smoke:windows:installer-install
corepack pnpm smoke:windows:installer-runtime-v2
corepack pnpm smoke:windows:package-gate
corepack pnpm pack:electron:dev
corepack pnpm pack:electron
corepack pnpm pack:electron:mac:dev
corepack pnpm pack:electron:mac
```

- `dev:electron`: 필요하면 `corepack pnpm dev` 서버를 자동으로 띄운 뒤 Electron을 연결합니다.
- `dev:electron:attach`: 이미 실행 중인 `http://localhost:8121` 서버에 Electron만 붙입니다.
- `build:electron`: Next.js standalone, custom server, Electron main/preload를 빌드합니다.
- `smoke:electron:attach`: Electron shell을 remote debugging port로 실행해 live server attach, preload bridge, page reload, blocking console 오류를 확인합니다.
- `smoke:electron:runtime-v2`: temp HOME/DB runtime v2 서버와 Electron shell을 띄운 뒤 page context에서 existing session cookie로 `/api/v2/terminal` WebSocket attach, marker output, 기본 2회 page reload/reconnect를 확인합니다.
- `smoke:windows:electron-env`: Windows Electron local server bootstrap이 POSIX PATH를 주입하지 않고 `NODE_PATH`를 Windows `;` 구분자로 만드는지 dry-run으로 확인합니다.
- `smoke:windows:electron-packaging`: package script와 `electron-builder.yml`이 Windows NSIS/zip 패키징 계약, updater metadata와 맞는 NSIS artifact name을 만족하는지 dry-run으로 확인합니다.
- `smoke:windows:zip-artifact`: `release/*-win.zip` archive 안에 exe, `app.asar`, runtime v2 workers, Windows native terminal/runtime modules, standalone Next.js server가 직접 `require()`하는 JS runtime dependency가 있는지 확인합니다.
- `smoke:windows:update-metadata`: `release/latest.yml`이 실제 NSIS installer, installer size, sha512, blockmap artifact와 일치하고, packaged `app-update.yml`이 GitHub publish provider와 같은 owner/repo를 가리키는지 확인합니다.
- `smoke:windows:signing-evidence`: NSIS installer와 `win-unpacked` 실행 파일의 Authenticode 서명, timestamp, SmartScreen 수동 증거를 확인합니다. preferred env는 `CODEXWINMUX_SMARTSCREEN_EVIDENCE_PATH`와 `CODEXWINMUX_SMARTSCREEN_STATUS`이며, 내부 전용 배포는 `internal-not-required` 또는 `internal-trusted-root` 상태를 signed/timestamped artifact와 함께 기록할 수 있습니다. 비-runtime 기존 `CODEXMUX_*` env는 호환 fallback입니다. Runtime 입력은 `0.4.15`부터 `CODEXWINMUX_RUNTIME_*`만 사용합니다.
- `smoke:windows:smartscreen-public-evidence`: GitHub Release 같은 HTTPS public download URL에서 Chromium download로 installer를 내려받고, Internet ZoneId=3과 `Start-Process` launch/exit 증거를 확인해 public SmartScreen `passed` evidence JSON을 생성합니다. 이 smoke는 외부 공개 배포 전용 gate이며, 내부 폐쇄망 전용 릴리스에서는 실행하지 않아도 됩니다. 실행 시 temp install/uninstall을 수행하므로 Windows 사용자 설치 상태를 임시로 변경합니다.
- `smoke:windows:updater-local-feed`: NSIS installer를 temp 경로에 설치하고 synthetic local `latest.yml` feed로 update download, `quitAndInstall`, 설치 후 launch smoke, silent uninstall을 확인합니다. Smoke 종료 시 temp root 아래 pending update installer process를 정리하고 retry delete로 설치 폴더를 제거합니다.
- `smoke:windows:updater-published-channel`: `electron-builder.yml`의 GitHub publish owner/repo에서 published release channel을 read-only로 확인합니다. 최신 published release에 `latest.yml`, installer, matching `.blockmap`, newer semver, download URL이 없으면 blocker로 실패합니다.
- `smoke:windows:packaged-launch`: `release/win-unpacked/codexwinmux.exe`를 실제 실행해 packaged local server, preload bridge, `/api/health`, runtime startup diagnostics, blocking console 0건을 확인합니다.
- `smoke:windows:engine-lifecycle`: packaged app을 실행한 뒤 UI 종료 후에도 `127.0.0.1:8121` engine health가 유지되는지 확인합니다. Smoke 종료 cleanup에서는 같은 packaged exe로 뜬 남은 engine process를 정리합니다.
- `smoke:windows:service-host`: 기본 tray owner plan, Windows Service owner plan, default-on split service plan을 확인합니다. Service owner plan은 migration cleanup용 combined metadata와 기본 `codexwinmux-backend`/`codexwinmux-core` split plan, WinSW wrapper의 `install`/`uninstall`/`start`/`stop`/`restart` 명령 계획, split transport env, `scripts/windows-service.ps1` runbook helper 존재 여부를 검증하지만, smoke 중 실제 service 등록이나 시작/중지는 실행하지 않습니다.
- `smoke:windows:core-engine-ipc`: build된 `dist/workers/core-engine-host.js`를 독립 child process로 실행하고 IPC `core.health` event/reply를 확인합니다.
- `smoke:windows:core-backend-external-transport`: 독립 Core host를 TCP listener로 실행하고 Backend runtime adapter가 외부 Core process에 attach해 `core.health`를 받는지 확인합니다.
- `smoke:windows:core-backend-split-lifecycle`: 기본값은 non-mutating dry-run으로 split service lifecycle 순서를 확인합니다. 실제 service mutation evidence는 `CODEXWINMUX_WINDOWS_SPLIT_LIFECYCLE_MUTATE=1`을 별도로 지정할 때만 수집합니다. `CODEXWINMUX_WINDOWS_SPLIT_LIFECYCLE_STABILITY_MS=<ms>`를 함께 지정하면 core/backend restart 뒤 cleanup 전에 backend health를 반복 확인하는 stability hold를 추가합니다.
- `smoke:windows:packaged-runtime-v2`: packaged app을 runtime v2 `new-tabs` mode로 실행해 workspace/tab 생성, `/api/v2/terminal` WebSocket attach, Windows marker command output을 확인합니다.
- `smoke:windows:installer-install`: `release/codexwinmux-Setup-<version>.exe`를 임시 경로에 silent install하고, 설치된 app을 `smoke:windows:packaged-launch`로 확인한 뒤 silent uninstall합니다.
- `smoke:windows:installer-runtime-v2`: silent install한 앱에 `smoke:windows:packaged-runtime-v2`와 같은 runtime v2 terminal 검증을 적용한 뒤 silent uninstall합니다.
- `smoke:windows:package-gate`: 이미 생성된 Windows `release/` 산출물에 대해 zip artifact, update metadata, updater local feed, packaged launch, engine lifecycle, standalone Core IPC, Backend external Core attach, split lifecycle dry-run, packaged runtime v2, installer runtime v2 smoke를 순차 실행합니다. 설치된 split service가 실행 중이면 local-engine package smoke 구간 전후로 `windows:service-account:stop-services`와 `restart-services`를 실행해 포트/프로필 충돌을 격리합니다.
- `pack:electron:dev`: 로컬 Windows unpacked package 검증용입니다. Installer를 만들지 않습니다.
- `pack:electron`: Windows 릴리스 패키징입니다.
- `pack:electron:mac:dev`, `pack:electron:mac`: 기존 macOS 패키징 검증용 명령입니다. Windows-only 전환 중 legacy/manual path로만 유지합니다.

Windows NSIS installer는 `build-resources/installer.nsh`를 include해 설치와 제거
과정의 상세 로그 pane을 기본으로 표시한다. 설치 중 멈춤이나 파일 복사 실패를
내부 배포자가 바로 확인할 수 있게 유지한다.

## 런타임

주요 파일:

| 파일 | 역할 |
| --- | --- |
| `electron/main.ts` | BrowserWindow, 메뉴, local/remote 서버 모드, updater |
| `electron/engine-controller.ts` | 기존 engine health probe, owned engine 시작/재시작/중지, UI 수명과 engine 수명 분리 |
| `electron/engine-process.ts` | `--codexwinmux-engine`, `--codexwinmux-core` CLI flag와 process launch args |
| `electron/core-process.ts` | Electron packaged executable의 Core-only bootstrap |
| `src/workers/core-engine-host.ts` | Node packaged worker entry로 실행 가능한 Core Engine host |
| `src/lib/core-engine/*` | Backend/Core typed command, reply, event contract와 client/server/process host/TCP transport adapter |
| `electron/preload.ts` | 안전한 renderer IPC bridge |
| `electron/browser-bridge.ts` | Electron webview 기반 browser panel bridge |
| `electron/runtime-env.ts` | local server bootstrap의 platform별 PATH와 `NODE_PATH` 구분자 처리 |
| `scripts/dev-electron.mjs` | dev server 자동 실행 + Electron attach |
| `electron-builder.yml` | Windows NSIS/zip 기본 패키징 설정과 legacy macOS 패키징 설정 |

앱 설정은 `~/.codexwinmux/config.json`에 저장합니다. Electron 전용 설정도 같은 파일을 사용하며, 서버 모드는 `server.mode`과 `server.remoteUrl`로 관리합니다.

Electron renderer는 웹 UI와 같은 terminal input 정책을 사용합니다. 터미널이나
Codex 입력창에 포커스가 있으면 `Ctrl+D`는 앱 단축키가 아니라 Codex CLI/shell
EOF(`0x04`)로 전달됩니다.

## Attach Smoke

`corepack pnpm smoke:electron:attach`는 현재 build된 `dist-electron/main.js`를 사용해 Electron을 실제로 실행하고 `ELECTRON_DEV_URL` 또는 `CODEXMUX_ELECTRON_SMOKE_URL` 서버에 붙입니다. Chromium remote debugging port로 page target을 찾아 reload 후 다음을 확인합니다.

- live server origin 로드
- `window.electronAPI` preload bridge 주입
- login 또는 app page ready state
- blocking console event 0건

비-Windows smoke에서는 Electron SUID sandbox 설정이 없는 개발 checkout에서도
실행되도록 Chromium `--no-sandbox`를 붙일 수 있습니다. 이 경로는 legacy/manual
검증이며, 현재 Windows 제품 release gate는 Windows packaged/installer smoke를
기준으로 합니다.

## 알림

- 작업 완료 상태는 foreground toast와 Electron native notification으로 표시할 수 있습니다.
- `soundOnCompleteEnabled=false`이면 completion sound를 재생하지 않고 native notification도 silent로 요청합니다.
- notification 설정은 웹/PWA와 같은 `~/.codexwinmux/config.json` 값을 공유합니다.

## 서버 모드

로컬 서버:

- 앱 실행 시 기존 `127.0.0.1:8121` engine health를 먼저 확인합니다.
- 기존 engine이 healthy codexwinmux이면 UI는 그대로 attach합니다.
- healthy engine이 없으면 Shell Host가 같은 packaged executable을 engine process로 시작합니다.
- engine process는 canonical `--codexwinmux-engine` CLI flag 또는 `CODEXWINMUX_ELECTRON_ENGINE_PROCESS=1`로 구분합니다. 기존 `CODEXMUX_ELECTRON_ENGINE_PROCESS=1`은 호환 입력입니다.
- core process는 canonical `--codexwinmux-core` CLI flag 또는 `CODEXWINMUX_ELECTRON_CORE_PROCESS=1`로 구분합니다. Core process는 BrowserWindow를 만들거나 UI single-instance lock을 잡지 않고 runtime Supervisor/workers를 시작한 뒤 Core command/event protocol에 응답합니다.
- engine host mode에서는 기본 포트 `8121`을 고정하고, 다른 process가 점유한 포트로 조용히 fallback하지 않습니다.
- 창 닫기는 BrowserWindow를 tray로 숨기며 engine을 중지하지 않습니다.
- UI 종료는 engine을 남겨 둡니다. `UI와 엔진 종료` 메뉴를 명시적으로 선택한 경우에만 이 UI가 시작한 owned engine을 중지합니다.
- Windows에서는 Finder/Dock용 POSIX PATH 보정을 적용하지 않고 현재 Windows `PATH`를 유지합니다.
- packaged local server의 `NODE_PATH`는 Windows에서 `;`, macOS/Linux에서 `:` 구분자를 사용합니다.

원격 서버:

- 메뉴에서 원격 서버 URL을 입력하면 `~/.codexwinmux/config.json`에 저장합니다.
- URL scheme이 없으면 `http://`를 붙입니다.
- 허용 scheme은 `http://`와 `https://`입니다.

## Runtime v2 Smoke

Electron은 웹/PWA와 같은 React runtime v2 terminal hook을 사용한다. runtime v2
terminal smoke는 먼저 서버 script로 검증하고, Electron에서는 같은 app surface의
existing session cookie로 `/api/v2/terminal` attach가 되는지 확인한다.

1. app-surface Phase 2 gate smoke를 먼저 실행한다. 이 명령은 temp HOME/DB 서버를
   직접 띄워 normal session cookie로 browser reload, server restart, mode-off rollback을
   확인한다.

```bash
corepack pnpm smoke:runtime-v2:phase2
```

2. Electron에서 붙을 서버를 runtime v2 new-tabs mode로 실행한다.

```bash
CODEXWINMUX_RUNTIME_V2=1 CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs PORT=8132 corepack pnpm dev
```

3. low-level runtime terminal smoke도 통과시킨다.

```bash
corepack pnpm smoke:runtime-v2
```

4. 자동 Electron page-context smoke를 실행한다. 이 명령은 temp runtime v2
   server/HOME/DB를 띄우고, Electron page에 login cookie를 주입한 뒤
   `/api/v2/terminal` WebSocket으로 marker command 출력이 돌아오는지 확인한다.
   기본값은 initial attach 후 2회 page reload/reconnect이며,
   `CODEXWINMUX_ELECTRON_RUNTIME_V2_RECONNECT_ROUNDS`로 반복 횟수를 조정한다.
   Windows smoke harness는 `cmd -> corepack -> pnpm exec electron` process tree를
   `taskkill /T /F`로 정리해 timeout 뒤 cleanup 대기에 머무르지 않게 한다.

```bash
corepack pnpm smoke:electron:runtime-v2
```

Windows packaged/installed app runtime v2 smoke는 실제 `release/` 산출물을 대상으로 실행한다.
`smoke:windows:packaged-runtime-v2`는 unpacked exe를 직접 띄우고, `smoke:windows:installer-runtime-v2`는
NSIS silent install 후 설치된 exe로 같은 terminal WebSocket marker를 확인한다.

```bash
corepack pnpm smoke:windows:packaged-runtime-v2
corepack pnpm smoke:windows:installer-runtime-v2
corepack pnpm smoke:windows:package-gate
```

5. Windows 제품 release gate는 packaged/installed smoke를 authoritative evidence로
   본다. `smoke:windows:packaged-runtime-v2`와
   `smoke:windows:installer-runtime-v2`가 terminal attach, marker output,
   installed app launch를 확인하면 Electron runtime v2 package smoke가 통과한
   상태다.
6. UI 수명과 engine 수명 분리는 `smoke:windows:engine-lifecycle`로 확인한다.
   이 smoke는 UI quit 이후에도 `127.0.0.1:8121/api/health`가 살아 있는지 보고,
   cleanup에서는 smoke가 시작한 engine process만 정리한다.
7. Windows Service owner 실행 계약은 `smoke:windows:service-host`로 확인한다.
   이 smoke는 service owner plan, WinSW wrapper command, `--codexwinmux-engine`
   bootstrap command, runbook helper를 검증하지만 SCM을 변경하지 않는다. 실제 service
   등록은 관리자 권한에서 `corepack pnpm windows:service:install`과
   `corepack pnpm windows:service:start`로 수행한다. 현재 승인된 운영 모델은
   runbook-first service account 전환이다. 장기 목표 service account는
   `codexwinmux-svc`이며, profile/data dir, Codex credential/session migration,
   folder ACL, `SeServiceLogonRight`, account rotation, health/reboot-readiness smoke를
   elevated runbook에서 닫은 뒤 적용한다. NSIS는 service 자동 설치를 기본 흐름에 넣지
   않고 `Windows service runbook (advanced)` default-off section만 제공한다.
   전용 계정 승격 준비 상태는 `corepack pnpm windows:service-account:plan`과
   `corepack pnpm smoke:windows:service-account`로 확인한다. 실제 계정 생성,
   credential/session copy, ACL 부여, service logon 변경, password rotation,
   profile-aware service restart/health는
   `CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_PASSWORD` 또는
   `CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_ROTATION_PASSWORD`를 설정한 elevated
   PowerShell에서만 실행한다.
8. 비-Windows packaged foreground smoke는 legacy/manual reference로만 남긴다.
   현재 Windows 제품 release gate나 내부 배포 판단에는 포함하지 않는다.

## 빌드 산출물

`corepack pnpm build:electron`은 실행 가능한 Electron main/preload bundle과
Next.js standalone server bundle을 생성하지만 Windows installer를 만들지는
않습니다. 설치형 산출물은 `pack:electron` 단계에서 생성합니다.

| 명령 | 산출물 |
| --- | --- |
| `corepack pnpm build:electron` | `dist/`, `dist-electron/`, `.next/standalone/` |
| `corepack pnpm pack:electron:dev` | `release/` 아래 Windows unpacked package |
| `corepack pnpm pack:electron` | `release/` 아래 Windows NSIS installer와 zip package |
| `corepack pnpm pack:electron:mac:dev` | `release/` 아래 unsigned local macOS package |
| `corepack pnpm pack:electron:mac` | `release/` 아래 signed/notarized macOS package |

Windows에서 앱을 실제로 설치하려면 `release/*.exe` NSIS installer 또는
`release/*-win.zip` 산출물이 필요합니다. 현재 repository checkout에 `release/`가
없으면 아직 Windows 앱 패키징을 실행하지 않은 상태입니다. macOS 산출물은
legacy/manual 검증용이며 현재 제품 배포 기준이 아닙니다.

Windows package contract는 `corepack pnpm smoke:windows:electron-packaging`으로 먼저
확인합니다. 이 smoke는 실제 installer를 만들지 않고 `pack:electron`,
`pack:electron:dev`, `win.target`, `nsis`, `win.icon` 설정만 읽습니다. Windows
default package는 `nsis` installer와 `zip` target을 만들고, 개발 검증은
`pack:electron:dev`의 unpacked output을 사용합니다.

Windows package 명령은 `electron-builder`를 직접 호출하지 않고
`scripts/pack-electron-windows.mjs`를 사용합니다. wrapper는 electron-builder의
node-module collector가 `pnpm`을 찾을 수 있도록 임시 shim을 만들고,
`--config.npmRebuild=false`를 전달합니다. packaged runtime native binding은
standalone app bundle에서 공급되므로 packaging 변경 시 생성된
`release/win-unpacked` 산출물로 확인해야 합니다.

Windows wrapper는 electron-builder 실행 전에 packaged runtime dependency용
Electron ABI native prebuild를 설치합니다. runtime v2 worker는 파일 시스템에서
fork되므로 `dist/workers/**`는 unpacked 상태로 유지합니다. P2부터
`dist/workers/core-engine-host.js`도 같은 worker artifact set에 포함됩니다. NSIS silent install
smoke가 installer에서 앱을 자동 실행하지 않고 끝날 수 있도록 `runAfterFinish`는
비활성화 상태를 유지합니다.

NSIS `artifactName`은 `${productName}-Setup-${version}.${ext}`를 유지합니다. 그래야
`latest.yml`, installer exe, matching `.blockmap`이 updater-visible artifact name을
같이 사용합니다.

Packaged `resources/app-update.yml`은 `electron-builder.yml`의 `publish.provider`,
`publish.owner`, `publish.repo`와 일치해야 합니다. `smoke:windows:update-metadata`가
이를 `release/win-unpacked` 기준으로 확인합니다.

`smoke:windows:updater-local-feed`는 생성된 `latest.yml`을 template로 사용하고,
temp local feed에서 patch version만 올린 뒤, 기존 NSIS installer를 localhost에서
제공합니다. 이 smoke는 download, `update-downloaded`, `quitAndInstall`, app exit,
post-install launch, uninstall까지 Electron updater event를 확인합니다. smoke 전용
updater env hook은 path-light JSONL status를 쓰고 differential download를 꺼서
synthetic feed가 현재 installer artifact를 재사용할 수 있게 합니다.
Windows에서 update installer가 temp smoke root 아래 pending process로 남을 수 있으므로,
cleanup은 해당 root를 command line에 포함한 process만 종료한 뒤 retry delete를 수행합니다.

`smoke:windows:updater-published-channel`은 앱을 설치하거나 업데이트하지 않습니다.
설정된 GitHub Releases channel을 read-only로 조회하고, 최신 published release가
updater-visible `latest.yml`, NSIS installer, installer blockmap asset을 노출하지
않으면 실패합니다. 실제 published update evidence의 preflight이며, 성공적인
download/install evidence는 사용자가 설치한 버전보다 더 최신 published version이
있어야 합니다. release commit이 이미 `package.json`을 올린 뒤에는
`CODEXWINMUX_WINDOWS_UPDATER_CURRENT_VERSION=<installed-version>`을 지정해 사용자가
설치한 버전과 channel을 비교합니다. 비-runtime 기존 `CODEXMUX_*` env는 호환 fallback입니다. Runtime 입력은 `0.4.15`부터 `CODEXWINMUX_RUNTIME_*`만 사용합니다.

`smoke:windows:signing-evidence`는 `Get-AuthenticodeSignature`로
`release/codexwinmux-Setup-<version>.exe`와 `release/win-unpacked/codexwinmux.exe`를
검사하고 SHA-256, signature status, signer, timestamp certificate evidence를
출력합니다. 서명되지 않은 build는 실패가 정상이며, release blocker로 기록합니다.
서명된 build에서 public SmartScreen 통과를 기록하려면 먼저 public launch evidence를
수집한 뒤 그 JSON을 signing evidence에 제공합니다. 내부 전용 배포는 signed/timestamped
artifact를 전제로 `internal-not-required` 또는 `internal-trusted-root` 상태를 사용할 수
있습니다. `CODEXWINMUX_SMARTSCREEN_PUBLIC_RELEASE=1` 모드에서는 internal-only 상태와
단순 `CODEXWINMUX_SMARTSCREEN_STATUS=passed` shorthand를 허용하지 않습니다.

현재 제품 범위가 내부 폐쇄망 전용이면 public SmartScreen reputation은 release
blocker가 아닙니다. 내부 gate는 signed/timestamped artifact, 내부 trusted root 배포,
`internal-not-required` 또는 `internal-trusted-root` SmartScreen scope,
`smoke:windows:package-gate`, 폐쇄망 또는 local target의
`smoke:runtime-v2:phase6-default-gate` 통과를 기준으로 판단합니다.

```bash
CODEXWINMUX_SMARTSCREEN_DOWNLOAD_URL=https://github.com/HardcoreMonk/codexwinmux/releases/download/v<version>/codexwinmux-Setup-<version>.exe CODEXWINMUX_SMARTSCREEN_EXPECTED_SHA256=<installer-sha256> CODEXWINMUX_SMARTSCREEN_PUBLIC_EVIDENCE_OUTPUT=artifacts/smartscreen-v<version>-public.json corepack pnpm smoke:windows:smartscreen-public-evidence
CODEXWINMUX_SMARTSCREEN_PUBLIC_RELEASE=1 CODEXWINMUX_SMARTSCREEN_EVIDENCE_PATH=artifacts/smartscreen-v<version>-public.json corepack pnpm smoke:windows:signing-evidence
CODEXWINMUX_SMARTSCREEN_STATUS=internal-not-required CODEXWINMUX_SMARTSCREEN_ENVIRONMENT=internal-trusted-root-distribution corepack pnpm smoke:windows:signing-evidence
```

Playwright Chromium binary가 없는 새 Windows runner에서는 먼저
`corepack pnpm exec playwright install chromium`을 실행합니다.

`smoke:windows:updater-github-feed`는 설치된 앱 전체를 대상으로 하는 updater
smoke입니다. 기준 installer를 silent install하고, 설치된 앱을 GitHub Release
download feed에 연결한
뒤 `update-available`, `download-started`, `update-downloaded`,
`quit-and-install-started`를 관찰합니다. 이후 `quitAndInstall(true, false)` 뒤 앱이
종료되는지 기다리고, 업데이트된 설치 exe를 실행해 packaged runtime v2 terminal
smoke를 수행한 다음 temp install path를 uninstall합니다. 설치 시작 버전은
`CODEXWINMUX_WINDOWS_UPDATER_BASE_INSTALLER_PATH`, 장시간 installed-app evidence는
`CODEXWINMUX_WINDOWS_UPDATER_GITHUB_FEED_POST_INSTALL_HOLD_MS`로 조정합니다. 이 smoke
env는 Codex-hosted Windows runner가 sandboxed Electron process의 Electron `net`
external HTTPS를 막기 때문에 `ELECTRON_DISABLE_SANDBOX=1`을 설정합니다. 이는
harness 요구사항이며 제품 identity나 updater metadata 변경이 아닙니다.

macOS DMG target은 `dmg-license`와 Darwin native `iconv-corefoundation`을 사용한다. `dmg-license`는 pnpm node linker에서 electron-builder의 runtime `require()`가 항상 해석되도록 direct devDependency로 고정한다. Linux에서는 `corepack pnpm build:electron`까지를 release smoke로 보고, macOS packaging은 Mac M1 같은 macOS host에서 `corepack pnpm pack:electron:mac:dev`/`pack:electron:mac`로 실행한다.

2026-05-04 `v0.4.1` release 기준 Linux release host에서 `corepack pnpm build:electron`은 통과했다. 당시 macOS 패키징은 M1 macOS host(`Darwin arm64`)에서 commit `23fee4b`로 `release/codexwinmux-0.4.1-arm64.dmg`, `release/codexwinmux-0.4.1-arm64-mac.zip`, `release/codexwinmux-0.4.1.dmg`, `release/codexwinmux-0.4.1-mac.zip`을 생성했다. `node scripts/verify-runtime-native-bindings.mjs --electron`, `lipo -archs`, `Info.plist` version `0.4.1`, arm64/x86_64 app arch, `hdiutil verify`가 통과했다. `CODEXWINMUX_ELECTRON_APP_PATH=<release/.../codexwinmux.app>`를 주면 attach/runtime-v2 smoke가 packaged `.app` 실행 파일을 직접 띄울 수 있고, `CODEXWINMUX_ELECTRON_WINDOW_FOREGROUND_CYCLES=1`로 CDP foreground probe 뒤 terminal attach를 반복 확인할 수 있다. Linux Electron 41 smoke에서는 `Browser.*` window bounds가 없어 `target-activate` fallback으로 통과했다. live checkout에서 Electron build/packaging을 실행한 뒤에는 `.next/standalone`이 다시 만들어지므로 Linux user service는 `corepack pnpm deploy:local`로 재시작해 cwd를 정상화한다.

## 패키징 메모

현재 패키징 metadata는 제품명, app id, data dir, executable/artifact name을
`codexwinmux` 기준으로 독립 운영합니다. 현재 소스 버전은 `0.4.19`이며, 새
published update evidence를 주장하려면 같은 버전의 `latest.yml`,
`codexwinmux-Setup-<version>.exe`, matching `.blockmap`을 GitHub Release에 발행한 뒤
published/updater smoke를 다시 실행해야 합니다.

2026-05-07 `v0.4.8` release는 `latest.yml`, `codexwinmux-Setup-0.4.8.exe`,
`codexwinmux-Setup-0.4.8.exe.blockmap`을 GitHub Release asset으로 발행했고,
`CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION=0.4.2 corepack pnpm smoke:windows:updater-published-channel`가
`0.4.2 -> 0.4.8` channel evidence로 통과했습니다. 같은 날
`smoke:windows:updater-github-feed`도 installed `0.4.2`에서 GitHub-hosted `0.4.8`
download/install/`quitAndInstall`/post-update runtime v2 smoke까지 통과했습니다.

`0.4.14` Windows installer와 `win-unpacked/codexwinmux.exe`는 내부 code signing
certificate로 Authenticode 서명됐고 DigiCert RFC3161 timestamp evidence를 포함합니다.
2026-05-14 로컬 `0.4.16` Windows package도 같은 내부 code signing certificate
`CN=PureCVisor Desktop Node Internal Code Signing`으로 재빌드했고,
`smoke:windows:signing-evidence`는 installer와 `win-unpacked` exe 모두
Authenticode `Valid`, DigiCert RFC3161 timestamp present로 통과했습니다. 이어서
서명된 `0.4.16` 산출물 기준 `smoke:windows:package-gate`가 zip/update metadata,
local updater, packaged launch, engine lifecycle, packaged runtime v2, installer
runtime v2를 모두 통과했습니다.
2026-05-17 `0.4.19` Windows package는 같은 내부 code signing certificate와
DigiCert RFC3161 timestamp server로 재생성했습니다. `smoke:windows:signing-evidence`는
installer와 `win-unpacked` exe 모두 Authenticode `Valid`, timestamp present,
internal SmartScreen scope accepted로 통과했고, signed artifact 기준
`smoke:windows:package-gate`와 `smoke:windows:release-gate`도 통과했습니다.
GitHub Release `v0.4.19`는 `latest.yml`, NSIS installer, matching `.blockmap`,
zip asset을 포함하며 `CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION=0.4.18` 기준
`smoke:windows:updater-published-channel`이 `0.4.18 -> 0.4.19` channel evidence로
통과했습니다.
내부 전용 배포에서는 `CODEXWINMUX_SMARTSCREEN_STATUS=internal-not-required`를
trusted root distribution 범위의 SmartScreen evidence로 기록합니다. 외부 공개 배포를
시작할 때만 public SmartScreen reputation을 별도 release blocker로 둡니다.
`CODEXWINMUX_SMARTSCREEN_PUBLIC_RELEASE=1` strict mode는 이 내부 판정을 거부하고
public launch evidence JSON 기반 `passed` evidence를 요구합니다.
2026-05-15 재검증에서는 `v0.4.15` public installer와 SHA-256
`68ea233834ce254064545b2194a6844d6c7fb7051f65367dccf917de11042480` 기준
Chromium download, SHA match, Internet ZoneId=3까지 통과했지만 Windows
`Start-Process` launch evidence가 취소/SmartScreen reputation 단계에서 실패했습니다.
따라서 public SmartScreen `passed` evidence는 아직 확보되지 않았고, 다음 공개
릴리스도 기존 tag/asset을 덮어쓰지 않고 `0.4.19+` 새 version으로 발행해야 합니다.
이 public evidence 미확보 상태는 내부 폐쇄망 릴리스나 내부 legacy fallback 제거의
blocker로 사용하지 않습니다.
다음 공개/내부 릴리스는 기존 tag나 asset을 덮어쓰지 말고 새 version/tag로
발행합니다. `v0.4.14` tag와 asset은 불변 historical evidence로 유지합니다.

Windows packaging과 updater smoke child process에는 `NODE_OPTIONS`로 `DEP0176`,
`DEP0190` warning suppression을 병합합니다. 두 warning은 현재 최신
electron-builder/electron-updater dependency 경로에서 발생하는 Node deprecation warning이며
제품 runtime warning으로 분류하지 않습니다.

릴리스 패키징 전에 확인할 항목:

- GitHub release publish 권한
- Windows code signing certificate와 thumbprint
- timestamp signing 설정
- 내부 또는 public SmartScreen 판정 범위
- 기존 version tag/release가 이미 있으면 `smoke:release-immutability`가 실패하므로
  새 버전 번호로 발행
- `node-pty` native binary가 `asarUnpack`에 포함되는지 확인
