# Windows-only Gap Audit

작성일: 2026-05-06
최종 갱신일: 2026-05-08
상태: Windows 제품 전환 evidence 수집 중

## Verdict

codexwinmux는 Windows 전용 설치형 제품으로 전환 중이다. 루트 README와 Electron
패키징 기준은 Windows 제품을 1차 기준으로 설명하며, Shell Host와 Backend/Core
Engine 수명 분리, Windows Runtime v2 terminal smoke, Windows process inspector,
GitHub Release updater smoke까지 evidence가 쌓였다.

남은 판단 기준은 내부 전체 배포에 필요한 운영 evidence다. 특히 code signing
인증서 신뢰, SmartScreen reputation, 장시간 실제 workspace 사용, 그리고
`codexwinmux` app id/data dir/artifact name 전환 결정은 아직 별도 gate로 남아
있다.

이번 전환은 기존 Windows companion integration을 되살리는 작업이 아니다. ADR-014에서
제거한 원격 Windows JSONL sync, terminal sidecar, remote source model은 계속 제거된
상태로 둔다. 새 목표는 제품 실행 기준 자체를 Windows-only service/product로 바꾸는
것이다.

## Audit Sources

- `AGENTS.md`
- `README.md`
- `package.json`
- `docs/README.md`
- `docs/ADR.md`
- `docs/TMUX.md`
- `docs/SYSTEMD.md`
- `docs/ELECTRON.md`
- `docs/ANDROID.md`
- `docs/superpowers/specs/2026-05-05-windows-integration-removal-design.md`
- `docs/operations/2026-05-05-windows-integration-removal-handoff.md`
- `src/lib/tmux.ts`
- `src/lib/terminal-server.ts`
- `src/lib/runtime/terminal/terminal-worker-runtime.ts`
- `src/lib/runtime/terminal/terminal-worker-service.ts`
- `src/lib/session-detection.ts`
- `src/lib/preflight.ts`
- `src/lib/shell-env.ts`
- `src/lib/platform.ts`

## Domain Language

Canonical terms:

| Term | Meaning |
| --- | --- |
| Windows-only product | codexwinmux의 supported execution target을 Windows로 고정하는 제품 전환 |
| Windows terminal runtime | `tmux` 대신 Windows에서 local Codex shell을 유지, attach, resize, stdin/stdout 처리하는 runtime |
| Windows service host | long-running codexmux server를 Windows에서 시작, 재시작, 로그 확인, 종료하는 host boundary |
| runtime adapter | Terminal/process/service 구현을 OS별 infrastructure에서 분리하는 adapter |
| local Codex session | local `~/.codex/sessions/` JSONL과 실행 중인 local Codex process를 연결한 session projection |

Rejected synonyms:

| Rejected term | Reason |
| --- | --- |
| Windows companion integration | ADR-014에서 제거한 remote sync/sidecar 모델을 뜻하므로 새 제품 목표와 다르다. |
| Windows bridge | old remote terminal command queue와 혼동된다. |
| macOS/Linux server | 전환 후 supported product target이 아니다. |
| Android primary client | 현재 client shell일 뿐 Windows-only 제품 목표의 primary surface가 아니다. |
| tmux backend | 현재 구현 세부사항이며 Windows 전용 목표의 canonical runtime term이 아니다. |

## Bounded Context Candidates

| Context | Responsibility | Current center | Windows target |
| --- | --- | --- | --- |
| Terminal Runtime | session create, attach, detach, resize, stdin/stdout, kill | `src/lib/tmux.ts`, `src/lib/runtime/terminal/*` | `ITerminalWorkerRuntime` 뒤의 Windows-native adapter |
| Process Inspection | process tree, cwd, command, Codex process/session detection | `/proc`, `pgrep`, `ps`, `lsof`, tmux pane PID | Windows process inspector adapter |
| Host Operations | install, preflight, start/restart, logs, health, rollback | `systemd --user`, POSIX shell, deploy script | Windows service/tray/installer host |
| Platform Shell | desktop/mobile shell packaging and reconnect | Electron macOS packaging, Android Capacitor shell | Windows desktop/service packaging; mobile shell demoted or removed |
| Local Session Index | Codex JSONL discovery and timeline projection | local `~/.codex/sessions/` index | same domain with Windows path semantics verified |
| Release Verification | CI, smoke, package, install checks | macOS/Linux/tmux and Android/Electron smoke | Windows build, service, terminal, reconnect, JSONL smoke |

Useful candidates:

- Aggregate: `TerminalSession` owns lifecycle, attachment state, dimensions, and kill semantics.
- Entity: `CodexProcess` owns PID, command, cwd, start time, and provider/session correlation.
- Value object: `SessionName`, `WorkspacePath`, `CodexSessionPath`, `HostBinding`.
- Adapter: `ITerminalWorkerRuntime`, future `IProcessInspector`, future `IHostServiceController`.

## Gap Matrix

