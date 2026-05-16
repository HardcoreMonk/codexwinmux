# Core/Backend 100% Physical Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend API host와 Core Engine을 독립 lifecycle/process boundary로 분리해, service 재시작/업그레이드/장애 격리가 가능한 100% 분리 상태를 만든다.

**Architecture:** 현재 runtime v2 논리 분리와 worker process 경계는 유지한다. 다음 단계는 `codexwinmux.exe --codexwinmux-core` core host를 추가하고, Backend는 HTTP/API/WebSocket adapter와 Core client만 소유하도록 줄인다. Windows Service는 단기적으로 Backend/Core combined engine을 계속 실행하되, split smoke가 닫힌 뒤 `codexwinmux-backend`와 `codexwinmux-core` service option으로 승격한다.

**Tech Stack:** TypeScript, Electron, Windows Service/WinSW, Node child process IPC, runtime v2 worker Supervisor, Vitest, existing Windows/runtime smoke scripts.

---

## 현재 판정

- 논리 분리: 완료. `docs/operations/2026-05-16-core-backend-logical-separation-100.md` 기준 runtime v2가 terminal/storage/timeline/status/source-of-truth를 소유한다.
- Worker process 경계: 완료. `storage-worker`, `terminal-worker`, `timeline-worker`, `status-worker`가 `RuntimeWorkerClient`를 통해 별도 child process로 실행된다.
- Windows service owner: 1차 완료. WinSW wrapper가 `codexwinmux.exe --codexwinmux-engine`을 service-owned engine으로 실행한다.
- Core process host foundation: 완료. `codexwinmux.exe --codexwinmux-core`와 `dist/workers/core-engine-host.js`가 BrowserWindow/UI lock 없이 runtime Supervisor/workers를 시작하고 Core protocol에 응답한다.
- 엄격한 Core/Backend process 분리: 미완료. 현재 default/service process tree는 `codexwinmux-service.exe -> codexwinmux.exe --codexwinmux-engine -> runtime workers`이며, Backend API host와 Core Supervisor가 같은 combined engine process 안에 있다. Backend API/WebSocket Core client adapter 전환과 split lifecycle smoke는 P3 이후 범위다.
- Live evidence: `smoke:runtime-v2:phase6-default-gate`가 local service target에서 terminal `new-tabs`, storage/timeline/status `default`, worker diagnostics clean으로 통과했다.

## 100% 완료 기준

1. Backend process는 HTTP/API/WebSocket, auth, static/app shell, Core client, health aggregation만 소유한다.
2. Core process는 runtime Supervisor, storage/terminal/timeline/status worker lifecycle, runtime DB, terminal adapter, status/timeline live bridge를 소유한다.
3. Backend와 Core 사이의 모든 호출은 typed command/event protocol을 통과한다. Backend에서 runtime worker service나 storage repository를 직접 import하지 않는다.
4. Core process 단독 health, restart, shutdown, worker diagnostics, graceful drain이 가능하다.
5. Backend restart가 Core runtime session을 죽이지 않고, Core restart가 Backend shell을 죽이지 않는 smoke가 있다.
6. Windows service/runbook은 combined mode와 split mode를 모두 지원하며, split mode는 기본 off에서 시작한다.
7. Release gate는 split-mode package smoke, service restart smoke, runtime Phase 6 gate를 포함한다.

## 우선순위

### P0: 100% 범위 고정

**목표:** "논리 분리 완료"와 "물리/process 분리 완료"를 문서와 gate에서 분리한다.

**Files:**
- Modify: `docs/operations/2026-05-16-core-backend-logical-separation-100.md`
- Modify: `docs/operations/2026-05-16-windows-service-owner-phase2.md`
- Modify: `docs/ADR.md`

- [x] `logical separation complete`는 완료로 유지하고, `physical process separation`은 별도 milestone으로 표기한다.
- [x] ADR에 Backend/Core physical boundary의 decision trigger를 추가한다.
- [x] 기존 service owner 문서의 "Backend/Core Engine" 표현을 combined engine으로 명확히 바꾼다.
- [x] 검증: `corepack pnpm lint`.

### P1: Core protocol contract 추출

**목표:** Backend가 Core에 요청할 수 있는 명령과 이벤트를 runtime worker IPC와 독립된 public Core contract로 정의한다.

**Files:**
- Create: `src/lib/core-engine/contracts.ts`
- Create: `src/lib/core-engine/client.ts`
- Create: `src/lib/core-engine/server.ts`
- Test: `tests/unit/lib/core-engine/contracts.test.ts`

