# Android Development

codexmux Android 앱은 Capacitor 기반 WebView shell입니다. Android 기기에서 Codex나 tmux를 직접 실행하지 않고, 데스크톱 또는 서버에서 실행 중인 codexmux에 접속합니다.

## Commands

```bash
corepack pnpm android:sync
corepack pnpm android:open
corepack pnpm android:run
corepack pnpm android:build
corepack pnpm android:build:debug
corepack pnpm android:install
corepack pnpm android:keystore
corepack pnpm android:build:release
corepack pnpm android:bundle:release
corepack pnpm smoke:android:release-aab
corepack pnpm smoke:android:install
corepack pnpm smoke:android:foreground
corepack pnpm smoke:android:recovery
corepack pnpm smoke:android:runtime-v2
corepack pnpm smoke:android:timeline-foreground
```

- `android:sync`: `android-web/` asset과 Capacitor 설정을 `android/` 프로젝트에 반영합니다.
- `android:open`: Android Studio를 엽니다.
- `android:run`: 연결된 기기 또는 에뮬레이터에서 실행합니다.
- `android:build`, `android:build:debug`: debug APK를 생성합니다.
- `android:install`: 연결된 기기에 debug APK를 설치합니다.
- `android:keystore`: 로컬 release keystore와 `android/keystore.properties`를 생성합니다.
- `android:build:release`: signed release APK를 생성합니다.
- `android:bundle:release`: signed release AAB를 생성합니다.
- `smoke:android:release-aab`: 로컬 keystore 권한, git ignore, fresh AAB, 필수 bundle entry, signature를 확인합니다.
- `smoke:android:install`: 연결된 debug APK의 package/version/activity 상태를 확인합니다.
- `smoke:android:foreground`: Android WebView DevTools와 ADB로 foreground/background 복귀, native bridge, console/logcat 오류를 확인합니다.
- `smoke:android:recovery`: network, HTTP 4xx, SSL 실패 후 native launcher 복귀와 서버 재연결을 확인합니다.
- `smoke:android:runtime-v2`: temp runtime v2 서버를 Tailscale IP로 노출하고 Android WebView에서 `/api/v2/terminal` attach와 foreground reconnect marker output을 확인합니다.
- `smoke:android:timeline-foreground`: temp runtime v2 서버를 Tailscale IP로 노출하고 Android WebView page context에서 `/api/timeline` init freshness와 foreground reconnect를 확인한 뒤, 종료 전에 운영 restore URL 로드 완료를 검증합니다.

## Versioning

Android 앱 버전은 repo root의 `package.json` semver를 기준으로 합니다. Android `versionName`은 patch가 `0`인 마일스톤 버전에서 마지막 `.0`을 생략해 표시합니다.

| Source | Android |
| --- | --- |
| `package.json` `version` | `versionName` |
| `major * 10000 + minor * 100 + patch` | `versionCode` |

예: `0.3.0`은 `versionName=0.3`, `versionCode=300`입니다. `0.3.1`은 `versionName=0.3.1`, `versionCode=301`입니다. CI나 수동 배포에서 `ANDROID_VERSION_CODE` 환경변수를 주면 `versionCode`만 override할 수 있습니다.

현재 repo/release version은 `0.4.15`이며 다음 debug install smoke 기준 설치 상태는 `versionName=0.4.15`, `versionCode=415`입니다.

버전 증가 규칙:

- 마이너 기능 변경과 작은 수정 배포는 patch를 `0.0.1`씩 올립니다.
- 메이저 기능 묶음은 minor를 `0.1`씩 올리고 patch를 `0`으로 되돌립니다.

현재 앱 ID는 `com.hardcoremonk.codexmux`입니다.

## Local SDK

현재 개발 머신 기준:

| Item | Value |
| --- | --- |
| SDK path | `/home/hardcoremonk/Android/Sdk` |
| compile SDK | `android-36` |
| build tools | `36.0.0` |
| platform tools | `37.0.0` |
| JDK | OpenJDK 21 |

프로젝트별 SDK 경로는 `android/local.properties`에 둡니다. 이 파일은 git에 커밋하지 않습니다.

## App Structure