| Area | Current assumption | Windows target | Impact | Candidate boundary | Priority |
| --- | --- | --- | --- | --- | --- |
| Product contract | README와 문서 맵이 Windows 설치형 제품을 1차 기준으로 설명한다. 비-Windows 문서는 legacy/reference로 남아 있다. | Supported execution target is Windows-only. | User expectation, docs, release gates. | ADR + docs map + README 유지. | P0 |
| Terminal runtime | `src/lib/tmux.ts` shells out to `tmux -L codexmux`, uses POSIX launch command, tmux pane metadata, and process-group signals. | Windows-native persistent terminal runtime. | Largest behavior risk: reconnect, input, kill, cwd, status. | Terminal runtime adapter. | P0 |
| Runtime v2 terminal | `terminal-worker-runtime.ts` still creates and attaches tmux sessions. | Reuse worker service contract, swap infrastructure adapter. | Keeps Supervisor/typed IPC stable while replacing terminal backend. | `ITerminalWorkerRuntime`. | P0 |
| Process inspection | `session-detection.ts` reads `/proc` on Linux and falls back to `pgrep`/`lsof` elsewhere. | Windows process tree, cwd, command, and start-time inspection. | Codex running detection and JSONL mapping can misclassify sessions. | `IProcessInspector`. | P1 |
| Preflight | `preflight.ts` checks tmux, macOS CLT/brew, and POSIX login shell PATH. | Check Windows Codex, Git, Node, pnpm, terminal runtime, service permissions. | First-run readiness is currently wrong on Windows. | Host preflight adapter. | P1 |
| Install scripts | `package.json` `postinstall` uses POSIX `chmod`; `prepublishOnly` uses `rm -rf`. | Windows-safe install/build scripts. | Fresh install can fail before app starts. | npm script hygiene. | P0 |
| Service operation | `deploy:local` restarts `systemd --user`; docs center Linux user service. | Windows Service, tray app, scheduled startup, or installer-owned service. | Production operation path is absent. | Host service controller. | P2 |
| Packaging | Electron package script targets macOS; Android scripts are first-class. | Windows desktop/service package and installer verification. | Release artifact path is undefined. | Packaging context. | P2 |
| Network access | Tailscale/mobile remote access is heavily documented. | Windows local service first; remote access is optional policy. | Avoid letting Android/Tailscale drive core architecture. | Network/access policy docs. | P3 |
| Tests | Prior Windows run passed type/lint but full test had `/proc`, path/HOME, and SQLite cleanup failures. | Windows unit/integration/smoke gates are green. | Test suite currently hides platform debt. | Platform test matrix. | P0 |
| Docs | `TMUX.md`, `SYSTEMD.md`, `ANDROID.md`, `ELECTRON.md`, README all describe current platform shape. | Docs describe Windows-only target once runtime plan is accepted. | Docs drift will confuse operators. | Staged docs cutover. | P0 |
| ADR continuity | ADR-014 removed old Windows companion integration. | New ADR clarifies Windows-only target without reviving remote sidecar. | Prevents architectural backtracking. | ADR-020. | P0 |

## Known Windows Evidence

- `corepack pnpm install --frozen-lockfile` previously failed on Windows because
  `postinstall` runs POSIX `chmod`; `--ignore-scripts` allowed dependency install.
- `corepack pnpm tsc --noEmit` and `corepack pnpm lint` passed in the current
  Windows workspace.
- `corepack pnpm test` previously failed on Windows in 10 files / 41 tests after
  most tests passed. Failures clustered around Linux `/proc`, path/HOME
  assumptions, and temporary SQLite cleanup (`EBUSY`).
- `rg.exe` was not usable in this Codex Windows desktop session because of an
  access-denied error; audit used `git grep`, `git ls-files`, and PowerShell
  searches instead.

## Architecture Implications

- Folder impact: keep current UI and runtime v2 worker folders stable at first;
  add Windows adapters next to runtime/process boundaries instead of scattering
  `process.platform === 'win32'` checks through API routes.
- Module boundary impact: stop treating `src/lib/tmux.ts` as the domain
  terminal API. It is a current infrastructure adapter.
- Public API impact: browser-facing terminal and timeline URLs should remain
  stable where possible. The implementation behind `/api/terminal` and
  `/api/v2/terminal` can change after adapter parity tests exist.
- Type-shape impact: terminal/session types need to stop assuming tmux session
  name, pane PID, and pane current command are always available. If kept for
  compatibility, they should be marked as infrastructure metadata.
- Adapter impact: process inspection and terminal lifecycle should become
  injectable infrastructure behind tested contracts before Windows behavior is
  switched on by default.
- Rollback impact: keep tmux path as a temporary migration fallback until
  Windows runtime parity is proven, but do not document it as supported product
  target after cutover.

## Recommended Transition Order

1. Freeze the Windows-only target in ADR and planning docs.
2. Add platform/runtime adapter contracts and tests while keeping behavior
   unchanged.
3. Replace direct tmux calls in runtime v2 terminal path with adapter injection.
4. Build the Windows terminal runtime behind the existing worker service
   contract.
5. Add Windows process/session inspection and Codex JSONL mapping parity tests.
6. Replace preflight/install/service/deploy assumptions with Windows equivalents.
7. Cut over documentation, release gates, and packaging to Windows-only.
8. Remove or demote macOS/Linux/Android-only surfaces after Windows runtime is
   green and rollback is understood.

## ADR Candidates

- Accepted now: Windows-only product target and ADR-014 non-resurrection rule.
- Proposed later: Windows terminal runtime adapter and parity contract.
- Proposed later: Windows service host and installer ownership.
- Proposed later: platform support removal policy for macOS/Linux/Android docs,
  scripts, and smoke tests.

## Non-Goals

