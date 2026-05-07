# 2026-05-07 Windows Package/Update Handoff

## Scope

- Windows 전용 제품 전환 기준으로 Electron Windows installer, ZIP artifact, packaged launch, runtime v2 terminal attach, updater local feed를 실제 Windows host에서 검증했다.
- Updater smoke는 existing installer `0.4.2`에서 synthetic `0.4.3` local feed로 download/install/post-update launch path를 확인한다.
- Packaged launch cleanup은 Browser close 후 exact app `ExecutablePath` child process exit를 기다리고, 실패 시 app-scoped process cleanup으로 제한한다.

## Verification

| Check | Result |
| --- | --- |
| `corepack pnpm pack:electron` | passed; `release/codexmux-Setup-0.4.2.exe`, `release/codexmux-0.4.2-win.zip`, blockmap/latest metadata generated |
| `corepack pnpm smoke:windows:updater-local-feed` | passed; local feed download, install trigger, post-update launch, uninstall cleanup |
| `CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION=0.4.2 corepack pnpm smoke:windows:updater-published-channel` | passed on `HardcoreMonk/codexwinmux` `v0.4.8`; release count 1, `latestVersion=0.4.8`, latest.yml/installer/blockmap/download URL checks passed |
| `corepack pnpm smoke:windows:updater-github-feed` | passed with `CODEXMUX_WINDOWS_UPDATER_BASE_INSTALLER_PATH` pointing at the `0.4.2` installer and `CODEXMUX_WINDOWS_UPDATER_GITHUB_TAG=v0.4.8`; GitHub-hosted `0.4.8` download, `quitAndInstall`, updated installed-app runtime v2 terminal, 5 minute long-run health, uninstall cleanup |
| `corepack pnpm smoke:windows:package-gate` | passed; zip artifact, update metadata, updater local feed, packaged launch, packaged runtime v2, installer runtime v2 |
| `corepack pnpm smoke:windows:release-gate` | passed; Windows preflight/service host/diagnostics/Electron env/package smoke suite |
| `corepack pnpm smoke:windows:installer-runtime-v2` | passed; silent install, packaged runtime v2 launch, uninstall cleanup |
| `corepack pnpm tsc --noEmit` | passed |
| `corepack pnpm lint` | passed |
| `corepack pnpm test` | passed; 133 files passed / 1 skipped, 654 tests passed / 1 skipped |
| temp process cleanup check | passed; no temp codexmux process left after `7ff7302f` cleanup hardening |

## Operational Interpretation

- This is authoritative local Windows packaging evidence for the current Windows-only transition work.
- The updater local feed proves update mechanics against a local static feed. It does not prove GitHub release publication, CDN availability, code signing trust, or a real user upgrade from a published release.
- The published channel smoke is repeatable and read-only. On 2026-05-07 `HardcoreMonk/codexwinmux` `v0.4.8` published `latest.yml`, `codexmux-Setup-0.4.8.exe`, and the matching `.blockmap`, and the smoke passed against installed version `0.4.2`.
- The GitHub feed smoke is the mutating installed-app evidence: it installed `0.4.2` into a temp path, downloaded the published `0.4.8` installer through Electron updater, executed `quitAndInstall(true, false)`, then verified the updated app in the actual repository workspace with runtime v2 terminal and long-run health.
- `0.4.8` remains unsigned. `Get-AuthenticodeSignature` reports `NotSigned` for both installer and unpacked exe, so SmartScreen reputation cannot be considered passed.
- The smoke artifacts are sanitized and should be safe to keep as release evidence when `CODEXMUX_SMOKE_ARTIFACT_DIR` is set by a local or CI runner.

## Remaining External Evidence

- Trusted Windows code signing certificate, timestamped signed installer/exe, re-published signed GitHub assets, and SmartScreen reputation behavior for a distributed installer.
