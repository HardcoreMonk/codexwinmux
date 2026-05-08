# Electron Development

codexmux의 Electron 앱은 Next.js UI를 데스크톱 shell 안에서 실행합니다. 로컬 모드는 앱이 내부 Node 서버를 띄우고, 원격 모드는 이미 실행 중인 codexmux 서버 URL로 연결합니다.

## Commands

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
corepack pnpm smoke:windows:updater-local-feed
corepack pnpm smoke:windows:updater-published-channel
corepack pnpm smoke:windows:packaged-launch
corepack pnpm smoke:windows:engine-lifecycle
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
- `smoke:windows:zip-artifact`: `release/*-win.zip` archive 안에 exe, `app.asar`, runtime v2 workers, Windows native terminal/runtime modules가 있는지 확인합니다.
- `smoke:windows:update-metadata`: `release/latest.yml`이 실제 NSIS installer, installer size, sha512, blockmap artifact와 일치하고, packaged `app-update.yml`이 GitHub publish provider와 같은 owner/repo를 가리키는지 확인합니다.
- `smoke:windows:updater-local-feed`: NSIS installer를 temp 경로에 설치하고 synthetic local `latest.yml` feed로 update download, `quitAndInstall`, 설치 후 launch smoke, silent uninstall을 확인합니다.
- `smoke:windows:updater-published-channel`: `electron-builder.yml`의 GitHub publish owner/repo에서 published release channel을 read-only로 확인합니다. 최신 published release에 `latest.yml`, installer, matching `.blockmap`, newer semver, download URL이 없으면 blocker로 실패합니다.
- `smoke:windows:packaged-launch`: `release/win-unpacked/codexmux.exe`를 실제 실행해 packaged local server, preload bridge, `/api/health`, runtime startup diagnostics, blocking console 0건을 확인합니다.
- `smoke:windows:engine-lifecycle`: packaged app을 실행한 뒤 UI 종료 후에도 `127.0.0.1:8121` engine health가 유지되는지 확인합니다. Smoke 종료 cleanup에서는 같은 packaged exe로 뜬 남은 engine process를 정리합니다.
- `smoke:windows:packaged-runtime-v2`: packaged app을 runtime v2 `new-tabs` mode로 실행해 workspace/tab 생성, `/api/v2/terminal` WebSocket attach, Windows marker command output을 확인합니다.
- `smoke:windows:installer-install`: `release/codexmux-Setup-<version>.exe`를 임시 경로에 silent install하고, 설치된 app을 `smoke:windows:packaged-launch`로 확인한 뒤 silent uninstall합니다.
- `smoke:windows:installer-runtime-v2`: silent install한 앱에 `smoke:windows:packaged-runtime-v2`와 같은 runtime v2 terminal 검증을 적용한 뒤 silent uninstall합니다.
- `smoke:windows:package-gate`: 이미 생성된 Windows `release/` 산출물에 대해 zip artifact, update metadata, updater local feed, packaged launch, packaged runtime v2, installer runtime v2 smoke를 순차 실행합니다.
- `pack:electron:dev`: 로컬 Windows unpacked package 검증용입니다. Installer를 만들지 않습니다.
- `pack:electron`: Windows 릴리스 패키징입니다.
- `pack:electron:mac:dev`, `pack:electron:mac`: 기존 macOS 패키징 검증용 명령입니다. Windows-only 전환 중 legacy/manual path로만 유지합니다.

Windows NSIS installer는 `build-resources/installer.nsh`를 include해 설치와 제거
과정의 상세 로그 pane을 기본으로 표시한다. 설치 중 멈춤이나 파일 복사 실패를
내부 배포자가 바로 확인할 수 있게 유지한다.

## Runtime

주요 파일:

| File | Purpose |
| --- | --- |
| `electron/main.ts` | BrowserWindow, 메뉴, local/remote 서버 모드, updater |
| `electron/preload.ts` | 안전한 renderer IPC bridge |
| `electron/browser-bridge.ts` | Electron webview 기반 browser panel bridge |
| `electron/runtime-env.ts` | local server bootstrap의 platform별 PATH와 `NODE_PATH` 구분자 처리 |
| `scripts/dev-electron.mjs` | dev server 자동 실행 + Electron attach |
| `electron-builder.yml` | Windows NSIS/zip 기본 패키징 설정과 legacy macOS 패키징 설정 |

