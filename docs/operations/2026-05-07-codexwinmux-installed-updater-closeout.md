# 2026-05-07 codexwinmux Installed Updater Closeout

## Scope

- Full Windows updater smoke from installed `0.4.2` to GitHub-hosted `0.4.8`.
- Code signing and SmartScreen release evidence check.
- Long-running updated installed app session with runtime v2 terminal in the real repository workspace.
- Runtime v2 P3 closeout checks: rollback dry-run, Phase 6 gate, and perf snapshot.
- Product identity decision for `codexwinmux` naming, app id, and data dir.

## Evidence

| Check | Result |
| --- | --- |
| `CODEXMUX_WINDOWS_UPDATER_BASE_INSTALLER_PATH=D:\data\projects\codex-zone\codexmux\release\codexmux-Setup-0.4.2.exe CODEXMUX_WINDOWS_UPDATER_GITHUB_TAG=v0.4.8 CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_POST_INSTALL_HOLD_MS=300000 corepack pnpm smoke:windows:updater-github-feed` | Passed |
| GitHub feed | `https://github.com/HardcoreMonk/codexwinmux/releases/download/v0.4.8/` |
| Updater status | `latestVersion=0.4.8`, `downloadedFileName=codexmux-Setup-0.4.8.exe`, blockers `[]` |
| Install flow | silent install `0.4.2`, `update-available`, `download-started`, `download-progress`, `update-downloaded`, `quit-and-install-started`, app exit after `quitAndInstall(true, false)`, updated app launch, silent uninstall |
| Updated app session | `version=0.4.8`, `commit=62bfad66`, runtime v2 workspace create, runtime v2 tab create, `/api/v2/terminal` WebSocket marker, workspace delete |
| Long-running hold | `CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_POST_INSTALL_HOLD_MS=300000`; `long-run-health` passed after 5 minutes |
| `Get-AuthenticodeSignature release\codexmux-Setup-0.4.8.exe` | `NotSigned` |
| `Get-AuthenticodeSignature release\win-unpacked\codexmux.exe` | `NotSigned` |
| `corepack pnpm lifecycle:rollback-dry-run` | Passed; read-only, `dropInExists=false`, warning says rollback may already be applied |
| packaged `corepack pnpm smoke:runtime-v2:phase6-default-gate` | Passed; terminal `new-tabs`, storage/timeline/status `default`, worker diagnostics present and clean |
| packaged `/api/debug/perf` snapshot | `uptimeSec=22.4`, RSS `281473024`, heap used `75574320`, event loop p95/p99/max `31.26/34.87/526.39ms`, worker health failures/restarts/errors `0/0/0/0` |

## Interpretation

- The GitHub-hosted updater mechanics are now proven end to end for the `0.4.2 -> 0.4.8` Windows path.
- The updated installed app was held for 5 minutes after runtime v2 terminal workspace activity and remained healthy.
- No measurement-backed runtime v2 tuning target was found in the packaged `0.4.8` snapshot. Worker counters were clean; the event loop max spike is worth watching in longer real-user sessions but does not justify a code change by itself.
- The Codex-hosted Windows runner blocks Electron `net` external HTTPS from sandboxed Electron processes. The updater smoke env sets `ELECTRON_DISABLE_SANDBOX=1` for smoke-launched updater processes only; Node and PowerShell GitHub fetches were already healthy.

## Identity Decision

- Keep `productName`, `appId`, binary names, and data dir as `codexmux` for `0.4.8`.
- Treat `codexwinmux` as the repository and Windows release/update channel name for this slice.
- Defer full product identity migration to a separate spec/ADR because it changes installer identity, updater continuity, user data dir migration from `~/.codexmux`, CLI binary names, docs, and rollback behavior.

## Remaining Blocker

- Windows code signing is not complete. The published `0.4.8` installer and unpacked exe are unsigned, so certificate trust, timestamp, and SmartScreen reputation cannot be accepted until signed assets are produced and re-published.
