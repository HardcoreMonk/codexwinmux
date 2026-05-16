# Rust + Tauri 도입 타당성 보고서

조사일: 2026-04-30

## 결론

현재 codexmux에는 Rust + Tauri 전면 도입을 권장하지 않는다.

권장안은 다음과 같다.

| 범위 | 도입 판단 | 이유 |
| --- | --- | --- |
| Electron 대체 Tauri desktop shell | 제한적 PoC만 승인 | installer 크기와 Electron shell 메모리는 줄 수 있지만, codexmux 핵심 Node server와 `node-pty`/tmux 구조는 그대로 남는다. |
| Rust로 server/terminal/timeline 재작성 | 보류 | Next.js Pages Router, custom Node server, WebSocket, `node-pty`, tmux, JSONL watcher, auth/store를 동시에 재작성해야 해 리스크가 크다. |
| Android Capacitor 대체 | 보류 | Android 앱은 원격 codexmux 서버에 붙는 WebView shell이다. Tauri mobile을 써도 Android 기기에서 Codex/tmux를 직접 실행하는 구조가 아니므로 현재 문제를 직접 줄이지 못한다. |
| 독립 Rust helper 도입 | 필요할 때만 | CPU-bound parser, log compaction처럼 명확한 병목이 확인된 작은 모듈에 한해 별도 검토한다. |

즉, Tauri는 "Electron shell 경량화 후보"로만 다루고, 제품 아키텍처의 기본 축은 유지한다.

## 현재 구조 요약

codexwinmux의 핵심 런타임은 TypeScript/Node.js다.

| 영역 | 현재 구현 | Tauri 영향 |
| --- | --- | --- |
| UI | Next.js Pages Router, React, Tailwind | Tauri WebView에 띄울 수는 있음 |
| Server | `server.ts` custom Node server | 그대로 유지하거나 Rust로 대규모 재작성 필요 |
| Terminal | `src/lib/terminal-server.ts`의 `node-pty` + tmux attach | Tauri만으로 대체되지 않음 |
| Desktop | Electron `BrowserWindow` + local/remote server mode | Tauri shell 대체 가능 후보 |
| Android | Capacitor WebView launcher | Tauri mobile로 바꿔도 서버 의존 구조는 동일 |
| Packaging | Electron builder, Next standalone, `node-pty` native binary | Tauri sidecar를 쓰면 target별 외부 binary 관리 필요 |

Electron 앱은 `docs/ELECTRON.md` 기준으로 local mode에서 내부 codexmux 서버를 시작하고, remote mode에서는 이미 떠 있는 서버 URL로 연결한다. 이 동작을 Tauri에서 그대로 유지하려면 Node server를 sidecar로 묶거나, Rust core가 server 역할을 다시 구현해야 한다.

## Tauri 공식 특성

Tauri는 Rust core process와 OS WebView process를 조합한다. 공식 문서 기준으로 core process는 window, tray, notification, IPC, global state를 관리하고, UI는 OS 제공 WebView에서 HTML/CSS/JavaScript로 실행된다. WebView는 앱에 번들되지 않고 런타임에 동적으로 연결되므로 앱 크기는 작아질 수 있지만, 플랫폼별 WebView 차이를 감수해야 한다.

렌더링 엔진은 다음처럼 플랫폼에 의존한다.

| 플랫폼 | WebView |
| --- | --- |
| Windows | Microsoft Edge WebView2 |
| macOS/iOS | WKWebView |
| Linux | WebKitGTK |

Tauri는 sidecar 방식으로 외부 executable을 앱에 묶을 수 있다. 다만 `externalBin`에 등록한 binary는 target triple suffix를 붙여 target별로 준비해야 한다. codexmux처럼 Node server와 native dependency가 있는 앱은 이 관리 비용이 작지 않다.

Tauri v2는 capability/permission 시스템으로 WebView가 core/plugin command에 접근할 수 있는 범위를 제한한다. remote URL에 local system 권한을 주는 구성은 보안상 별도 검토가 필요하다. CSP도 설정할 수 있지만, Tauri 문서 자체가 remote content와 CDN script 로딩을 공격면으로 보고 제한적인 CSP를 권장한다.

## 기대 효과

### 1. Desktop installer 크기 감소 가능

Electron은 Chromium/Node runtime을 포함한다. Tauri는 OS WebView를 사용하므로 shell 자체의 bundle size는 줄어들 가능성이 높다.

다만 codexmux가 local desktop mode를 유지하려면 다음 중 하나가 필요하다.

- Node runtime + Next standalone + `dist/server.js` + `node-pty` native binary를 sidecar로 번들
- 사용자가 별도 codexmux server를 실행하고 Tauri 앱은 remote-only shell로 동작
- server/terminal/timeline/status를 Rust로 재작성

