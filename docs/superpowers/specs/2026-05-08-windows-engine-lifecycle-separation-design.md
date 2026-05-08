# Windows Engine Lifecycle Separation Design

Date: 2026-05-08
Status: Implementation slice verified

## Goal

Windows native codexmux must stop treating the Electron application window as
the owner of the local service. Closing the app window should not immediately
stop the web page service, terminal runtime, workspace state, or Codex session
projection.

The product direction is to separate the long-running engine from the UI shell:

- Core Engine: runtime v2 workers, terminal sessions, storage, timeline, status,
  Codex session/process detection.
- Backend Engine: local HTTP/API/WebSocket server that exposes the product
  surface on port `8121` and orchestrates the Core Engine.
- Frontend Engine: Next.js UI rendered in Electron or a browser. It consumes the
  Backend Engine and does not own service lifetime.

## Domain Language

Canonical terms:

| Term | Meaning |
| --- | --- |
| Engine Host | The long-running Windows-owned process that starts and supervises backend/core runtime. |
| Core Engine | Runtime v2 workers and domain services for terminal, storage, timeline, and status. |
| Backend Engine | The local HTTP/API/WebSocket server boundary exposed at `127.0.0.1:8121`. |
| Frontend Engine | The UI client surface, including Electron BrowserWindow and browser access. |
| Shell Host | Electron shell responsibilities: window, tray, updater, menus, notifications. |
| Tray-first mode | Default near-term Windows lifecycle where closing the window hides it and leaves the engine running. |

Rejected terms:

| Rejected term | Reason |
| --- | --- |
| App process owns server | Preserves the current bug-prone lifecycle where UI exit kills runtime. |
| Remote sidecar | Conflicts with ADR-014 removal of old Windows companion integration. |
| tmux backend | Legacy implementation detail and not the Windows-native product boundary. |
| Frontend server owner | Confuses UI serving with runtime ownership. |

## Current State

`electron/main.ts` imports `dist/server.js` and starts the local Node server
inside the Electron main process. It stores `serverShutdown` and clears the
server when the app exits. This means the service, terminal runtime, and UI shell
share one lifetime.

`src/lib/windows-service-host.ts` already sketches a Windows host plan, but it is
currently dry-run oriented. It does not install or supervise a persistent engine
and the default service name still resolves to `codexmux`.

The Windows-only gap audit already defines `Windows service host` as a bounded
context candidate. This design turns that candidate into the next lifecycle
slice without changing frontend design or React architecture.

## Recommended Approach

Use a tray-first Engine Host first, then graduate to Windows Service mode.

Phase 1 keeps the Backend Engine and Core Engine in the same Node process. That
preserves the existing custom Next server, API routes, runtime v2 supervisor,
and WebSocket wiring while still solving the product-level problem: Electron UI
closure no longer owns server lifetime.

Phase 2 can introduce a true Windows Service owner after tray-first behavior is
stable. That later service mode should reuse the same host controller and health
contract rather than introducing a second lifecycle model.

## Process Model

```text
Windows user session
  -> Shell Host: codexmux.exe
       - BrowserWindow
       - tray/menu/updater/notifications
       - engine discovery and control UI
       - does not directly own runtime state

  -> Engine Host: codexmux engine process
       - Backend Engine on 127.0.0.1:8121
       - Core Engine runtime v2 workers
       - workspace/runtime DB
       - terminal/process/session lifecycle
```

Phase 1 may still launch the Engine Host from Electron when no healthy engine is
running. The important change is that closing the BrowserWindow does not call
engine shutdown.

Implementation note: the first implementation uses the same packaged executable
with `CODEXMUX_ELECTRON_ENGINE_PROCESS=1` as the owned Engine Host process. The
UI process probes `127.0.0.1:8121/api/health` first and only launches this
engine process when no healthy codexmux engine is already present.

Verification note: the 2026-05-08 implementation slice added the Engine Host
Controller, tray-first Electron lifecycle, owned-engine commands, and packaged
engine-lifecycle smoke wiring. It was verified with focused Electron/runtime
tests, Windows host tests, TypeScript, lint, full unit tests, script syntax
checks, `build:electron`, `pack:electron:dev`, and
`smoke:windows:engine-lifecycle`.

## User-Facing Lifecycle

Default behavior:

- App launch discovers an existing healthy engine on `127.0.0.1:8121`.
- If no engine is healthy, the Shell Host starts one.
- Window close hides the window to tray and keeps the engine running.
- Tray menu can reopen the window.
- Explicit engine controls are available from tray or menu:
  - Open window
  - Restart engine
  - Stop engine
  - Quit UI
  - Quit UI and stop engine