- Do not revive the removed Windows remote sync or terminal bridge.
- Do not refactor FE/React/Vercel or BE/FastAPI skills.
- Do not rewrite the UI while auditing platform gaps.
- Do not dispatch sub-agents unless explicitly requested.
- Do not execute external guide installers, hooks, package managers, or plugin
  manifests as part of this audit.

## First Implementation Slice

Accepted first slice: Windows platform contract baseline.

Success criteria:

- Terminal runtime contract exists with create, attach, write, resize, detach,
  kill, presence, and optional metadata projection behavior.
- Current tmux runtime remains the default production adapter and passes the new
  mocked contract coverage.
- Process inspector primitives are separated from Codex-specific session
  detection policy.
- Live Windows process inspector behavior is not claimed or required in this
  slice.
- Windows path fixtures cover local Codex session JSONL allow/deny behavior.
- Static package/script blocker scanner identifies POSIX-only and Linux service
  command patterns without changing production scripts.
- Browser-facing terminal APIs and README support claims do not change.

Rollback: normal git revert. No feature flag is needed until runtime selection or
Windows adapter implementation appears in a later slice.

## Windows Unit Gate Follow-up

The next implementation pass resolved the Windows unit test baseline that was
blocking the first slice from becoming a clean local gate.

Resolved items:

- Windows tests now stub both `HOME` and `USERPROFILE` when exercising modules
  that resolve `os.homedir()` at import time.
- Runtime storage tests now close opened SQLite database handles and storage
  worker services before removing temporary directories, avoiding Windows
  `EBUSY` cleanup failures.
- `layout-store` now normalizes Windows path separators before extracting a
  workspace id from `workspaces/<ws-id>/layout.json`, so runtime storage read and
  write ownership works on Windows paths.
- `openRuntimeDatabase` now closes the SQLite handle before rethrowing migration
  failures, including newer-schema rejection.

Validation:

- `corepack pnpm test`: 109 passed, 2 skipped files; 562 passed, 3 skipped tests.
- `corepack pnpm tsc --noEmit`: passed.
- `corepack pnpm lint`: passed.
- `git diff --check`: passed with CRLF working-copy warnings only.

## Terminal Runtime Adapter Factory Follow-up

The next transition slice moved the runtime v2 terminal worker entrypoint off a
direct tmux runtime import and onto a terminal runtime adapter factory.

Resolved items:

- `src/workers/terminal-worker.ts` now asks the factory for the terminal runtime
  adapter instead of importing the current tmux runtime directly.
- `CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER` is parsed in one place. Unset resolves to
  `tmux` as the migration fallback.
- Unknown values fail closed with `runtime-v2-terminal-adapter-unsupported`.
- The factory is injectable in unit tests, so a future Windows adapter can be
  added behind the same `ITerminalRuntimeAdapter` contract without changing the
  worker service command handling.

Validation:

- `corepack pnpm test tests/unit/lib/runtime/terminal-runtime-adapter-factory.test.ts tests/unit/lib/runtime/terminal-worker-service.test.ts tests/unit/lib/runtime/terminal-worker-runtime.test.ts`: passed.

## Windows Terminal Runtime Follow-up

The next transition slice moved the Windows terminal runtime from skeleton to a
minimal `node-pty`/ConPTY-backed session manager behind
`ITerminalRuntimeAdapter`.

Resolved items:

- `CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER=windows` now resolves to a dedicated
  Windows runtime adapter instead of being treated as an unknown adapter value.
- The Windows runtime adapter supports create, attach, write, resize, detach,
  kill, presence, and basic metadata for in-memory `node-pty` sessions.
- The adapter fails with `runtime-v2-windows-terminal-platform-mismatch` if used
  outside `win32`.
- Unknown adapter values still fail closed with
  `runtime-v2-terminal-adapter-unsupported`.
- `tmux` remains the default migration fallback until Windows runtime smoke
  tests and session persistence/reconnect behavior are accepted.

Validation:

- `corepack pnpm test tests/unit/lib/runtime/terminal-runtime-adapter-factory.test.ts tests/unit/lib/runtime/windows-terminal-runtime.test.ts tests/unit/lib/runtime/terminal-worker-service.test.ts tests/unit/lib/runtime/terminal-worker-runtime.test.ts`: passed.
- Manual Windows runtime smoke using real `node-pty`: passed. The adapter spawned
  `node.exe` under the Windows runtime, observed `cmux-ready` on stdout, read
  runtime metadata, and killed the session.

## Windows Process Inspector Skeleton Follow-up

The next transition slice added the process inspector adapter selection boundary
without changing the current process/session detection behavior.

Resolved items:

- `defaultProcessInspector` is now created through a process inspector adapter
  factory.
- The current POSIX/Linux implementation remains the default migration fallback.
- `CODEXMUX_PROCESS_INSPECTOR_ADAPTER=windows` resolves to a dedicated Windows
  process inspector skeleton.
- The Windows skeleton implements the `IProcessInspector` shape but every
  operation fails with `runtime-v2-windows-process-inspector-unimplemented`.
- Unknown process inspector adapter values fail closed with
  `runtime-v2-process-inspector-adapter-unsupported`.

Validation:

- `corepack pnpm test tests/unit/lib/process-inspector-adapter-factory.test.ts tests/unit/lib/process-inspector.test.ts tests/unit/lib/session-detection.test.ts`: passed.

