# 2026-05-07 codexwinmux Published Update Handoff

## Scope

- Created the public GitHub repository `HardcoreMonk/codexwinmux`.
- Seeded `main` from the Windows platform baseline and pushed release channel commit `62bfad66`.
- Published GitHub Release `v0.4.8` with updater-visible Windows assets.

## Release Assets

| Asset | Size |
| --- | ---: |
| `latest.yml` | 345 |
| `codexmux-Setup-0.4.8.exe` | 152234989 |
| `codexmux-Setup-0.4.8.exe.blockmap` | 158224 |

Release URL: `https://github.com/HardcoreMonk/codexwinmux/releases/tag/v0.4.8`

## Verification

| Check | Result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | passed |
| `corepack pnpm test tests/unit/scripts/windows-updater-published-channel-smoke-lib.test.ts` | passed; 5 tests |
| `corepack pnpm lint` | passed |
| `corepack pnpm test` | passed; 134 files passed / 1 skipped, 659 tests passed / 1 skipped |
| `corepack pnpm tsc --noEmit` | passed |
| `corepack pnpm pack:electron` | passed; generated `0.4.8` Windows installer, latest metadata, blockmap, and ZIP |
| `corepack pnpm smoke:windows:update-metadata` | passed; packaged `app-update.yml` owner/repo is `HardcoreMonk/codexwinmux` |
| asset HEAD checks | passed; GitHub download URLs returned 200 for `latest.yml`, installer, and blockmap |
| `CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION=0.4.2 corepack pnpm smoke:windows:updater-published-channel` | passed; `latestVersion=0.4.8`, release count 1, blocker 0 |
| `CODEXMUX_WINDOWS_UPDATER_BASE_INSTALLER_PATH=D:\data\projects\codex-zone\codexmux\release\codexmux-Setup-0.4.2.exe CODEXMUX_WINDOWS_UPDATER_GITHUB_TAG=v0.4.8 CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_POST_INSTALL_HOLD_MS=300000 corepack pnpm smoke:windows:updater-github-feed` | passed; installed `0.4.2` downloaded GitHub-hosted `0.4.8`, ran `quitAndInstall`, launched updated install path, passed runtime v2 terminal smoke and 5 minute long-run health, then uninstalled |
| `Get-AuthenticodeSignature release\codexmux-Setup-0.4.8.exe` | blocked; `NotSigned` |
| `Get-AuthenticodeSignature release\win-unpacked\codexmux.exe` | blocked; `NotSigned` |
| `corepack pnpm lifecycle:rollback-dry-run` | passed; read-only output, no drop-in found, rollback commands listed |
| packaged `corepack pnpm smoke:runtime-v2:phase6-default-gate` | passed; terminal `new-tabs`, storage/timeline/status `default`, worker counters clean |

## Notes

- The app/product metadata still uses `codexmux` naming and app ID; this handoff only moves the release/update channel to the new `codexwinmux` repository.
- `CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION=0.4.2` represents the previously installed Windows build when checking whether the published channel offers an update.
- The full GitHub feed smoke uses a temp install path and isolated app profile, but the post-update runtime v2 terminal smoke uses the real repository workspace as the terminal cwd.
- The Codex-hosted Windows runner requires `ELECTRON_DISABLE_SANDBOX=1` for Electron `net` external HTTPS in updater smoke. The first diagnostic run reproduced sandboxed Electron `net` timeout/denial while Node and PowerShell GitHub fetches succeeded; the smoke env now applies the Electron sandbox override only for smoke-launched updater processes.
- The app/product metadata still uses `codexmux` naming and app ID for this release. The repo/update channel move to `codexwinmux` is complete; product identity migration is deferred to a separate migration because it affects installer identity, updater continuity, `~/.codexmux`, binary names, and user data migration.
- Code signing and SmartScreen reputation are not passed for `0.4.8`; the installer and unpacked exe are unsigned.

## Remaining Evidence

- Trusted Windows code signing certificate, timestamped signed installer/exe, and SmartScreen reputation evidence after re-publishing signed assets.