| Path | Purpose |
| --- | --- |
| `capacitor.config.ts` | app id, WebView navigation, cookie 설정 |
| `android-web/index.html` | 서버 URL 저장/자동 재접속 런처, 앱 정보/재시작 |
| `android/` | Capacitor Android native project |
| `android/app/src/main/AndroidManifest.xml` | Android 권한과 cleartext 개발 설정 |
| `android/app/src/main/java/com/hardcoremonk/codexmux/CodexmuxAppInfo.java` | 런처와 React 모바일 UI에 앱 버전/기기 정보, 앱 재시작 기능을 노출하는 native bridge |
| `android/app/src/main/java/com/hardcoremonk/codexmux/CodexmuxWebViewClient.java` | 원격 서버 로딩 실패 시 런처 복귀 |

## Mobile UX

- `android-web/index.html`은 한국어 우선 font stack, `word-break: keep-all`, safe-area padding, `100dvh`/`100svh` fallback을 사용합니다.
- URL 입력, 현재 서버, 최근 서버처럼 주소가 들어가는 영역은 `overflow-wrap: anywhere`와 일반 줄바꿈을 유지합니다.
- 런처 버튼은 `touch-action: manipulation`, `:active`, `:focus-visible` 상태를 제공합니다.
- React 모바일 화면은 워크스페이스/탭 선택 항목, 하단 탭 바, 그룹 헤더, 상태 화면에 터치 눌림 상태와 focus-visible ring을 제공합니다.
- Android WebView 안의 모바일 메뉴에서 앱 versionName/versionCode, package, device, Android version, 서버 버전을 확인하고 앱을 재시작할 수 있습니다.
- terminal input, reconnect flow, WebView navigation은 안정성을 우선하므로 시각 개선보다 구조 변경을 최소화합니다.
- 물리 키보드의 `Ctrl+D`와 terminal toolbar의 Ctrl 조합은 Codex CLI/shell 제어 입력으로 전달합니다. 앱 단축키가 이 입력을 가로채지 않아야 합니다.
- CODEX 화면이 session 확인 또는 생성 중이면 timeline이 아직 붙지 않았더라도 하단 terminal preview를 표시해 tmux의 실제 Codex 출력을 확인할 수 있게 합니다.

## Connection Flow

1. 앱에 저장된 서버 URL이 있으면 바로 자동 재접속합니다.
2. 저장된 URL이 없으면 기본 서버 URL을 저장한 뒤 자동 연결합니다.
3. 최근 서버 목록에서 이전 서버를 바로 다시 선택할 수 있습니다.
4. 서버를 바꿔야 하면 런처의 변경 버튼으로 URL을 수정합니다.
5. 변경한 URL은 `localStorage`에 저장되고 다음 실행부터 우선 사용됩니다.
6. 원격 서버로 이동하기 전 `/api/health`를 확인합니다.
7. CORS가 가능한 HTTPS 서버는 `GET /api/health` `200 OK`를 확인하고, 구버전 서버나 일부 WebView 환경은 `no-cors` fallback으로 접근 가능성만 확인합니다.
8. 런처가 `https://localhost`에서 실행되는 Android WebView 특성상 `http://` 개발 서버는 mixed-content fetch가 차단되므로 health probe를 건너뛰고 바로 이동합니다. 실패 시 native WebViewClient가 런처로 복귀시킵니다.
9. timeout, network, HTTP 4xx/5xx, SSL 오류는 런처로 되돌아와 원인별 안내와 재시도/변경 흐름을 제공합니다.
10. 앱 정보 영역에서 versionName, versionCode, package, device, Android version을 확인하고 앱을 재시작할 수 있습니다.

Tailscale Serve HTTPS 주소를 우선 사용합니다. 로컬 개발용 `http://` 접근은 manifest와 Capacitor 설정에서 허용하지만, 실사용은 HTTPS가 더 안정적입니다.

Capacitor Android의 `allowNavigation` wildcard는 domain label 개수를 정확히 맞춰야 합니다. Tailscale Serve 주소가 보통 `<machine>.<tailnet>.ts.net` 형태이므로 `capacitor.config.ts`에는 `*.ts.net`뿐 아니라 `*.*.ts.net`도 함께 허용합니다.