The product should make the difference between closing the window and stopping
the engine visible in menus, not as a marketing explanation inside the main app
surface.

## Module Boundaries

### Engine Host Controller

New or expanded module responsibility:

- Detect whether the engine is already running.
- Read the current engine port and PID from the existing `~/.codexmux/port` and
  lock files where possible.
- Confirm ownership through `/api/health`, version, and app identity.
- Start engine when missing.
- Stop or restart engine on explicit command.
- Avoid killing unrelated processes using the same port.

### Electron Shell Host

`electron/main.ts` should move from direct local server ownership to controller
usage:

- `startLocalServer()` becomes `ensureEngineRunning()`.
- `stopLocalServer()` is called only from explicit stop-engine flows.
- `window.close` hides to tray unless the app is explicitly quitting.
- menu labels reflect engine state.

### Backend Engine

The custom server remains the owner of:

- API routes
- runtime v2 WebSocket upgrades
- auth/session cookies
- workspace/runtime DB access
- local static/Next UI serving for now

### Core Engine

Runtime v2 worker contracts remain unchanged:

- storage worker
- terminal worker
- timeline worker
- status worker

This design does not split these workers into separate Windows services.

## State And Files

Use existing conventions first:

- `~/.codexmux/port`: current engine port
- `~/.codexmux/cmux.lock`: current engine lock metadata
- `~/.codexmux/config.json`: server mode and user settings
- `~/.codexmux/runtime-v2/state.db`: runtime state

If the existing lock metadata is insufficient, add a small engine status file
under `~/.codexmux/engine.json` with PID, port, startedAt, version, and mode.
Do not add this file unless the controller cannot reliably distinguish an owned
engine from a stale or unrelated process.

## Error Handling

- Healthy existing engine: attach UI without starting a second engine.
- Port `8121` occupied by codexmux: attach to it.
- Port `8121` occupied by another process: show an engine startup error and do
  not silently fall back to a random public product port.
- Engine startup failure: keep Electron window alive and show a recovery view
  with retry, logs, and diagnostics.
- Engine crash while UI is open: UI transitions to reconnecting and offers
  restart engine.
- Explicit stop engine: close terminal runtime cleanly and flush storage.

## Testing

Unit tests:

- Engine controller starts when no healthy engine exists.
- Engine controller attaches when `/api/health` matches codexmux.
- Engine controller refuses to stop unrelated processes.
- Window close hides to tray without calling engine shutdown.
- Explicit quit-and-stop calls engine shutdown.

Smoke tests:

- Launch installed app, create workspace, create/access terminal.
- Close window, confirm `http://127.0.0.1:8121/api/health` still responds.
- Reopen from tray, confirm the same workspace and terminal reconnect.
- Quit UI only, confirm engine still responds.
- Stop engine explicitly, confirm port `8121` stops.
- Restart engine, confirm runtime v2 terminal WebSocket works again.

Regression gates:

- Existing `smoke:windows:packaged-runtime-v2`
- Existing `smoke:windows:installer-runtime-v2`
- New tray lifecycle smoke for close/reopen/engine-survival

## Rollout

1. Add Engine Host Controller as a testable module.
2. Convert Electron local mode to use the controller.
3. Add tray behavior and explicit engine commands.
4. Add close-window survival smoke.
5. Update `docs/ELECTRON.md` and Windows operations docs.
6. After tray-first stabilizes, decide whether Windows Service mode becomes the
   default for internal deployment.

## Non-Goals

- No FE/React/Vercel skill refactoring.
- No backend framework rewrite.
- No Windows Service installer implementation in the first slice.
- No cross-platform lifecycle support expansion.
- No revival of the removed Windows remote sidecar model.
- No product name/app id/data dir rename in this slice, though service naming
  should be revisited before Windows Service mode.

## Success Criteria

- Closing the Electron window does not stop the local service.
- Internal users can reopen the UI and continue using the same runtime state.
- Engine stop is explicit and discoverable.
- No duplicate local engine starts on port `8121`.
- Existing runtime v2 terminal package/installer smokes remain green.
- The implementation has a clear rollback path: revert Electron lifecycle and
  controller changes to return to app-owned local server behavior.

## Spec Self-Review

- Placeholder scan: no placeholders remain.
- Consistency check: the first slice separates shell lifetime from engine
  lifetime without forcing a full backend/frontend process split.
- Scope check: focused on tray-first lifecycle separation; Windows Service mode
  is explicitly deferred.
- Ambiguity check: close-window behavior, quit behavior, engine stop behavior,
  and test expectations are explicit.