## Windows Platform Blocker CLI Follow-up

The next transition slice promoted the static blocker scanner into a repeatable
package-script audit command.

Resolved items:

- Added `scripts/windows-platform-blockers.mjs` to scan `package.json` scripts
  through `windows-platform-blockers-lib.mjs`.
- Added `audit:windows-platform` as a manual package script.
- The command exits `0` when no blockers are found and exits `1` with the script
  names and rule ids when blockers are present.
- Initial blockers removed:
  - `prepublishOnly`: replaced `rm -rf` with `node scripts/clean-build-artifacts.mjs`.
  - `postinstall`: replaced shell `chmod` with `node scripts/postinstall-node-pty.mjs`,
    which skips chmod work on Windows.
- Current package script blocker count: 0.

Validation:

- `corepack pnpm test tests/unit/scripts/windows-platform-blockers-cli.test.ts tests/unit/scripts/windows-platform-blockers-lib.test.ts`: passed.
- `corepack pnpm audit:windows-platform`: passed after the script replacements.

## Windows Package Script Blocker Removal Follow-up

The next transition slice removed the two package-script blockers reported by
the Windows platform audit.

Resolved items:

- Added `scripts/clean-build-artifacts.mjs` and
  `scripts/clean-build-artifacts-lib.mjs` as a cross-platform replacement for
  `rm -rf .next dist dist-electron`.
- Added `scripts/postinstall-node-pty.mjs` and
  `scripts/postinstall-node-pty-lib.mjs` as a cross-platform replacement for the
  shell `chmod` postinstall command. On Windows the chmod step is skipped.
- Updated `prepublishOnly` and `postinstall` in `package.json`.
- `audit:windows-platform` now reports no package-script blockers.

Validation:

- `corepack pnpm test tests/unit/scripts/clean-build-artifacts-lib.test.ts tests/unit/scripts/postinstall-node-pty-lib.test.ts tests/unit/scripts/windows-platform-blockers-cli.test.ts tests/unit/scripts/windows-platform-blockers-lib.test.ts`: passed.
- `corepack pnpm audit:windows-platform`: passed.

## Windows Runtime V2 Terminal Integration Smoke Follow-up

The next transition slice added a smoke command that exercises the actual
runtime v2 supervisor and worker IPC path with the Windows terminal adapter.

Resolved items:

- Added `scripts/smoke-windows-runtime-v2-terminal.ts`.
- Added `scripts/windows-runtime-v2-terminal-smoke-lib.ts` for reusable smoke
  helpers.
- Added package script `smoke:runtime-v2:terminal-windows`.
- The smoke starts runtime v2 workers through `createRuntimeSupervisorForTest`,
  forces `CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER=windows`, uses a temporary runtime
  DB, and verifies:
  - terminal worker health reports the Windows adapter
  - terminal tab creation
  - attach
  - resize
  - stdin/write output marker
  - detach
  - reattach and second output marker
  - terminal tab delete kills the Windows session
  - workspace cleanup

Validation:

- `corepack pnpm test tests/unit/scripts/windows-runtime-v2-terminal-smoke-lib.test.ts`: passed.
- `corepack pnpm smoke:runtime-v2:terminal-windows`: passed.

## Windows Process Inspector Implementation Follow-up

The next transition slice replaced the fail-closed Windows process inspector
skeleton with a real Windows adapter and made it the default on `win32`.

Resolved items:

- `src/lib/windows-process-inspector.ts` now uses Windows PowerShell/CIM
  `Win32_Process` queries to read process existence, child PIDs, descendants,
  command line, executable path, and process creation time.
- `defaultProcessInspector` now selects the Windows adapter automatically on
  `win32`; non-Windows platforms still default to the POSIX/Linux inspector.
- `CODEXMUX_PROCESS_INSPECTOR_ADAPTER=posix|windows` remains an explicit
  override, and unknown values still fail closed.
- `session-detection` compatibility helpers now run on Windows through the
  default process inspector instead of skipping the live process primitive
  contract.
- Windows `getCwd(pid)` is currently precise for the current Node process and
  returns `null` for other processes because standard CIM process metadata does
  not expose arbitrary process working directories. Terminal runtime metadata
  remains the preferred source for session cwd when available.

Validation:

- `corepack pnpm test tests/unit/lib/process-inspector.test.ts tests/unit/lib/process-inspector-adapter-factory.test.ts tests/unit/lib/windows-process-inspector.test.ts tests/unit/lib/session-detection.test.ts`: passed.

## Windows Codex Session Detection Smoke Follow-up

The next transition slice added a Windows smoke command for Codex process
detection and local JSONL mapping.

Resolved items:

- Added `scripts/smoke-windows-codex-session.ts`.
- Added `scripts/windows-codex-session-smoke-lib.ts` for reusable smoke helpers.
- Added package script `smoke:windows:codex-session`.
- The smoke creates a temporary Windows HOME/USERPROFILE, writes a synthetic
  `.codex/sessions/.../*.jsonl` file with `session_meta` and `turn_context`
  records, spawns a Codex-shaped child process whose command line includes
  `codex <session-id>`, and verifies:
  - session id to JSONL path mapping
  - cwd fallback JSONL mapping
  - `detectActiveCodexSession()` returns `running` with the expected session id,
    JSONL path, and live Windows process PID