- [x] `core.health`, `core.runtime.phase6`, `core.workspace.*`, `core.layout.*`, `core.terminal.*`, `core.timeline.*`, `core.status.*` command namespace를 정의한다.
- [x] zod/parser 기반 payload validation을 추가한다.
- [x] client는 timeout, retryable error, request id, event id를 보존한다.
- [x] server는 existing runtime Supervisor boundary를 thin adapter로 호출한다.
- [x] 검증: `corepack pnpm test tests/unit/lib/core-engine/contracts.test.ts`.

**P1 evidence:**

- RED: `corepack pnpm test tests/unit/lib/core-engine/contracts.test.ts` failed because `@/lib/core-engine/contracts` did not exist.
- GREEN: `corepack pnpm test tests/unit/lib/core-engine/contracts.test.ts`: 7 tests passed.
- Focused regression: `corepack pnpm test tests/unit/lib/core-engine/contracts.test.ts tests/unit/lib/runtime/ipc.test.ts`: 19 tests passed.
- `corepack pnpm tsc --noEmit`: passed.
- `corepack pnpm lint`: passed.
- `git diff --check`: passed.

### P2: Core process host 추가

**목표:** `codexwinmux.exe --codexwinmux-core` 또는 Node packaged worker script로 Core Engine을 단독 실행한다.

**Files:**
- Modify: `electron/engine-process.ts`
- Modify: `electron/main.ts`
- Create: `electron/core-process.ts`
- Create: `src/workers/core-engine-host.ts`
- Test: `tests/unit/electron/engine-process.test.ts`
- Test: `tests/unit/lib/core-engine/process-host.test.ts`

- [x] `--codexwinmux-core` CLI flag를 추가한다.
- [x] core host는 BrowserWindow를 만들지 않고 single-instance UI lock을 잡지 않는다.
- [x] core host는 runtime Supervisor와 runtime workers를 시작하고 `core.health`에 응답한다.
- [x] graceful shutdown에서 terminal/timeline/status subscribers를 정리한다.
- [x] 검증: `corepack pnpm test tests/unit/electron/engine-process.test.ts tests/unit/lib/core-engine/process-host.test.ts`.

**P2 evidence:**

- RED: `corepack pnpm test tests/unit/electron/engine-process.test.ts tests/unit/lib/core-engine/process-host.test.ts` failed because core launch helpers and `@/lib/core-engine/process-host` did not exist.
- GREEN: `corepack pnpm test tests/unit/electron/engine-process.test.ts tests/unit/lib/core-engine/process-host.test.ts`: 12 tests passed.
- Type/lint regression: `corepack pnpm tsc --noEmit` passed, `corepack pnpm lint` passed.
- Bundle regression: `corepack pnpm build:server` produced `dist/workers/core-engine-host.js`; `corepack pnpm build:electron:main` produced `dist-electron/main.js`.
- 운영 기본값: P2는 `--codexwinmux-core` standalone host를 추가하지만, Windows service와 UI 기본 실행은 아직 combined engine mode를 유지한다. Backend API/WebSocket Core client 전환은 P3 범위다.

### P3: Backend를 Core client adapter로 축소

**목표:** API route와 WebSocket handler가 runtime Supervisor를 직접 소유하지 않고 Core client만 호출하도록 전환한다.

**Files:**
- Modify: `server.ts`
- Modify: `src/pages/api/v2/**`
- Modify: `src/pages/api/timeline/**`
- Modify: `src/pages/api/status/**`
- Modify: `src/pages/api/layout/**`
- Modify: `src/pages/api/cli/**`
- Test: existing API route tests under `tests/unit/pages/**`

- [x] Backend startup에서 Core client를 초기화한다.
- [x] `/api/v2/runtime/health`는 Core health를 aggregate한다.
- [x] `/api/v2/terminal` WebSocket attach/write/resize/detach는 Core client를 통과한다.
- [x] legacy URL은 유지하되 runtime default path에서는 Core client를 통과한다.
- [x] import policy test를 추가해 `src/pages/api/**`가 `src/lib/runtime/*worker*` service를 직접 import하지 못하게 한다.
- [x] 검증: `corepack pnpm test tests/unit/pages/runtime-v2-api.test.ts tests/unit/pages/runtime-direct-import-policy.test.ts tests/unit/pages`.

### P4: Windows service split-mode runbook

**목표:** 현재 `LocalSystem + runbook-first` 운영 모델을 유지하면서 split-mode를 default off로 추가한다.

**Files:**
- Modify: `scripts/windows-service.ps1`
- Modify: `src/lib/windows-service-host.ts`
- Modify: `scripts/smoke-windows-service-host.ts`
- Test: `tests/unit/lib/windows-service-host.test.ts`

