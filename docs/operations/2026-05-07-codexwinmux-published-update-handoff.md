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

## Notes

- The app/product metadata still uses `codexmux` naming and app ID; this handoff only moves the release/update channel to the new `codexwinmux` repository.
- `CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION=0.4.2` represents the previously installed Windows build when checking whether the published channel offers an update.
- This evidence is read-only channel evidence. It does not launch an installed `0.4.2` app and execute `quitAndInstall` against GitHub-hosted assets.

## Remaining Evidence

- Full installed-app updater smoke from `0.4.2` to `0.4.8` against the GitHub release channel, if required.
- Code signing certificate trust and SmartScreen reputation behavior.
- Long-running installed app session with real user workspaces.