- The smoke passes the spawned child PID as preloaded process tree input, which
  mirrors the terminal-pane caller path and avoids matching short-lived helper
  processes started by process inspection itself.

Validation:

- `corepack pnpm test tests/unit/scripts/windows-codex-session-smoke-lib.test.ts`: passed.
- `corepack pnpm smoke:windows:codex-session`: passed.

## Windows Runtime Preflight Follow-up

The next transition slice moved runtime readiness away from a hard `tmux`
requirement on Windows.

Resolved items:

- Added `terminalRuntime` and `platform` to runtime/auth preflight payloads while
  preserving the existing `tmux` compatibility field for older UI code and
  non-Windows fallback paths.
- `isRuntimeOk()` now checks the selected terminal runtime instead of always
  requiring `tmux`.
- `win32` runtime preflight selects `terminalRuntime.adapter="windows"` and
  marks it ready when the Windows terminal runtime is available in-process.
- Non-Windows preflight still uses the current `tmux` compatibility check.
- Windows preflight uses the current process `PATH` instead of POSIX login-shell
  probing.
- Windows tool lookup falls back to PowerShell so npm/PowerShell shims such as
  `codex.ps1` are detected.
- Onboarding and tools-required surfaces now display the selected terminal
  runtime name instead of hard-coding `tmux`.
- Added package script `smoke:windows:preflight`.

Validation:

- `corepack pnpm test tests/unit/lib/preflight.test.ts`: passed.
- `corepack pnpm smoke:windows:preflight`: passed.

## Windows Service Host Baseline Follow-up

The next transition slice added a dry-run Windows host ownership contract without
installing or mutating any Windows service.

Resolved items:

- Added `src/lib/windows-service-host.ts`.
- Added package script `smoke:windows:service-host`.
- The baseline host model is `tray-first-service-capable`:
  - default owner is `tray`
  - `service` owner is accepted but marked elevation-required
  - `installer-background` remains an accepted future owner
  - unsupported owners fail closed in the plan
- The dry-run plan fixes the Windows runtime environment for a local server:
  - `CODEXWINMUX_RUNTIME_V2=1`
  - `CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER=windows`
  - `CODEXMUX_PROCESS_INSPECTOR_ADAPTER=windows`
  - default `HOST=127.0.0.1`
  - default `PORT=8121`
- The plan records Windows data/log locations:
  - `%USERPROFILE%\.codexwinmux`
  - `%USERPROFILE%\.codex`
  - `%LOCALAPPDATA%\codexwinmux\logs`
- The smoke asserts `mutatesSystem=false`; no service registration, restart,
  firewall rule, scheduled task, installer action, or external host tool is run.

Validation:

- `corepack pnpm test tests/unit/lib/windows-service-host.test.ts`: passed.
- `corepack pnpm smoke:windows:service-host`: passed.

## Windows Host Diagnostics Follow-up

The next transition slice aligned Windows log paths with the service host plan
and added a dry-run health-check diagnostics smoke.

Resolved items:

- Added `src/lib/host-paths.ts` so Windows app data, Codex data, and server log
  paths are resolved from one helper.
- `createLogger()` now writes Windows server logs under
  `%LOCALAPPDATA%\codexwinmux\logs`, matching the Windows service host plan.
- Added `src/lib/windows-host-diagnostics.ts` to report the Windows host paths,
  local health probe URLs, and service host ownership without exposing token,
  session, prompt, or command output data.
- Added package script `smoke:windows:host-diagnostics`.
- The health diagnostics keep probes loopback-local by default:
  - `/api/health`
  - `/api/v2/runtime/health`
- The runtime v2 health probe is marked as authenticated, so the smoke records
  the expected endpoint contract without bypassing API auth.
- The smoke asserts `mutatesSystem=false`; no service registration, restart,
  firewall rule, scheduled task, installer action, log collection, or network
  probe is run.

Validation:

- `corepack pnpm test tests/unit/lib/windows-host-diagnostics.test.ts tests/unit/lib/windows-service-host.test.ts`: passed.
- `corepack pnpm smoke:windows:host-diagnostics`: passed.

## Windows Electron Bootstrap Env Follow-up

The next transition slice removed POSIX shell assumptions from the Electron
local server bootstrap path without changing Electron UI behavior.

Resolved items:

- Added `electron/runtime-env.ts` for platform-specific Electron bootstrap env
  handling.
- `electron/main.ts` now preserves Windows `PATH` instead of injecting
  Finder/Dock POSIX launch paths.
- Packaged Electron local server startup now builds `NODE_PATH` with the
  platform delimiter, so Windows uses `;` instead of POSIX `:`.
- Added package script `smoke:windows:electron-env`.
- The smoke is dry-run only; it does not launch Electron, start a server, write
  config, or mutate system environment.

Validation:

- `corepack pnpm test tests/unit/electron/runtime-env.test.ts`: passed.
- `corepack pnpm smoke:windows:electron-env`: passed.

## Windows Electron Packaging Contract Follow-up

The next transition slice moved the default Electron packaging contract from
macOS to Windows without running an installer or mutating the host.

Resolved items:

- `pack:electron` now targets `electron-builder --win`.
- `pack:electron:dev` now targets `electron-builder --win --dir` for unpacked
  Windows package smoke.
