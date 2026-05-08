# Windows Engine Lifecycle Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the Windows Electron UI shell lifecycle from the local backend/core engine lifecycle so closing the window no longer stops the service.

**Architecture:** Add a testable Electron-side Engine Host Controller that probes `127.0.0.1:8121`, starts an owned engine process only when no healthy codexmux engine exists, and refuses to stop unrelated processes. Update `electron/main.ts` to use tray-first behavior: window close hides to tray, explicit menu/tray actions control UI quit and owned engine stop.

**Tech Stack:** TypeScript, Electron, Node child process, Vitest, existing Windows smoke scripts.

---

## File Structure

- Create: `electron/engine-controller.ts`
- Modify: `electron/main.ts`
- Test: `tests/unit/electron/engine-controller.test.ts`
- Modify: `docs/ELECTRON.md`
- Modify: `docs/WINDOWS-ONLY-GAP-AUDIT.md`
- Modify: `docs/superpowers/specs/2026-05-08-windows-engine-lifecycle-separation-design.md`

## Task 1: Engine Controller

- [x] Add a pure controller module that can probe `/api/health`, distinguish codexmux from unrelated port occupants, launch an owned engine process, wait for readiness, stop only the owned engine, and restart only owned engines.
- [x] Add unit tests for attach-existing, start-missing, refuse-unrelated-stop, refuse-unrelated-port, and restart-owned behavior.

## Task 2: Electron Shell Host Integration

- [x] Update `electron/main.ts` so local mode calls `ensureEngineRunning()` instead of importing and owning the server in the UI process.
- [x] Add engine-only process bootstrap using the same packaged executable with `CODEXMUX_ELECTRON_ENGINE_PROCESS=1`.
- [x] Skip single-instance UI behavior in engine-only process.
- [x] Keep backend/core server on fixed `127.0.0.1:8121`; do not silently fall back to a random product port for engine host mode.

## Task 3: Tray-first Lifecycle

- [x] Add a tray menu with open window, restart engine, stop engine, quit UI, and quit UI and stop engine actions.
- [x] Change window close to hide the window instead of shutting down the engine.
- [x] Make app quit leave the owned engine running unless the explicit quit-and-stop path was selected.

## Task 4: Documentation

- [x] Update Electron docs with tray-first engine lifecycle behavior and explicit commands.
- [x] Update Windows gap audit with the lifecycle separation slice status.
- [x] Mark this plan and spec as implementation-completed once verified.

## Task 5: Verification

- [x] Run focused unit tests:

```bash
corepack pnpm test tests/unit/electron/engine-controller.test.ts tests/unit/electron/runtime-env.test.ts
```

- [x] Run TypeScript and lint:

```bash
corepack pnpm tsc --noEmit
corepack pnpm lint
```

- [x] Run relevant Windows host tests:

```bash
corepack pnpm test tests/unit/lib/windows-service-host.test.ts tests/unit/scripts/windows-packaged-launch-smoke-lib.test.ts
```

- [x] Run full unit suite if focused checks pass:

```bash
corepack pnpm test
```

- [x] Run Electron build and script syntax checks:

```bash
node --check scripts/smoke-windows-packaged-launch.mjs
node --check scripts/windows-package-smoke-artifact-lib.mjs
node --check scripts/windows-package-gate-lib.mjs
corepack pnpm build:electron
```

- [x] Run current Windows unpacked package smoke:

```bash
corepack pnpm pack:electron:dev
corepack pnpm smoke:windows:engine-lifecycle
```

Evidence:

- `ui-quit-engine-survival` passed against `release/win-unpacked/codexmux.exe`.
- Health after UI quit returned `app: codexmux`, `version: 0.4.13`.
- Post-smoke cleanup left `127.0.0.1:8121` closed.