## Foreground Reconnect

Android WebView가 백그라운드로 들어가면 JavaScript timer와 네트워크 stack이 멈추면서 WebSocket 객체가 `OPEN` 상태로 남아도 실제 TCP 연결은 죽을 수 있습니다. 모바일 앱은 `visibilitychange`, `pagehide/pageshow`, `focus`, `online` 복귀 신호를 받으면 workspace/layout을 다시 동기화하고, 일정 시간 이상 hidden 상태였던 경우 terminal/status/timeline/sync WebSocket을 `readyState`와 관계없이 새로 연결합니다.

Native Android shell은 `MainActivity.onPause/onResume`에서 WebView로 `codexmux:native-app-state` event를 전달합니다. Android WebView가 표준 browser lifecycle event를 늦게 보내거나 누락해도 이 native event를 받은 React hook이 foreground 복귀 시 terminal/status/timeline/sync 연결을 강제로 새로 엽니다.

원격 `http://` 서버처럼 Capacitor bridge script가 주입되지 않는 페이지에서도 Android lifecycle은 Cordova compatibility `pause`/`resume` event를 보냅니다. 이때 `window.Capacitor.triggerEvent`가 없으면 console 예외가 발생하므로 native shell은 lifecycle event 전에 최소 fallback을 설치합니다. 이 fallback은 `triggerEvent`만 제공하고 전체 Capacitor plugin bridge를 흉내 내지 않습니다.
원격 페이지가 새로 로드되면 이전 JS global이 사라질 수 있으므로 WebView page load 완료 시점에도 같은 fallback을 다시 설치합니다.

Sync WebSocket은 연결이 새로 열릴 때도 workspace/layout을 즉시 재조회합니다. 서버 재시작이나 네트워크 복구 뒤 Android WebView가 열린 socket만 복구하고 초기 invalidation event를 놓치는 경우를 방지하기 위한 동작입니다.

foreground 복귀 직후에는 Android 네트워크 stack이 stale socket을 늦게 닫으면서 terminal/timeline WebSocket의 expected reconnect error가 짧게 발생할 수 있다. React reconnect hook은 foreground forced reconnect window 안의 expected connection error를 console error로 남기지 않고, 실제 UI 상태는 새 socket attach와 layout/status/timeline 재조회 결과로 판단한다.

로그인된 앱 surface에서 장시간 background에 들어가면 terminal/status/timeline/sync WebSocket과 retry timer를 native `codexmux:native-app-state` inactive 이벤트에서 멈춘다. foreground 복귀 시 `/api/health` readiness probe가 응답한 뒤 WebSocket을 다시 열어 Tailscale DNS가 아직 복구 중인 순간의 native WebSocket `ERR_NAME_NOT_RESOLVED` console noise를 피한다.

runtime v2 terminal WebSocket은 Terminal Worker 종료나 service restart 중 subscriber가
끊기면 retryable close로 다시 연결을 시도한다. 재시작 뒤 runtime v2 tmux session 자체가
사라져 `session-not-found`가 되면 모바일 복구 overlay의 재시작 버튼이 같은 tab/session을
runtime v2 supervisor에 다시 등록하고 터미널을 새로 만든다. 이때 전체 화면 복구 overlay가
우상단 reconnect 상태 버튼을 가리는 중복 UI는 숨긴다. 같은 presentation rule은 desktop
browser pane에도 적용된다.

로그인 화면처럼 인증 전 public route에서는 status/native notification/Web Push/service worker runtime service를 마운트하지 않는다. fresh install 또는 app data clear 후 `/login`에 도착했을 때 `/api/status` WebSocket auth 실패나 service worker registration console error가 생기지 않아야 한다. `/sw.js` 자체는 PWA/Web Push 설치용 static script라 인증 redirect 없이 내려온다.

서버가 내려주는 React 코드만 바뀌는 경우에는 APK 재배포가 필요 없습니다. Linux user service 운영에서는 `corepack pnpm deploy:local`로 build, service restart, health check를 수행하면 기존 Android 앱 WebView가 새 reconnect 로직을 받습니다. native bridge를 바꾸는 앱 정보/재시작 기능 변경은 debug/release APK를 다시 빌드해 기기에 설치해야 합니다.