앱 설정은 `~/.codexmux/config.json`에 저장합니다. Electron 전용 설정도 같은 파일을 사용하며, 서버 모드는 `server.mode`과 `server.remoteUrl`로 관리합니다.

Electron renderer는 웹/PWA와 같은 terminal input 정책을 사용합니다. 터미널이나 Codex 입력창에 포커스가 있으면 `Ctrl+D`는 앱 단축키가 아니라 Codex CLI/shell EOF(`0x04`)로 전달되고, macOS pane 분할은 `⌘D`를 사용합니다.

## Attach Smoke

`corepack pnpm smoke:electron:attach`는 현재 build된 `dist-electron/main.js`를 사용해 Electron을 실제로 실행하고 `ELECTRON_DEV_URL` 또는 `CODEXMUX_ELECTRON_SMOKE_URL` 서버에 붙입니다. Chromium remote debugging port로 page target을 찾아 reload 후 다음을 확인합니다.

- live server origin 로드
- `window.electronAPI` preload bridge 주입
- login 또는 app page ready state
- blocking console event 0건

Linux smoke에서는 Electron SUID sandbox 설정이 없는 개발 checkout에서도 실행되도록 Chromium `--no-sandbox`를 붙입니다. 이 smoke는 `.app/.dmg` 패키징을 대체하지 않고, desktop shell attach/preload 회귀를 빠르게 잡는 용도입니다.

## Notifications

- 작업 완료 상태는 foreground toast와 Electron native notification으로 표시할 수 있습니다.
- `soundOnCompleteEnabled=false`이면 completion sound를 재생하지 않고 native notification도 silent로 요청합니다.
- notification 설정은 웹/PWA와 같은 `~/.codexmux/config.json` 값을 공유합니다.

## Server Modes

로컬 서버:

- 앱 실행 시 기존 `127.0.0.1:8121` engine health를 먼저 확인합니다.
- 기존 engine이 healthy codexmux이면 UI는 그대로 attach합니다.
- healthy engine이 없으면 Shell Host가 같은 packaged executable을 engine process로 시작합니다.
- engine host mode에서는 기본 포트 `8121`을 고정하고, 다른 process가 점유한 포트로 조용히 fallback하지 않습니다.
- 창 닫기는 BrowserWindow를 tray로 숨기며 engine을 중지하지 않습니다.
- UI 종료는 engine을 남겨 둡니다. `UI와 엔진 종료` 메뉴를 명시적으로 선택한 경우에만 이 UI가 시작한 owned engine을 중지합니다.
- Windows에서는 Finder/Dock용 POSIX PATH 보정을 적용하지 않고 현재 Windows `PATH`를 유지합니다.
- packaged local server의 `NODE_PATH`는 Windows에서 `;`, macOS/Linux에서 `:` 구분자를 사용합니다.

원격 서버:

- 메뉴에서 원격 서버 URL을 입력하면 `~/.codexmux/config.json`에 저장합니다.
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
CODEXMUX_RUNTIME_V2=1 CODEXMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs PORT=8132 corepack pnpm dev
```

3. low-level runtime terminal smoke도 통과시킨다.

```bash
corepack pnpm smoke:runtime-v2
```

4. 자동 Electron page-context smoke를 실행한다. 이 명령은 temp runtime v2
   server/HOME/DB를 띄우고, Electron page에 login cookie를 주입한 뒤
   `/api/v2/terminal` WebSocket으로 marker command 출력이 돌아오는지 확인한다.
   기본값은 initial attach 후 2회 page reload/reconnect이며,
   `CODEXMUX_ELECTRON_RUNTIME_V2_RECONNECT_ROUNDS`로 반복 횟수를 조정한다.

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

5. packaged Electron 또는 OS window foreground까지 포함한 smoke는 macOS에서
   `.app` bundle을 직접 지정해 실행한다. `.app` 경로를 주면 smoke script가
   `Contents/MacOS/*` 실행 파일을 직접 띄워 DevTools port를 붙인다.
   `CODEXMUX_ELECTRON_WINDOW_FOREGROUND_CYCLES`는 runtime v2 smoke 안에서
   window foreground probe 후 `/api/v2/terminal` marker output을 다시 확인한다.
   Electron/Chromium이 `Browser.*` CDP domain을 노출하면 window minimize/restore를
   사용하고, 그렇지 않으면 `Target.activateTarget`/`Page.bringToFront` fallback을
   사용한다. 실제 사용된 method는 `electron-window-foreground-*-...` check로 출력된다.

```bash
CODEXMUX_ELECTRON_APP_PATH=release/mac-arm64/codexmux.app \
  corepack pnpm smoke:electron:attach

CODEXMUX_ELECTRON_APP_PATH=release/mac-arm64/codexmux.app \
CODEXMUX_ELECTRON_WINDOW_FOREGROUND_CYCLES=1 \
  corepack pnpm smoke:electron:runtime-v2
```

6. Finder 더블클릭, Gatekeeper prompt, Dock/Finder launch domain 환경까지 확인해야 하면
   Electron remote/local shell에서 기존 app workspace 화면을 열고 plain terminal tab을 생성한다.
7. 새 tab이 기존 app surface에 남아 있고 terminal output에 `pwd` 결과가 보이는지 확인한다.
8. Electron shell의 existing session cookie로 `/api/v2/terminal` WebSocket이 열리는지
   확인한다. 별도 query-string token은 사용하지 않는다.
9. Electron 창을 background로 보냈다가 foreground로 되돌린 뒤 같은 tab에서 다시
   attach한다.
10. `CODEXMUX_RUNTIME_TERMINAL_V2_MODE=off`로 서버를 재시작하면 새 plain terminal tab은
   legacy로 생성되고 기존 v2 tab은 삭제되지 않으며 runtime v2 disabled diagnostic을 표시하는지 확인한다.
11. terminal output이 fresh attach 후 계속 들어오고 rollback diagnostic이 명확하면 Electron runtime v2 smoke가 통과한
   상태다.

## Build Output

`corepack pnpm build:electron`은 실행 가능한 Electron main/preload bundle과 Next.js standalone server bundle을 생성하지만 `.app` 또는 `.dmg`를 만들지는 않습니다.

| 명령 | 산출물 |
| --- | --- |
| `corepack pnpm build:electron` | `dist/`, `dist-electron/`, `.next/standalone/` |
| `corepack pnpm pack:electron:dev` | `release/` 아래 Windows unpacked package |
| `corepack pnpm pack:electron` | `release/` 아래 Windows NSIS installer와 zip package |
| `corepack pnpm pack:electron:mac:dev` | `release/` 아래 unsigned local macOS package |
| `corepack pnpm pack:electron:mac` | `release/` 아래 signed/notarized macOS package |

Windows에서 앱을 실제로 설치하려면 `release/*.exe` NSIS installer 또는 `release/*-win.zip` 산출물이 필요합니다. 현재 repository checkout에 `release/`가 없으면 아직 Windows 앱 패키징을 실행하지 않은 상태입니다. macOS 수동 검증에서는 `release/*.dmg` 또는 `release/*/*.app` 산출물을 사용합니다.

Windows package contract는 `corepack pnpm smoke:windows:electron-packaging`으로 먼저 확인한다. 이 smoke는 실제 installer를 만들지 않고 `pack:electron`, `pack:electron:dev`, `win.target`, `nsis`, `win.icon` 설정만 읽는다. Windows default package는 `nsis` installer와 `zip` target을 만들고, 개발 검증은 `pack:electron:dev`의 unpacked output을 사용한다.

Windows package commands use `scripts/pack-electron-windows.mjs` instead of invoking `electron-builder` directly. The wrapper creates a temporary `pnpm` shim for electron-builder's node-module collector and passes `--config.npmRebuild=false`; packaged runtime native bindings are supplied from the standalone app bundle and must be checked with the generated `release/win-unpacked` output when packaging changes.

The Windows wrapper installs Electron ABI native prebuilds for packaged runtime dependencies before electron-builder runs. `dist/workers/**` stays unpacked because runtime v2 workers are forked from the filesystem, and NSIS `runAfterFinish` stays disabled so silent install smoke can complete without launching the app from the installer.
NSIS `artifactName` stays `${productName}-Setup-${version}.${ext}` so `latest.yml`, the installer exe, and the matching `.blockmap` use the same updater-visible artifact name.
Packaged `resources/app-update.yml` must stay aligned with `electron-builder.yml` `publish.provider`, `publish.owner`, and `publish.repo`; `smoke:windows:update-metadata` checks this against `release/win-unpacked`.
`smoke:windows:updater-local-feed` uses the generated `latest.yml` as a template, bumps only the patch version in a temp local feed, serves the existing NSIS installer from localhost, and verifies Electron updater events through download, `update-downloaded`, `quitAndInstall`, app exit, post-install launch, and uninstall. The smoke-only updater env hook writes path-light JSONL status and disables differential download so the synthetic feed can reuse the current installer artifact.
`smoke:windows:updater-published-channel` does not install or update the app. It queries the configured GitHub Releases channel and fails closed until a published release exposes the updater-visible `latest.yml`, NSIS installer, and installer blockmap assets. It is the preflight for real published update evidence; successful download/install evidence still requires a published version newer than the installed app. After a release commit already bumps `package.json`, set `CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION=<installed-version>` to compare the channel against the version users have installed.
`smoke:windows:updater-github-feed` is the full installed-app updater smoke. It silent-installs the base installer, points that installed app at the GitHub Release download feed, observes `update-available`, `download-started`, `update-downloaded`, `quit-and-install-started`, waits for the app to exit after `quitAndInstall(true, false)`, launches the updated installed exe, runs packaged runtime v2 terminal smoke, and uninstalls the temp install path. Use `CODEXMUX_WINDOWS_UPDATER_BASE_INSTALLER_PATH` for the installed starting version and `CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_POST_INSTALL_HOLD_MS` for long-running installed-app evidence. The smoke env sets `ELECTRON_DISABLE_SANDBOX=1` because this Codex-hosted Windows runner blocks Electron `net` external HTTPS from sandboxed Electron processes; this is a harness requirement, not a product identity or updater metadata change.

macOS DMG target은 `dmg-license`와 Darwin native `iconv-corefoundation`을 사용한다. `dmg-license`는 pnpm node linker에서 electron-builder의 runtime `require()`가 항상 해석되도록 direct devDependency로 고정한다. Linux에서는 `corepack pnpm build:electron`까지를 release smoke로 보고, macOS packaging은 Mac M1 같은 macOS host에서 `corepack pnpm pack:electron:mac:dev`/`pack:electron:mac`로 실행한다.

2026-05-04 `v0.4.1` release 기준 Linux release host에서 `corepack pnpm build:electron`은 통과했다. 당시 macOS 패키징은 M1 macOS host(`Darwin arm64`)에서 commit `23fee4b`로 `release/codexmux-0.4.1-arm64.dmg`, `release/codexmux-0.4.1-arm64-mac.zip`, `release/codexmux-0.4.1.dmg`, `release/codexmux-0.4.1-mac.zip`을 생성했다. `node scripts/verify-runtime-native-bindings.mjs --electron`, `lipo -archs`, `Info.plist` version `0.4.1`, arm64/x86_64 app arch, `hdiutil verify`가 통과했다. `CODEXMUX_ELECTRON_APP_PATH=<release/.../codexmux.app>`를 주면 attach/runtime-v2 smoke가 packaged `.app` 실행 파일을 직접 띄울 수 있고, `CODEXMUX_ELECTRON_WINDOW_FOREGROUND_CYCLES=1`로 CDP foreground probe 뒤 terminal attach를 반복 확인할 수 있다. Linux Electron 41 smoke에서는 `Browser.*` window bounds가 없어 `target-activate` fallback으로 통과했다. live checkout에서 Electron build/packaging을 실행한 뒤에는 `.next/standalone`이 다시 만들어지므로 Linux user service는 `corepack pnpm deploy:local`로 재시작해 cwd를 정상화한다.

## Packaging Notes

현재 패키징 metadata는 제품명/app id/data dir을 `codexmux`로 유지하고, publish repo만 `HardcoreMonk/codexwinmux`를 사용합니다. 2026-05-07 `v0.4.8` release는 `latest.yml`, `codexmux-Setup-0.4.8.exe`, `codexmux-Setup-0.4.8.exe.blockmap`을 GitHub Release asset으로 발행했고, `CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION=0.4.2 corepack pnpm smoke:windows:updater-published-channel`가 `0.4.2 -> 0.4.8` channel evidence로 통과했습니다. 같은 날 `smoke:windows:updater-github-feed`도 installed `0.4.2`에서 GitHub-hosted `0.4.8` download/install/`quitAndInstall`/post-update runtime v2 smoke까지 통과했습니다.

`0.4.8` Windows installer와 `win-unpacked/codexmux.exe`는 `Get-AuthenticodeSignature` 기준 `NotSigned`입니다. Code signing certificate trust, timestamp, and SmartScreen reputation are therefore release blockers until a trusted signing certificate is applied and the signed installer is re-published.

릴리스 패키징 전에 확인할 항목:

- macOS signing certificate
- Apple notarize credentials
- GitHub release publish 권한
- `node-pty` native binary가 `asarUnpack`에 포함되는지 확인
