# 2026-05-16 Windows Service owner Phase 2 handoff

## 결론

Windows Service owner Phase 2의 첫 slice를 완료했고, 운영자 요청에 따라 같은 host에서
실제 Windows service 등록과 시작까지 수행했다. 이후 `0.4.18` split default-on에서 service
owner는 `codexwinmux-core`와 `codexwinmux-backend` WinSW wrapper 쌍을 소유한다.

## 변경 요약

- `electron/engine-process.ts`를 추가해 `--codexwinmux-engine` CLI flag와 engine process args를 표준화했다.
- `electron/main.ts`는 `--codexwinmux-engine`, `CODEXWINMUX_ELECTRON_ENGINE_PROCESS=1`, 기존 `CODEXMUX_ELECTRON_ENGINE_PROCESS=1`을 engine-only bootstrap으로 인식한다.
- UI가 owned engine을 시작할 때 packaged mode에서도 `--codexwinmux-engine` 인자를 명시적으로 전달한다.
- `src/lib/windows-service-host.ts`는 canonical `CODEXWINMUX_WINDOWS_HOST_OWNER`, `CODEXWINMUX_WINDOWS_SERVICE_NAME`, `CODEXWINMUX_WINDOWS_SERVICE_EXE`를 우선 사용한다.
- service owner plan은 `hostModel=windows-service-owner-capable`, `requiresElevation=true`, `codexwinmux.exe --codexwinmux-engine`, WinSW wrapper, `install`/`uninstall`/`start`/`stop` command plan을 반환한다.
- `smoke:windows:service-host`는 기본 tray owner plan, service owner plan, runbook helper action set을 모두 검증한다. Smoke는 `mutatesSystem=false`이며 SCM을 변경하지 않는다.

## 실제 서비스 등록/시작 증거

이 section의 `0.4.18` health 값은 2026-05-16 당시 service owner Phase 2 evidence다.
2026-05-18 현재 재빌드/재시작 후 live health는 `version=0.4.19`, `commit=06b4285b`,
`buildTime=2026-05-18T06:53:16.750Z`이며 `verify-reboot-readiness`와
`smoke:runtime-v2:phase6-default-gate`도 split service topology에서 통과했다.

- Service names: `codexwinmux-core`, `codexwinmux-backend`
- Wrapper: `%LOCALAPPDATA%\codexwinmux\service\codexwinmux-core-service.exe`, `%LOCALAPPDATA%\codexwinmux\service\codexwinmux-backend-service.exe`
- Wrapper config: `%LOCALAPPDATA%\codexwinmux\service\codexwinmux-core-service.xml`, `%LOCALAPPDATA%\codexwinmux\service\codexwinmux-backend-service.xml`
- Engine executable: `<repo>\release\win-unpacked\codexwinmux.exe`
- Engine args: Core는 `resources\app.asar.unpacked\dist\workers\core-engine-host.js`, Backend는 `resources\app.asar\dist\server.js`
- Start type: `Automatic`
- Service account: initial install은 `LocalSystem`, service account migration 후 현재는 `.\codexwinmux-svc`
- Current status: `Running`
- Health: `http://127.0.0.1:8121/api/health` returned `app=codexwinmux`, `version=0.4.18`, `commit=69cf91db`, `buildTime=2026-05-16T08:17:22.270Z` on 2026-05-16 KST.
- Process ownership: 각 WinSW wrapper가 parent process이고, Core/Backend process가 별도 child로 실행된다.
- Physical boundary: `codexwinmux-core`와 `codexwinmux-backend`가 별도 service/process lifecycle을 갖는다. Backend는 loopback TCP Core client로 Core에 attach한다.

## 승인된 운영 결정

- 현재 내부 운영 모델은 전용 local Windows service account `codexwinmux-svc` + runbook-first다.
- `codexwinmux-svc` 전환은 service profile/data dir, Codex credential/session migration, folder ACL, `SeServiceLogonRight`, account rotation, profile-aware restart/health, reboot-readiness smoke로 검증한다.
- NSIS installer는 service를 자동 등록하지 않는다. 대신 `Windows service runbook (advanced)` section을 default-off로 제공하고, 실제 service mutation은 `scripts/windows-service-account.ps1` 운영 runbook에서 수행한다.

## Runbook Helper

```powershell
corepack pnpm windows:service:write-config
corepack pnpm windows:service:install
corepack pnpm windows:service:start
corepack pnpm windows:service:status
corepack pnpm windows:service:health
corepack pnpm windows:service:restart
corepack pnpm windows:service:stop
corepack pnpm windows:service:uninstall
```