## 2026-05-05 Timeline Foreground Smoke Result

2026-05-05 SM-S928N(Android 16) 실기기 기준:

| 항목 | 결과 |
| --- | --- |
| deploy `/api/health` | 200, `version=0.4.1`, `commit=d3248c4`, `buildTime=2026-05-05T07:46:55.160Z` |
| systemd 상태 | `ActiveState=active`, `SubState=running`, `NRestarts=0`, `ExecMainPID=678084` |
| Android timeline foreground | `corepack pnpm smoke:android:timeline-foreground`, `timelineV2Mode=default`, foreground 2회, `timeline:init totalEntries` 3/5/7, blocking console/logcat 0 |

## 2026-05-04 Smoke Result

2026-05-04 Android Auto 연결 상태의 SM-S928N(Android 16) 실기기 기준:

| 항목 | 결과 |
| --- | --- |
| live deploy `/api/health` | 200, `version=0.4.1`, `commit=23fee4b`, `buildTime=2026-05-04T12:34:34.682Z` |
| systemd 상태 | `ActiveState=active`, `SubState=running`, `NRestarts=0`, `MainPID=1405613` |
| debug install | `versionName=0.4.1`, `versionCode=401`, `lastUpdateTime=2026-05-04 21:35:16` |
| Android 60초 background | `CODEXMUX_ANDROID_BACKGROUND_MS=60000 CODEXMUX_ANDROID_FOREGROUND_ROUNDS=1 corepack pnpm smoke:android:foreground`, 로그인된 Tailscale HTTPS app surface, console 1, blocking console/logcat 0 |
| Android foreground reconnect | `corepack pnpm smoke:android:foreground`, 2회 background/foreground, console 0, blocking logcat 0 |
| Android Tailscale failure recovery | `corepack pnpm smoke:android:recovery`, network/http/ssl failure class별 app start, launcher 복귀와 저장 서버 재연결, blocking console/logcat 0 |
| Android runtime v2 foreground | `corepack pnpm smoke:android:runtime-v2`, temp server `http://100.112.40.104:15771`, initial + 2회 foreground `/api/v2/terminal` marker output, blocking console/logcat 0 |

React/server foreground reconnect 변경은 APK 재배포 없이 live server deploy로 반영되지만, `CodexmuxWebViewClient`의 main-frame failure recovery 변경은 native APK 재설치가 필요하다.

## 2026-05-03 Smoke Result

2026-05-03 P0/P1 자동화 pass 기준 Android 안정화 smoke 결과:

| 항목 | 결과 |
| --- | --- |
| Tailscale Serve HTTPS `/api/health` | 200, `version=0.3.3`, build metadata 포함 |
| `corepack pnpm smoke:android:foreground` | HTTPS 서버 접속 후 2회 background/foreground 복귀, `triggerEvent`/TypeError 0건, blocking console/logcat 0건 |
| `CODEXMUX_ANDROID_FOREGROUND_ROUNDS=0 CODEXMUX_ANDROID_RESTART_APP=1 corepack pnpm smoke:android:foreground` | Android app info bridge와 native restart 후 `/login` 복귀, console 0건, blocking logcat 0건 |
| `CODEXMUX_ANDROID_BACKGROUND_MS=60000 CODEXMUX_ANDROID_FOREGROUND_ROUNDS=1 corepack pnpm smoke:android:foreground` | `/login` surface에서 60초 background 후 foreground 복귀, console 0건, blocking logcat 0건 |
| `CODEXMUX_ANDROID_CLEAR_APP_DATA=1 CODEXMUX_ANDROID_FOREGROUND_ROUNDS=1 corepack pnpm smoke:android:foreground` | app data clear 후 `/login` 첫 실행, console event 0건, blocking logcat 0건 |
| `corepack pnpm smoke:android:recovery` | network, HTTP 4xx, SSL 실패 후 launcher 복귀와 `/login` 재연결, blocking console/logcat 0건 |
| `corepack pnpm smoke:android:runtime-v2` | SM-S928N Android 16, temp runtime v2 server `http://100.112.40.104:<port>`, initial + 2회 foreground `/api/v2/terminal` marker output, blocking console/logcat 0건 |
| logcat 오류 검색 | `Cannot read properties`, `triggerEvent`, terminal/timeline connection error 매칭 없음 |
| debug install | `versionName=0.3.3`, `versionCode=303`, `MainActivity` resolve |