첫 번째는 Electron 대비 절감폭이 줄어든다. 두 번째는 현재 Electron local mode와 기능 차이가 생긴다. 세 번째는 리스크가 가장 크다.

### 2. Native shell attack surface 축소 가능

Tauri의 capability model은 native command 노출 범위를 더 명시적으로 관리하게 만든다. remote-only shell로 쓰고 Tauri API를 거의 노출하지 않으면 desktop shell의 권한면은 단순해질 수 있다.

하지만 codexwinmux는 이미 terminal byte stream, auth cookie, WebSocket, local server가 핵심 보안면이다. shell만 바꿔도 server-side 위험은 그대로 남는다.

### 3. Rust 도입 학습 효과

Rust는 process supervision, small helper, packaging automation에는 강점이 있다. 하지만 현재 성능 병목이 Rust로 명확히 해결되는 상태는 아니다. 최근 이슈의 핵심은 message 중복, JSONL attach, mobile foreground reconnect, workspace metadata처럼 상태/연결성 로직이었다.

## 주요 리스크

### 1. Node server가 사라지지 않는다

codexwinmux의 server는 Next.js Pages Router, custom WebSocket upgrade, auth/session cookie, runtime worker supervision, workspace store, timeline/status bridge를 하나로 묶고 있다. Rust + Tauri로 shell을 바꿔도 이 로직은 계속 Node에서 돈다.

Rust로 재작성하려면 다음을 모두 다시 설계해야 한다.

- Next.js SSR/standalone proxy 또는 정적 asset 전략
- `/api/terminal`, `/api/timeline`, `/api/status`, `/api/sync`, `/api/install` WebSocket
- tmux session lifecycle과 terminal resize/backpressure
- Codex JSONL parser, stable id, near-duplicate 제거
- `~/.codexwinmux/` 저장소와 `globalThis` shared singleton 대체
- auth/session cookie와 Web Push/notification 정책

이 범위는 desktop shell 교체가 아니라 제품 core rewrite다.

### 2. WebView 일관성 리스크

Electron은 Chromium을 같이 배포하므로 rendering/runtime 차이가 비교적 작다. Tauri는 OS WebView를 사용한다. codexwinmux는 xterm.js, WebSocket, IME/keyboard, mobile/desktop responsive UI, Korean typography, terminal font fallback에 민감하다. macOS WKWebView, Linux WebKitGTK, Windows WebView2에서 모두 같은 품질을 보장해야 한다.

### 3. Linux 배포 의존성 증가

Tauri Linux 개발/배포에는 WebKitGTK, appindicator, xdo, OpenSSL 계열 system dependency가 필요하다. codexwinmux는 이미 runtime workers, tmux adapter, Node native module 의존성이 있으므로, Tauri가 Linux 운영 복잡도를 낮춘다고 보기 어렵다.

### 4. Sidecar packaging 복잡도

Tauri sidecar는 target triple별 binary 준비가 필요하다. codexwinmux는 단순 single binary가 아니라 Next standalone, custom server bundle, runtime worker bundle, native `node-pty`, static assets가 결합된다. macOS signing/notarization, Linux package, Windows installer를 모두 운영하려면 현재 Electron packaging 문제와 다른 형태의 packaging 문제가 생긴다.

### 5. Remote URL 보안 설계

Tauri capability는 local bundled frontend를 기본 전제로 설계되어 있다. codexwinmux의 Electron/Android는 remote server URL에 붙는 모드를 지원한다. Tauri remote window가 local command 권한을 갖게 되면 위험하므로, remote mode에서는 Tauri command/plugin 권한을 최소화하거나 아예 노출하지 않는 별도 capability가 필요하다.

## 도입 시나리오 평가

### A. Tauri remote-only desktop shell

Tauri 앱이 저장된 codexmux server URL만 열고, local server는 시작하지 않는다.

| 항목 | 평가 |
| --- | --- |
| 구현 난이도 | 낮음 |
| 기능 차이 | Electron local mode 없음 |
| 이점 | shell 크기 감소, 단순한 native wrapper |
| 리스크 | remote-only 제품이 되어 desktop app 기대와 다를 수 있음 |
| 판단 | PoC 가능, production 대체는 보류 |

이 방식은 Android Capacitor launcher와 비슷한 역할이다. desktop app이 "서버 접속기"여도 충분하다는 제품 판단이 먼저 필요하다.

### B. Tauri + Node sidecar

Tauri가 Node/codexmux server sidecar를 실행하고 WebView는 `localhost`에 접속한다.

| 항목 | 평가 |
| --- | --- |
| 구현 난이도 | 중간 |
| 기능 차이 | Electron local mode와 가장 가까움 |
| 이점 | Chromium bundle 제거 가능 |
| 리스크 | Node runtime, Next standalone, `node-pty` native binary, target별 sidecar 관리 |
| 판단 | 제한적 PoC 가능, packaging 검증 전 도입 금지 |

