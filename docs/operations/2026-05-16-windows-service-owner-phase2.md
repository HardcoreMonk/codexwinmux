# 2026-05-16 Windows Service owner Phase 2 handoff

## 결론

Windows Service owner Phase 2의 첫 slice를 완료했고, 운영자 요청에 따라 같은 host에서
실제 Windows service 등록과 시작까지 수행했다. service owner는 WinSW wrapper가 소유하고,
packaged `codexwinmux.exe --codexwinmux-engine`을 Backend/Core Engine 전용 process로
실행한다.

## 변경 요약

- `electron/engine-process.ts`를 추가해 `--codexwinmux-engine` CLI flag와 engine process args를 표준화했다.
- `electron/main.ts`는 `--codexwinmux-engine`, `CODEXWINMUX_ELECTRON_ENGINE_PROCESS=1`, 기존 `CODEXMUX_ELECTRON_ENGINE_PROCESS=1`을 engine-only bootstrap으로 인식한다.
- UI가 owned engine을 시작할 때 packaged mode에서도 `--codexwinmux-engine` 인자를 명시적으로 전달한다.
- `src/lib/windows-service-host.ts`는 canonical `CODEXWINMUX_WINDOWS_HOST_OWNER`, `CODEXWINMUX_WINDOWS_SERVICE_NAME`, `CODEXWINMUX_WINDOWS_SERVICE_EXE`를 우선 사용한다.
- service owner plan은 `hostModel=windows-service-owner-capable`, `requiresElevation=true`, `codexwinmux.exe --codexwinmux-engine`, WinSW wrapper, `install`/`uninstall`/`start`/`stop` command plan을 반환한다.
- `smoke:windows:service-host`는 기본 tray owner plan과 service owner plan을 모두 검증한다. Smoke는 `mutatesSystem=false`이며 SCM을 변경하지 않는다.

## 실제 서비스 등록/시작 증거

- Service name: `codexwinmux`
- Wrapper: `%LOCALAPPDATA%\codexwinmux\service\codexwinmux-service.exe`
- Wrapper config: `%LOCALAPPDATA%\codexwinmux\service\codexwinmux-service.xml`
- Engine executable: `<repo>\release\win-unpacked\codexwinmux.exe`
- Engine args: `--codexwinmux-engine`
- Start type: `Automatic`
- Service account: `LocalSystem`
- Current status: `Running`
- Health: `http://127.0.0.1:8121/api/health` returned `app=codexwinmux`, `version=0.4.17`, `commit=c1510c22`, `buildTime=2026-05-15T17:43:01.396Z`.
- Process ownership: WinSW wrapper가 parent process이고, engine process가 child로 실행된다.

## 검증 증거

- `corepack pnpm test tests/unit/electron/engine-process.test.ts tests/unit/lib/windows-service-host.test.ts tests/unit/electron/engine-controller.test.ts tests/unit/electron/runtime-env.test.ts`: 통과.
- `corepack pnpm smoke:windows:service-host`: 통과.
- `corepack pnpm tsc --noEmit`: 통과.
- `corepack pnpm lint`: 통과.
- `corepack pnpm test`: 174개 파일 통과, 1개 skipped; 821개 테스트 통과, 1개 skipped.
- `corepack pnpm build:electron`: 통과.
- `corepack pnpm pack:electron:dev`: 통과.
- `corepack pnpm smoke:windows:engine-lifecycle`: 통과. Packaged health는 `commit=c1510c22`, `ui-quit-engine-survival` 확인.
- `codexwinmux-service.exe install`: 통과.
- `codexwinmux-service.exe start`: 통과.
- `Get-Service -Name codexwinmux`: `Running`, `Automatic`, `Win32OwnProcess`.
- `Invoke-RestMethod http://127.0.0.1:8121/api/health`: 통과.

## 남은 후속 작업

- 실제 Windows Service 등록/해제 스크립트를 repository 또는 installer 관리 flow로 승격할지 결정한다.
- NSIS installer에서 service install option을 제공할지, 내부 운영 runbook으로만 둘지 결정한다.
- service-owned engine stop/restart를 Electron UI에서 어떻게 표현할지 결정한다. 현재 UI는 자신이 시작한 owned engine만 stop한다.
- `LocalSystem` 대신 전용 Windows user account로 service를 실행할지 결정한다.
- Backend process와 Core worker supervisor를 서로 다른 Windows service/process로 추가 분리할지 별도 Phase 2.2로 설계한다.