`smoke:android:foreground`는 `CODEXMUX_ANDROID_BACKGROUND_MS`와 `CODEXMUX_ANDROID_FOREGROUND_ROUNDS`로 장시간/반복 강도를 늘릴 수 있고, `CODEXMUX_ANDROID_RESTART_APP=1`이면 `CodexmuxAndroid.restartApp()`까지 호출한다. 60초 로그인 app surface, native restart smoke, runtime v2 `/api/v2/terminal` foreground smoke는 통과했다. logged-in session의 수십 분 이상 background, iPad Safari/Home Screen은 다음 릴리스 gate에 남긴다.

## Runtime v2 Smoke

Android runtime v2 terminal smoke는 temp runtime v2 서버와 WebView foreground reconnect를 함께
확인한다. 이 항목은 React/server runtime 변경 검증이므로 native bridge를 바꾸지 않았다면
APK 재빌드는 필요 없다.

1. app-surface Phase 2 gate smoke를 먼저 실행한다. 이 명령은 temp HOME/DB 서버를
   직접 띄워 normal session cookie로 browser reload, server restart, mode-off rollback을
   확인한다.

```bash
corepack pnpm smoke:runtime-v2:phase2
```

2. 서버에서 runtime v2 terminal production-parity smoke도 통과시킨다.

```bash
corepack pnpm smoke:runtime-v2
```

3. Android WebView foreground smoke를 실행한다. 이 명령은 temp HOME/DB 서버를
   `HOST=localhost,tailscale`과 runtime v2 new-tabs mode로 띄우고, Android 기기가 접근할
   Tailscale IP URL을 만든다. WebView에는 normal session cookie를 주입하고
   `/api/v2/terminal` marker output을 initial attach와 기본 2회 foreground reconnect에서 확인한다.
   원격 page load 직후 native bridge fallback이 늦게 보일 수 있으므로 smoke는
   `window.Capacitor.triggerEvent`와 `CodexmuxAndroid` bridge가 준비될 때까지 기다린다.

```bash
corepack pnpm smoke:android:runtime-v2
```

4. 필요하면 강도를 올린다.

```bash
CODEXMUX_ANDROID_RUNTIME_V2_FOREGROUND_ROUNDS=4 CODEXMUX_ANDROID_RUNTIME_V2_BACKGROUND_MS=30000 corepack pnpm smoke:android:runtime-v2
```

5. `CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=off`로 서버를 재시작하면 새 plain terminal tab은
   legacy로 생성되고 기존 v2 tab은 삭제되지 않으며 runtime v2 disabled diagnostic을 표시하는지 확인한다.

이 smoke는 `/api/v2/terminal` fresh attach, existing-cookie auth, Android foreground reconnect 정책을 확인한다.
Terminal Worker crash 후 stdout replay는 runtime v2 범위에 아직 포함하지 않는다. Worker
exit 자체는 retryable close 뒤 fresh `/api/v2/terminal` attach로 복구해야 하며, session이
사라진 경우에는 runtime v2 tab restart 경로로 같은 tab/session을 재생성한다.

`smoke:android:runtime-v2`와 다른 temp-server smoke를 같은 checkout에서 병렬 실행하면
Next dev lock 때문에 서버 startup이 실패할 수 있다. Android device를 쓰는 smoke는 특히
단독 실행을 기준으로 한다.

## Failure Handling