- Existing macOS packaging commands remain available as explicit
  `pack:electron:mac` and `pack:electron:mac:dev` legacy/manual commands.
- `electron-builder.yml` now defines Windows `nsis` and `zip` targets for `x64`.
- Added `build-resources/icon.ico` for the Windows package icon.
- Added package script `smoke:windows:electron-packaging`.
- The smoke validates package scripts, Windows builder targets, NSIS installer
  options, and `.ico` asset presence without building, installing, or launching
  the app.

Validation:

- `corepack pnpm test tests/unit/scripts/windows-electron-packaging-smoke-lib.test.ts`: passed.
- `corepack pnpm smoke:windows:electron-packaging`: passed.

## Windows Release Gate Follow-up

The next transition slice grouped the accepted Windows smoke commands into a
single release gate for local Windows evidence collection.

Resolved items:

- Added `scripts/windows-release-gate-lib.mjs`.
- Added package script `smoke:windows:release-gate`.
- The release gate runs the accepted Windows transition checks in a fixed order:
  - `audit:windows-platform`
  - `smoke:runtime-v2:terminal-windows`
  - `smoke:windows:preflight`
  - `smoke:windows:service-host`
  - `smoke:windows:core-engine-ipc`
  - `smoke:windows:core-backend-external-transport`
  - `smoke:windows:core-backend-split-lifecycle`
  - `smoke:windows:host-diagnostics`
  - `smoke:windows:electron-env`
  - `smoke:windows:electron-packaging`
  - `smoke:windows:codex-session`
- The gate validates that each required package script exists before execution.
- The gate now includes standalone Core IPC attach, Backend external Core attach,
  and split lifecycle evidence before host diagnostics and packaging
  checks.
- The gate stops on the first failed step and reports `failedStepId`.
- On non-Windows hosts the gate reports a skipped result instead of claiming
  Windows evidence.

Validation:

- `corepack pnpm test tests/unit/scripts/windows-release-gate-lib.test.ts`: passed.
- `corepack pnpm smoke:windows:release-gate`: passed.

## Windows Release Gate Artifact Follow-up

The next transition slice added sanitized smoke artifact support for the Windows
release gate.

Resolved items:

- `smoke:windows:release-gate` now writes a `windows-release-gate` smoke
  artifact when `CODEXMUX_SMOKE_ARTIFACT_DIR` is set.
- Added `buildWindowsReleaseGateArtifactPayload()` so release evidence contains
  step summary fields only.
- The release gate artifact stores step id, package script, pass/fail state,
  duration, exit code, signal, and sanitized error labels.
- The artifact does not store child smoke stdout/stderr, terminal output tails,
  temp HOME paths, Codex session ids, JSONL paths, tokens, target URLs, or prompt
  content.
- `smoke-artifact-lib` now drops `outputTail` fields and sanitizes Windows temp
  smoke paths such as `%LOCALAPPDATA%\Temp\codexmux-*`.

Validation:

- `corepack pnpm test tests/unit/scripts/smoke-artifact-lib.test.ts tests/unit/scripts/windows-release-gate-lib.test.ts`: passed.
- `CODEXMUX_SMOKE_ARTIFACT_DIR=<temp> corepack pnpm smoke:windows:release-gate`: passed and wrote a sanitized summary artifact.

## Windows Engine Lifecycle Separation Follow-up

The next transition slice separated Electron UI lifetime from the local
Backend/Core Engine lifetime in tray-first mode.

Resolved items:

- Added `electron/engine-controller.ts` as the Shell Host boundary for probing
  `127.0.0.1:8121/api/health`, attaching to existing healthy codexmux engines,
  starting an owned engine process when missing, and refusing to stop unrelated
  processes on the same port.
- `electron/main.ts` now starts packaged local mode through the controller
  instead of directly owning the server inside the UI process.
- Added `CODEXMUX_ELECTRON_ENGINE_PROCESS=1` engine-only bootstrap so the same
  packaged executable can run the Backend/Core Engine without opening a
  BrowserWindow or taking the UI single-instance lock.
- Window close hides to tray. The tray/menu surface exposes open window,
  restart engine, stop engine, quit UI, and quit UI plus stop engine commands.
- Added `smoke:windows:engine-lifecycle`, which verifies packaged UI quit leaves
  `127.0.0.1:8121/api/health` alive before cleanup.
- The packaged smoke reserves the DevTools port so the Backend Engine internal
  Next.js port cannot race and bind it during startup.

Validation:

- `corepack pnpm test tests/unit/electron/engine-controller.test.ts tests/unit/electron/runtime-env.test.ts`: passed.
- `corepack pnpm test tests/unit/scripts/windows-packaged-launch-smoke-lib.test.ts tests/unit/scripts/windows-package-smoke-artifact-lib.test.ts tests/unit/scripts/windows-package-gate-lib.test.ts`: passed.
- `corepack pnpm pack:electron:dev`: passed.
- `corepack pnpm smoke:windows:engine-lifecycle`: passed. Evidence included
  `ui-quit-engine-survival`, `healthAfterUiQuit.app=codexmux`, and post-smoke
  cleanup closing `127.0.0.1:8121`.

## Windows Service Owner Phase 2 Follow-up

