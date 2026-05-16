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

- Service names: `codexwinmux-core`, `codexwinmux-backend`
- Wrapper: `%LOCALAPPDATA%\codexwinmux\service\codexwinmux-core-service.exe`, `%LOCALAPPDATA%\codexwinmux\service\codexwinmux-backend-service.exe`
- Wrapper config: `%LOCALAPPDATA%\codexwinmux\service\codexwinmux-core-service.xml`, `%LOCALAPPDATA%\codexwinmux\service\codexwinmux-backend-service.xml`
- Engine executable: `<repo>\release\win-unpacked\codexwinmux.exe`
- Engine args: Core는 `resources\app.asar.unpacked\dist\workers\core-engine-host.js`, Backend는 `resources\app.asar\dist\server.js`
- Start type: `Automatic`
- Service account: `LocalSystem`
- Current status: `Running`
- Health: `http://127.0.0.1:8121/api/health` returned `app=codexwinmux`, `version=0.4.18`, `commit=69cf91db`, `buildTime=2026-05-16T08:17:22.270Z` on 2026-05-16 KST.
- Process ownership: 각 WinSW wrapper가 parent process이고, Core/Backend process가 별도 child로 실행된다.
- Physical boundary: `codexwinmux-core`와 `codexwinmux-backend`가 별도 service/process lifecycle을 갖는다. Backend는 loopback TCP Core client로 Core에 attach한다.

## 승인된 운영 결정

- 현재 내부 운영 모델은 `LocalSystem + runbook-first`로 유지한다.
- 장기 운영 host 또는 반복 배포 host의 목표 계정은 전용 local Windows service account `codexwinmux-svc`다.
- `codexwinmux-svc` 전환은 service profile/data dir, Codex credential/session migration, folder ACL, account rotation, upgrade/uninstall/reboot/health smoke가 준비된 뒤 별도 slice로 진행한다.
- NSIS installer service install option은 지금 추가하지 않는다. 기본 설치 흐름은 service를 자동 등록하지 않으며, `scripts/windows-service.ps1` helper와 운영 runbook을 우선 사용한다.
- NSIS option은 account/ACL gate와 install/upgrade/uninstall/reboot/health smoke가 준비된 뒤 default-off 고급 옵션으로 승격한다.

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

## 검증 증거

- `corepack pnpm test tests/unit/electron/engine-process.test.ts tests/unit/lib/windows-service-host.test.ts tests/unit/electron/engine-controller.test.ts tests/unit/electron/runtime-env.test.ts`: 통과.
- `corepack pnpm smoke:windows:service-host`: 통과.
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
- `corepack pnpm windows:service:health`: 현재 split service health는 `app=codexwinmux`, `version=0.4.18`, `commit=69cf91db`.

## 남은 후속 작업

- service-owned engine stop/restart를 Electron UI에서 어떻게 표현할지 결정한다. 현재 UI는 자신이 시작한 owned engine만 stop한다.
- 전용 Windows service account 전환 slice는 `codexwinmux-svc` 생성/권한, service profile/data dir, Codex credential/session migration, folder ACL, credential rotation, migration smoke를 포함한다.
- NSIS optional service install slice는 default-off install option, upgrade/uninstall/reboot/health/account-ACL smoke가 준비된 뒤 진행한다.
- P2 Core host foundation은 source/build에 포함됐다. 다음 physical separation 작업은 Backend API/WebSocket Core client adapter 전환, `codexwinmux-backend`/`codexwinmux-core` split service default-off plan, 독립 restart lifecycle smoke 순서로 진행한다.
