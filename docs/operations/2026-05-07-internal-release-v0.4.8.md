# 2026-05-07 Internal Release v0.4.8

## Release Status

- Audience: internal users only.
- Version: `0.4.8`.
- Release channel: `HardcoreMonk/codexwinmux` GitHub Release `v0.4.8`.
- Installer: `codexmux-Setup-0.4.8.exe`.
- App identity: still `codexmux` for product name, app id, binary names, and `~/.codexmux`.
- External/public release: blocked until Windows code signing and SmartScreen reputation evidence are ready.

## Internal Release Note

`codexwinmux` Windows internal release `0.4.8` is ready for internal use.

This release proves the Windows update channel end to end:

- Existing installed `0.4.2` can update to GitHub-hosted `0.4.8`.
- The updater flow completed download, `quitAndInstall`, updated app launch, and cleanup.
- The updated app passed runtime v2 workspace and terminal WebSocket smoke.
- The updated installed app remained healthy through a 5 minute long-running hold.
- Runtime v2 Phase 6 default gate passed on packaged `0.4.8`.

Known internal-only caveat:

- The Windows installer and exe are not code signed yet. Windows may show SmartScreen or unknown publisher warnings. Use this build only as a trusted internal pilot artifact.
- Fresh `0.4.8` installs can show `500 Internal Server Error` on the authenticated first page if no runtime v2 workspace exists yet. The source fix is in progress for the next packaged build; seed a runtime v2 workspace before pilot use if testing this exact `0.4.8` installer.

## Install And Update Guide

### Fresh Install

1. Open the internal GitHub Release:
   `https://github.com/HardcoreMonk/codexwinmux/releases/tag/v0.4.8`
2. Download `codexmux-Setup-0.4.8.exe`.
3. Run the installer.
4. If Windows shows an unknown publisher or SmartScreen warning, continue only if the file came from the internal release link above.
5. Launch `codexmux`.
6. Complete first-run setup if prompted.
7. Open or create a workspace and start a terminal session.

### Update From 0.4.2

1. Open the existing installed `codexmux` app.
2. Allow the app updater to check the published channel.
3. When the update is downloaded, allow the app to restart/install.
4. Reopen the app if it does not come back to foreground automatically.
5. Confirm the app reports version `0.4.8` in `/api/health` or the app info surface.

### Quick Local Health Check

For internal testers who can use PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:8122/api/health
```

Expected:

- `app` is `codexmux`.
- `version` is `0.4.8`.

### First-Run 500 Recovery

If the app opens `http://127.0.0.1:8122/` and shows `500 Internal Server Error`, verify `http://127.0.0.1:8122/api/health` first. If health is `200`, create a runtime v2 workspace for the pilot machine and refresh the page.

For the current pilot machine, the recovered workspace is:

- Name: `Windows Pilot Workspace`
- Directory: `D:\data\projects\codex-zone\codexwinmux`

The fixed source path prevents the first authenticated page from falling back to legacy tmux workspace creation when runtime v2 storage default is active.

## Pilot Plan

Run the first internal pilot with 3 to 5 users before broad internal rollout.

Pilot duration:

- Minimum: 4 hours of real workspace usage.
- Preferred: 1 full workday if the team can wait.

Each pilot user should exercise:

- Fresh app launch.
- Existing workspace open.
- New workspace create.
- Runtime v2 terminal tab create.
- Normal Codex CLI interaction in a real project.
- App close and relaunch.
- At least one long-running session left open for 30 minutes or more.

Pilot users should report:

- Install/update path used: fresh install or update from `0.4.2`.
- Windows version.
- Whether SmartScreen or unknown publisher warnings appeared.
- Whether any terminal session failed to attach, reconnect, or accept input.
- Whether workspace state survived app restart.
- Any updater, launch, or crash behavior.

## Internal Rollout Gate

Move from pilot to all internal users only when:

- A patched package containing the Windows runtime v2 first-run fix is used, or each `0.4.8` pilot machine is pre-seeded with a runtime v2 workspace.
- 3 to 5 pilot users complete the checklist.
- No launch blocker is found.
- No terminal attach/input/reconnect blocker is found.
- No workspace state loss is found.
- Any SmartScreen warning is understood as the expected unsigned-build caveat.
- A rollback path is communicated: keep the `0.4.2` installer available and preserve `~/.codexmux`.

## Internal Announcement Draft

Subject: `codexwinmux` Windows internal release `0.4.8` is ready for pilot

`codexwinmux` Windows internal release `0.4.8` is ready for pilot use.

Use this release only inside the team. The installer is not code signed yet, so Windows may show an unknown publisher or SmartScreen warning. Continue only if you downloaded it from the internal GitHub Release:

`https://github.com/HardcoreMonk/codexwinmux/releases/tag/v0.4.8`

Install file:

`codexmux-Setup-0.4.8.exe`

What to test:

- Fresh install or update from `0.4.2`.
- Open a real workspace.
- Create a runtime v2 terminal tab.
- Use Codex normally in a real project.
- Close and relaunch the app.
- Leave one session open for at least 30 minutes.

Report back with:

- Fresh install or update path.
- Windows version.
- Any SmartScreen/unknown publisher warning.
- Terminal attach/input/reconnect issues.
- Workspace persistence issues after restart.
- Any crash, updater, or launch issue.

If the 3 to 5 pilot users complete this without blockers, we can move to all internal users.

## Evidence

- Full updater smoke: installed `0.4.2` to GitHub-hosted `0.4.8` passed.
- Updater status: `latestVersion=0.4.8`, `downloadedFileName=codexmux-Setup-0.4.8.exe`, blockers `[]`.
- Updated app health: `version=0.4.8`, `commit=62bfad66`.
- Runtime v2 terminal smoke: passed.
- Long-run hold: 5 minutes, `long-run-health` passed.
- Phase 6 gate: passed with terminal `new-tabs`, storage/timeline/status `default`.
- Code signing: blocked; installer and unpacked exe are `NotSigned`.