2026-05-16 slice는 tray-first Engine Host 이후 첫 Windows Service owner 경계를
추가했다. smoke 단계는 SCM을 실제로 변경하지 않고, packaged executable이 Windows
Service에서 Backend/Core Engine 전용 process로 실행될 수 있는 계약을 고정한다.
운영자 요청 후 같은 host에서 WinSW wrapper 기반 실제 service 등록/시작도 수행했다.

해결된 항목:

- `electron/engine-process.ts`를 추가했다.
- `electron/main.ts`는 `--codexwinmux-engine`과
  `CODEXWINMUX_ELECTRON_ENGINE_PROCESS=1`을 canonical engine-only bootstrap
  입력으로 인식한다. 기존 `CODEXMUX_ELECTRON_ENGINE_PROCESS=1`은 호환 입력으로 남긴다.
- UI-owned engine launch는 environment marker에만 의존하지 않고
  `--codexwinmux-engine` process argument를 명시한다.
- `src/lib/windows-service-host.ts`는 canonical
  `CODEXWINMUX_WINDOWS_HOST_OWNER` / `CODEXWINMUX_WINDOWS_SERVICE_NAME` /
  `CODEXWINMUX_WINDOWS_SERVICE_EXE` 입력을 우선 사용한다.
- Service owner plan은 `hostModel=windows-service-owner-capable`,
  `requiresElevation=true`, packaged `codexwinmux.exe` path,
  `--codexwinmux-engine`, WinSW wrapper path, structured
  `install`, `uninstall`, `start`, `stop` wrapper command plan을 반환한다.
- 승인된 운영 모델은 `LocalSystem + runbook-first`다. 장기 목표 service account는
  `codexwinmux-svc`이지만, profile/data dir, Codex credential/session migration,
  folder ACL, account rotation, upgrade/uninstall/reboot/health smoke가 닫히기 전에는
  전환하지 않는다. NSIS service install option은 같은 gate 전까지 installer 기본 흐름에
  넣지 않고 deferred/default-off로 둔다.
- `scripts/windows-service-account.ps1`은 `plan`, `prepare-profile`, `migrate-data`,
  `apply-acl`, `configure-service-logon`, `rotate-password`, `verify`,
  `verify-reboot-readiness` action을 제공한다. 기본 plan/smoke는 read-only이고,
  mutating action은 elevated PowerShell과
  `CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_PASSWORD` 또는
  `CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_ROTATION_PASSWORD`가 필요하다.
- `smoke:windows:service-account`는 전용 계정 승격 plan, sensitive migration 표시,
  secret redaction, ACL target, rotation helper, profile env service config, package
  scripts를 확인한다.
  `0.4.18`부터 runbook 기본 service topology는 split mode다.
- `scripts/windows-service.ps1` helper를 추가했다. `install`, `start`, `stop`,
  `restart`, `status`, `health`, `uninstall`, `write-config` action을 제공한다.
- `smoke:windows:service-host`는 기본 tray owner plan, service owner plan, runbook
  helper action set을 검증하며 `mutatesSystem=false`를 유지한다.
- 실제 host service evidence: `0.4.18`부터 old combined `codexwinmux` service는
  migration cleanup 뒤 제거하고, `%LOCALAPPDATA%\codexwinmux\service\codexwinmux-core-service.exe`
  와 `codexwinmux-backend-service.exe`가 split service로 설치된다. 두 service는
  `StartType=Automatic`, `Status=Running`이며, health는 `app=codexwinmux`,
  `version=0.4.18`을 반환한다.

검증:

- `corepack pnpm test tests/unit/electron/engine-process.test.ts tests/unit/lib/windows-service-host.test.ts`: passed.
- `corepack pnpm smoke:windows:service-host`: passed.

## Core Process Host P2 Follow-up

Core/Backend physical separation milestone의 P2 slice에서 standalone Core host
foundation을 추가했다. 이 단계는 split service 완료가 아니라, combined engine과 별도로
Core Supervisor/workers만 띄울 수 있는 process host 계약을 만든 것이다.

해결된 항목:

- `electron/engine-process.ts`는 `--codexwinmux-core`와
  `CODEXWINMUX_ELECTRON_CORE_PROCESS=1`을 core-only bootstrap 입력으로 인식한다.
- `electron/main.ts`는 `ui`, `engine`, `core` role을 분기하고, core role에서는
  BrowserWindow와 UI single-instance lock을 만들지 않는다.
- `electron/core-process.ts`는 packaged executable에서 Core-only bootstrap을 제공한다.
- `src/lib/core-engine/process-host.ts`는 runtime Supervisor를 시작하고 Core
  command/event protocol을 처리하며 shutdown 때 listener와 runtime workers를 정리한다.
- `src/workers/core-engine-host.ts`는 Node packaged worker entry로 빌드되어
  `dist/workers/core-engine-host.js` 산출물에 포함된다.
- 이 P2 slice 당시 운영 기본값과 Windows service는 `--codexwinmux-engine` combined
  mode를 유지했다. `0.4.18` source cutover 이후 기본 runbook은 split mode이며,
  Backend/API WebSocket Core client 전환과 독립 restart lifecycle smoke는 P3-P7에서 닫혔다.

검증:

- `corepack pnpm test tests/unit/lib/core-engine/contracts.test.ts tests/unit/electron/engine-process.test.ts tests/unit/lib/core-engine/process-host.test.ts`: passed.
- `corepack pnpm tsc --noEmit`: passed.
- `corepack pnpm lint`: passed.
- `corepack pnpm build:server`: passed and produced `dist/workers/core-engine-host.js`.
- `corepack pnpm build:electron:main`: passed.