이 방식은 가장 현실적인 Tauri desktop 대체 경로지만, packaging과 update 흐름을 실제로 검증해야 한다.

### C. Rust core rewrite

Node server, terminal server, timeline/status/sync를 Rust로 재작성한다.

| 항목 | 평가 |
| --- | --- |
| 구현 난이도 | 매우 높음 |
| 기능 차이 | 대규모 regression 위험 |
| 이점 | 장기적으로 single native core 가능 |
| 리스크 | Next.js/SSR, WebSocket, tmux, JSONL parser, auth/store 재구현 |
| 판단 | 도입하지 않음 |

현재 제품 안정성과 개발 속도 기준에서 타당하지 않다.

### D. Android를 Tauri mobile로 교체

Capacitor Android shell을 Tauri mobile로 바꾼다.

| 항목 | 평가 |
| --- | --- |
| 구현 난이도 | 중간 이상 |
| 기능 차이 | 기존 Android launcher/실패 복구/앱 정보/앱 재시작 재구현 필요 |
| 이점 | Rust/Tauri stack 통일 가능 |
| 리스크 | 현재 Android 문제는 server-provided React reconnect로 해결되는 구조 |
| 판단 | 도입하지 않음 |

Tauri mobile은 Android/iOS target을 지원하지만, codexmux 모바일 앱은 Codex/tmux 실행기가 아니라 원격 WebView shell이다. 현재 구조에서는 Capacitor를 유지하는 편이 낫다.

## 의사결정 기준

Tauri PoC를 승인하려면 먼저 다음 기준을 정한다.

| 질문 | 통과 기준 |
| --- | --- |
| 왜 Tauri인가 | installer 크기, auto-update, native menu, memory 중 하나 이상의 실측 목표가 있어야 함 |
| local server mode가 필요한가 | 필요하면 sidecar 검증, 아니면 remote-only shell로 범위 축소 |
| WebView 호환성이 충분한가 | xterm.js, IME, `Ctrl+D`, WebSocket reconnect, Korean font rendering smoke test 통과 |
| 보안 모델이 명확한가 | remote URL에는 local Tauri command 권한을 주지 않거나 최소 capability만 허용 |
| 유지보수 비용을 감당하는가 | Rust toolchain, target별 bundle, signing/notarization, Linux WebKitGTK dependency 문서화 |

## 권장 PoC 범위

전면 도입 전에 2-3일짜리 spike로 제한한다.

1. `src-tauri/`를 별도 실험 branch에 추가한다.
2. remote-only shell부터 만든다.
3. Tauri API capability는 `core:window` 수준으로 최소화한다.
4. 저장 서버 URL, 최근 서버, 연결 실패 복구만 구현한다.
5. 다음 smoke test를 통과해야 한다.

| 항목 | 테스트 |
| --- | --- |
| Terminal | xterm 출력, resize, paste, `Ctrl+D` EOF |
| WebSocket | terminal/status/timeline/sync 연결과 foreground 복귀 |
| Timeline | JSONL attach 지연, 중복 assistant message 제거 |
| UI | Korean typography, focus-visible, mobile-like narrow width |
| Packaging | macOS app, Linux AppImage/deb 중 하나, Windows는 별도 backlog |
| 보안 | remote origin에서 Tauri command 접근 차단 |

sidecar local mode는 remote-only PoC가 충분한 이득을 보인 뒤 검토한다.

## 현재 결정

현재 기준선은 다음으로 둔다.

- Electron은 유지한다.
- Capacitor Android는 유지한다.
- Rust/Tauri 전면 도입은 하지 않는다.
- Tauri는 desktop shell 경량화 실험으로만 관리한다.
- PoC가 실측 이득을 보이지 못하면 폐기한다.

이 판단은 아키텍처 결정으로 확정된 것이 아니라 도입 타당성 평가다. 실제 도입을 승인하면 `ADR.md`, `ELECTRON.md`, `ANDROID.md`, `ARCHITECTURE-LOGIC.md`, `README.md`를 함께 갱신한다.

## 참고 자료

- Tauri Process Model: <https://v2.tauri.app/concept/process-model/>
- Tauri WebView Versions: <https://v2.tauri.app/reference/webview-versions/>
- Tauri Prerequisites: <https://v2.tauri.app/start/prerequisites/>
- Tauri Sidecar: <https://tauri.app/develop/sidecar/>
- Tauri Capabilities: <https://v2.tauri.app/security/capabilities/>
- Tauri CSP: <https://v2.tauri.app/security/csp/>
- codexmux Electron 기준: `docs/ELECTRON.md`
- codexmux Android 기준: `docs/ANDROID.md`
- codexmux service flow: `docs/ARCHITECTURE-LOGIC.md`