| 실패 유형 | 처리 |
| --- | --- |
| timeout | 8초 안에 `/api/health` 응답이 없으면 저장 URL을 유지한 채 재시도/변경 버튼을 표시 |
| network | DNS, Tailscale 연결, 서버 미실행처럼 네트워크 연결 자체가 실패하면 런처로 복귀 |
| HTTP dev server | `https://localhost` 런처에서 `http://` 서버로 붙을 때는 mixed-content probe를 피하고 main-frame navigation으로 검증 |
| missing Capacitor bridge | 원격 페이지에 Capacitor bridge가 없어도 native lifecycle fallback이 `pause`/`resume` event 예외를 막음 |
| HTTP | main-frame HTTP status `>=400`이면 native WebViewClient가 런처로 복귀 |
| SSL | 인증서 또는 HTTPS 오류는 WebView load를 취소하고 런처로 복귀 |
| old server | CORS header가 없는 구버전 서버는 `no-cors` probe fallback 후 접속 시도 |

서버의 `/api/health`는 Android launcher probe를 위해 다음 CORS header를 반환합니다.

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

응답 body에는 `app`, `version`, `commit`, `buildTime`이 포함됩니다. Android 런처는 연결 가능성만 확인하고, React 모바일 앱 정보 화면은 서버 버전을 표시할 때 이 metadata를 사용합니다.

## Build Output

Debug APK:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

기기 설치 확인:

```bash
~/Android/Sdk/platform-tools/adb devices -l
~/Android/Sdk/platform-tools/adb shell pm path com.hardcoremonk.codexmux
~/Android/Sdk/platform-tools/adb shell dumpsys package com.hardcoremonk.codexmux | rg "versionName|versionCode|lastUpdateTime|Package \\["
~/Android/Sdk/platform-tools/adb shell cmd package resolve-activity --brief com.hardcoremonk.codexmux
```

동일한 확인은 다음 smoke script로도 실행할 수 있습니다.

```bash
corepack pnpm smoke:android:install
corepack pnpm smoke:android:foreground
corepack pnpm smoke:android:recovery
corepack pnpm smoke:android:runtime-v2
corepack pnpm smoke:android:timeline-foreground
CODEXMUX_ANDROID_RESTART_APP=1 CODEXMUX_ANDROID_FOREGROUND_ROUNDS=0 corepack pnpm smoke:android:foreground
```

`smoke:android:timeline-foreground`는 임시 Tailscale IP/port target을 사용하므로 종료 cleanup에서
`CODEXMUX_ANDROID_RESTORE_URL` 또는 기본 Tailscale Serve URL로 WebView를 되돌리고,
해당 origin의 `readyState=complete`를 확인하지 못하면 실패합니다.

정상 설치 시 `pm path`는 `/data/app/.../base.apk`를 반환하고, launcher activity는 `com.hardcoremonk.codexmux/.MainActivity`로 resolve됩니다.

현재 `0.4.15` debug install은 `dumpsys package`에서 `versionName=0.4.15`, `versionCode=415`로 보여야 합니다.

Signed release APK:

```text
android/app/build/outputs/apk/release/app-release.apk
```

Signed release AAB:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

Release AAB 운영 순서:

```bash
corepack pnpm android:keystore
corepack pnpm android:bundle:release
corepack pnpm smoke:android:release-aab
```

`android/release.keystore`와 `android/keystore.properties`는 로컬 비밀 파일이며 git에 커밋하지 않습니다. 새 환경에서는 `corepack pnpm android:keystore`로 생성하거나 기존 keystore를 복원합니다. 두 파일은 git ignore 상태여야 하고 권한은 `600`이어야 합니다. `android:keystore`는 기존 파일을 덮어쓰지 않으며, 기존/신규 secret file 권한을 `600`으로 보정합니다.

`smoke:android:release-aab`는 secret 값을 출력하지 않고 다음만 검증합니다.

- `android/release.keystore`와 `android/keystore.properties` 존재, git ignore, `600` 권한.
- `android/app/build/outputs/bundle/release/app-release.aab`가 Android release input보다 새로움.
- AAB에 `BundleConfig.pb`, base manifest, dex, launcher asset, native bridge, JAR manifest가 포함됨.
- `jarsigner -verify`가 release AAB signature를 검증함.

2026-05-05 로컬 release signing/AAB smoke 기준 `corepack pnpm android:bundle:release`는 `BUILD SUCCESSFUL`, `corepack pnpm smoke:android:release-aab`는 `expectedVersionName=0.4.1`, `expectedVersionCode=401`, AAB size `3030142` bytes로 통과했습니다.