## Core/Backend Split Gate Follow-up

Core/Backend physical separation P3-P6에서 Backend API/WebSocket default path를 Core
client adapter 뒤로 옮기고, package/release gate에 split-mode evidence를 추가했다.

해결된 항목:

- `src/lib/core-engine/runtime-api.ts`는 Backend route와 WebSocket handler가 사용하는
  Core client adapter다.
- `src/pages/api/**`와 `server.ts`는 runtime Supervisor를 직접 import하지 않고 Core
  adapter를 통과한다.
- Core command surface는 workspace/tab mutation, timeline read/message counts,
  status live event/poll/register/remove/device visibility까지 확장됐다.
- `smoke:windows:core-engine-ipc`는 `dist/workers/core-engine-host.js`를 독립 child
  process로 실행하고 backend-to-core IPC `core.health` event/reply를 확인한다.
- `0.4.17`까지 `CODEXWINMUX_CORE_ENGINE_TRANSPORT=tcp`는 default-off external Core
  transport였다. `0.4.18`부터 Backend Core transport 기본값은 loopback TCP이며,
  Backend adapter는 독립 Core process에 attach한다.
- `scripts/windows-service.ps1 -Mode split`은 `codexwinmux-core`와
  `codexwinmux-backend` 양쪽에 split transport env를 기록한다.
- `smoke:windows:core-backend-external-transport`는 Core host를 TCP listener로 띄우고
  Backend `getCoreRuntimeApi()`가 외부 Core process에서 `core.health`를 받는지 확인한다.
- `smoke:windows:release-gate`와 `smoke:windows:package-gate`는 standalone Core IPC,
  Backend external Core attach, split lifecycle dry-run을 포함한다.

검증:

- `corepack pnpm test tests/unit/lib/core-engine/contracts.test.ts tests/unit/lib/core-engine/server.test.ts tests/unit/pages`: passed.
- `corepack pnpm test tests/unit/lib/core-engine/transport-config.test.ts tests/unit/lib/core-engine/tcp-transport.test.ts tests/unit/scripts/core-engine-ipc-smoke-lib.test.ts tests/unit/scripts/windows-release-gate-lib.test.ts tests/unit/scripts/windows-package-gate-lib.test.ts`: passed.
- `corepack pnpm build:server`: passed.
- `corepack pnpm smoke:windows:core-engine-ipc`: passed.
- `corepack pnpm smoke:windows:core-backend-external-transport`: passed.

## Core/Backend Split Default-on Follow-up

2026-05-16 `0.4.18` source cutover에서 split topology를 기본값으로 승격했다.

해결된 항목:

- `package.json` version은 `0.4.18`이다.
- Backend Core transport 기본값은 loopback TCP이며, invalid 또는 `in-process` 요청도
  Backend in-process Core client로 fallback하지 않는다.
- Electron UI-owned local engine은 `--codexwinmux-core` Core process와
  `--codexwinmux-engine` Backend process를 paired launch로 시작한다.
- Core process host는 terminal stdout/close event를 TCP transport로 forward한다.
- `scripts/windows-service.ps1` 기본 `-Mode`는 `split`이고 `restart` action을 split
  lifecycle에 포함한다.
- combined service `install/start/restart/write-config`는 차단한다. 기존 combined
  service는 `status/health/stop/uninstall` migration cleanup 용도로만 남긴다.
- `src/lib/core-engine/runtime-api.ts`는 runtime Supervisor singleton을 직접 import하지
  않고 TCP Core client만 생성한다.

검증:

- `corepack pnpm exec vitest run tests/unit/lib/core-engine/transport-config.test.ts tests/unit/lib/windows-service-host.test.ts tests/unit/electron/engine-process.test.ts tests/unit/pages/runtime-direct-import-policy.test.ts tests/unit/scripts/windows-core-backend-split-lifecycle-lib.test.ts tests/unit/scripts/windows-package-gate-lib.test.ts tests/unit/scripts/windows-release-gate-lib.test.ts`: passed.
- `corepack pnpm exec tsx scripts/smoke-windows-service-host.ts`: passed.
- `corepack pnpm exec tsc --noEmit`: passed.
- `corepack pnpm test`: passed, 182 files / 865 tests.
- `corepack pnpm lint`: passed.
- `corepack pnpm pack:electron`: passed, Windows `release/` artifact regenerated for `0.4.18`.
- `node scripts/smoke-windows-package-gate.mjs`: passed, including zip artifact, update metadata, updater local feed, packaged launch, engine lifecycle, standalone Core IPC, Backend external Core attach, split lifecycle dry-run, packaged runtime v2, installer runtime v2.
- `CODEXWINMUX_WINDOWS_SPLIT_LIFECYCLE_MUTATE=1 node scripts/smoke-windows-core-backend-split-lifecycle.mjs`: passed, actual `codexwinmux-core`/`codexwinmux-backend` service install/start/backend restart/core restart/cleanup sequence.
- `scripts/windows-service.ps1 start` and `scripts/windows-service.ps1 health`: passed after lifecycle cleanup; `codexwinmux-core` and `codexwinmux-backend` are `Running` with `Automatic` start type.