- [x] combined mode는 현재 `codexwinmux` service를 유지한다.
- [x] split mode는 `codexwinmux-backend`, `codexwinmux-core` service plan을 dry-run으로 생성한다.
- [x] `windows:service:*` script는 기본 combined mode로 유지한다.
- [x] split mode helper는 `-Mode split -Action write-config|install|start|status|health|stop|uninstall`로만 접근한다.
- [x] split mode helper는 Backend/Core 양쪽에 `CODEXWINMUX_CORE_ENGINE_TRANSPORT=tcp`와 loopback attach env를 기록한다.
- [x] 검증: `corepack pnpm test tests/unit/lib/windows-service-host.test.ts`와 `corepack pnpm smoke:windows:service-host`.

### P5: Lifecycle smoke

**목표:** Backend/Core restart 독립성을 자동 증거로 닫는다.

**Files:**
- Create: `scripts/smoke-windows-core-backend-split-lifecycle.mjs`
- Create: `tests/unit/scripts/windows-core-backend-split-lifecycle-lib.test.ts`
- Modify: `package.json`
- Modify: `docs/TESTING.md`

- [x] Core 먼저 시작, Backend attach, runtime Phase 6 health 확인.
- [x] Backend restart 후 Core worker counters/session health 유지 확인.
- [x] Core restart 후 Backend health degrade/recover 확인.
- [x] Stop ordering과 cleanup을 검증한다.
- [x] 검증: `corepack pnpm smoke:windows:core-backend-split-lifecycle`.

### P6: Packaging and release gate

**목표:** split-mode가 release artifact에서 실제 동작한다는 evidence를 추가한다.

**Files:**
- Modify: `scripts/windows-package-gate-lib.mjs`
- Modify: `scripts/smoke-windows-package-gate.mjs`
- Modify: `docs/ELECTRON.md`
- Modify: `docs/WINDOWS-ONLY-GAP-AUDIT.md`

- [x] Windows packaged output에서 standalone Core IPC, Backend external Core attach, split lifecycle dry-run, installer runtime v2를 package gate에 포함한다.
- [x] NSIS service install option은 계속 default off로 둔다.
- [x] 내부 release gate는 signed/local package + standalone Core IPC + Backend external Core attach + split lifecycle smoke + Phase 6 gate를 요구한다.
- [x] 검증: `node scripts/pack-electron-windows.mjs`, `node scripts/smoke-windows-package-gate.mjs`, `node scripts/smoke-windows-core-backend-split-lifecycle.mjs`, 실제 설치 경로 `smoke-windows-packaged-launch.mjs`.

### P7: Legacy fallback and direct import cleanup

**목표:** split-mode가 안정화된 뒤 Backend direct runtime fallback을 제거한다.

**Files:**
- Modify: `src/lib/runtime/**`
- Modify: `src/pages/api/**`
- Modify: `tests/unit/scripts/runtime-env-namespace-policy.test.ts`
- Modify: `docs/RUNTIME-V2-CUTOVER.md`

- [x] Backend process에서 runtime Supervisor singleton을 생성하는 fallback을 제거한다.
- [x] Core unavailable 상태는 typed `core-unavailable`/`core-timeout` error로 fail closed한다.
- [x] Legacy JSON fallback은 rollback mode에서만 남긴다.
- [x] 검증: Backend/API direct import policy, 실제 설치 경로 runtime v2 launch, split stability hold, `smoke:windows:package-gate`.

**2026-05-16 보류:** combined Windows service의 in-process Core client fallback은 split
service default-on 승격 전까지 유지한다. 이 fallback은 legacy JSON fallback이 아니라
기본 운영 process topology 보호 장치이며, default-on 승격과 장시간 운영 evidence가 추가된
뒤 제거한다.

## 실행 순서

1. P0-P1: 설계와 contract test를 먼저 닫는다.
2. P2: Core process host를 추가하되 production default는 combined mode로 유지한다.
3. P3: Backend API path를 Core client adapter로 점진 전환한다.
4. P4-P5: Windows split service/runbook과 lifecycle smoke를 닫는다.
5. P6: packaged artifact evidence를 release gate에 넣는다.
6. P7: split-mode evidence가 안정화된 뒤 fallback/direct import를 제거한다.

## 중단 조건

- runtime Phase 6 default gate가 실패하면 P3 이후 작업을 중단한다.
- Backend restart가 Core session을 죽이면 P5 이전으로 rollback한다.
- Core process crash가 Backend process까지 종료시키면 process boundary 설계를 재검토한다.
- split-mode service install이 LocalSystem profile/data dir 혼선을 만들면 전용 service account slice를 P4 앞에 올린다.