`install`, `start`, `stop`, `restart`, `uninstall`은 elevated PowerShell session에서 실행한다.
`write-config`는 wrapper/config 파일을 갱신하지만 SCM을 변경하지 않는다. `status`와
`health`는 read-only 확인 명령이다.

## 전용 Service Account 승격 Runbook

기본 확인은 read-only다.

```powershell
corepack pnpm windows:service-account:plan
corepack pnpm smoke:windows:service-account
```

실제 `codexwinmux-svc` 생성과 service logon 전환은 elevated PowerShell에서만 실행한다.
비밀번호 값은 문서나 로그에 남기지 않고 env로만 전달한다.

```powershell
$env:CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_PASSWORD='<secure-password>'
corepack pnpm windows:service-account:prepare-profile
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-service-account.ps1 migrate-data -IncludeCodexCredentials
corepack pnpm windows:service-account:apply-acl
corepack pnpm windows:service-account:configure-service-logon
corepack pnpm windows:service-account:restart-services
corepack pnpm windows:service-account:health
```

Password rotation은 별도 env를 사용한다.

```powershell
$env:CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_ROTATION_PASSWORD='<new-secure-password>'
corepack pnpm windows:service-account:rotate-password
corepack pnpm windows:service-account:restart-services
corepack pnpm windows:service-account:health
```

승격 완료 evidence는 `verify`, `verify-reboot-readiness`,
`smoke:windows:updater-local-feed`, `smoke:windows:installer-install`, 실제 reboot 후
`windows:service-account:health` 순서로 수집한다.

2026-05-16 실제 host에서는 난수 비밀번호를 env로만 전달해 `prepare-profile`,
`migrate-data -IncludeCodexCredentials`, `apply-acl`, `configure-service-logon`,
`rotate-password`, `restart-services`, `health`, `verify-reboot-readiness`를 실행했다.
두 split service와 Core worker child process owner는 `AMD_5800X\codexwinmux-svc`로 확인됐다.

## 검증 증거

- `corepack pnpm test tests/unit/electron/engine-process.test.ts tests/unit/lib/windows-service-host.test.ts tests/unit/electron/engine-controller.test.ts tests/unit/electron/runtime-env.test.ts`: 통과.
- `corepack pnpm smoke:windows:service-host`: 통과.
- `corepack pnpm smoke:windows:service-account`: 통과.
- `corepack pnpm tsc --noEmit`: 통과.
- `corepack pnpm lint`: 통과.
- `corepack pnpm test`: 174개 파일 통과, 1개 skipped; 821개 테스트 통과, 1개 skipped.
- `corepack pnpm build:electron`: 통과.
- `corepack pnpm pack:electron:dev`: 통과.
- `corepack pnpm smoke:windows:engine-lifecycle`: 통과. 당시 packaged health는 `commit=c1510c22`, `ui-quit-engine-survival` 확인.
- `codexwinmux-service.exe install`: 통과.
- `codexwinmux-service.exe start`: 통과.
- `Get-Service -Name codexwinmux`: `Running`, `Automatic`, `Win32OwnProcess`.
- `Invoke-RestMethod http://127.0.0.1:8121/api/health`: 통과.
- `corepack pnpm windows:service:status`: `codexwinmux Running Automatic Win32OwnProcess`.
- `corepack pnpm windows:service:health`: 당시 split service health는 `app=codexwinmux`, `version=0.4.18`, `commit=69cf91db`.

## 당시 후속 작업과 현재 상태

| 당시 항목 | 현재 상태 |
| --- | --- |
| service-owned engine stop/restart UI 표현 | 선택 UX 과제로 유지한다. 현재 운영 기본은 split service lifecycle이며 service restart는 runbook/script가 소유한다. |
| 전용 Windows service account mutating 전환 | 완료. `codexwinmux-svc` profile/data dir, credential/session migration, ACL, password rotation, restart, health, reboot-readiness evidence를 수집했다. |
| NSIS optional service install | 보류. 내부 폐쇄망 운영은 runbook-first이며 installer의 service install option은 default-off 미래 과제다. |
| Backend/Core adapter 전환과 split service lifecycle smoke | 완료. Backend API/WebSocket은 Core client adapter를 통과하고 `codexwinmux-core`/`codexwinmux-backend` 독립 lifecycle smoke와 release gate가 통과했다. |
