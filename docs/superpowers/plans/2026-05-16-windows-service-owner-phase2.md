# Windows Service Owner Phase 2 구현 계획

> **Agent 작업 규칙:** 이 계획은 task 단위로 추적한다. 병렬 worker를 사용할 경우 파일 소유권을 분리하고, 기존 작업을 되돌리지 않는다.

**목표:** codexwinmux Backend/Core Engine을 Windows Service owner가 실행할 수 있는 계약을 추가하고, 운영자 요청 시 실제 service 등록/시작까지 수행한다.

**구조:** tray-first runtime 동작은 유지하면서 canonical engine-only CLI flag와 WinSW wrapper 기반 service owner plan을 추가한다. `smoke:windows:service-host`는 host를 변경하지 않고 command plan만 검증한다.

**기술 스택:** TypeScript, Electron, WinSW, Windows SCM, Vitest, 기존 smoke scripts.

---

## 파일 구조

- Create: `D:\data\projects\codex-zone\codexwinmux\electron\engine-process.ts`
- Modify: `D:\data\projects\codex-zone\codexwinmux\electron\main.ts`
- Modify: `D:\data\projects\codex-zone\codexwinmux\src\lib\windows-service-host.ts`
- Modify: `D:\data\projects\codex-zone\codexwinmux\scripts\smoke-windows-service-host.ts`
- Test: `D:\data\projects\codex-zone\codexwinmux\tests\unit\electron\engine-process.test.ts`
- Test: `D:\data\projects\codex-zone\codexwinmux\tests\unit\lib\windows-service-host.test.ts`
- Modify: `D:\data\projects\codex-zone\codexwinmux\docs\ELECTRON.md`
- Modify: `D:\data\projects\codex-zone\codexwinmux\docs\WINDOWS-ONLY-GAP-AUDIT.md`

## Task 1: Engine-Only CLI Flag

- [x] `--codexwinmux-engine`, canonical env, legacy env, packaged args, dev args에 대한 failing test를 추가한다.
- [x] `electron/engine-process.ts`를 구현한다.
- [x] `electron/main.ts`가 helper를 사용하도록 연결한다.

## Task 2: Windows Service Owner Plan

- [x] canonical `CODEXWINMUX_WINDOWS_HOST_OWNER=service` failing test를 추가한다.
- [x] service executable path, engine-only args, WinSW wrapper, install/uninstall/start/stop command plan test를 추가한다.
- [x] system을 변경하지 않는 service command planning을 구현한다.

## Task 3: Smoke And Docs

- [x] `smoke:windows:service-host`가 tray plan과 service owner plan을 모두 검증하도록 확장한다.
- [x] Electron/Windows gap 문서에 Phase 2 slice 상태를 반영한다.
- [x] focused test, smoke, typecheck, lint, package lifecycle smoke를 실행한다.

## Task 4: 실제 서비스 등록/시작

- [x] `release\win-unpacked\codexwinmux.exe` 존재 여부와 timestamp를 확인한다.
- [x] WinSW executable을 service directory로 복사한다.
- [x] `codexwinmux-service.xml`을 생성한다.
- [x] `codexwinmux-service.exe install`을 실행한다.
- [x] `codexwinmux-service.exe start`를 실행한다.
- [x] `Get-Service`, TCP listener, `/api/health`, process tree로 실행 상태를 확인한다.

## Task 5: 승인된 운영 모델 고정

- [x] `LocalSystem + runbook-first`를 service host plan에 명시한다.
- [x] 전용 service account 전환을 장기 운영 host 승격 전 gate로 남긴다.
- [x] NSIS service install option을 deferred/default-off로 기록한다.
- [x] `scripts/windows-service.ps1` helper를 추가한다.
- [x] `smoke:windows:service-host`가 helper action set을 검증하도록 확장한다.

## 증거

- RED: `corepack pnpm test tests/unit/electron/engine-process.test.ts tests/unit/lib/windows-service-host.test.ts`는 `electron/engine-process`가 없고 canonical service owner env가 지원되지 않아 실패했다.
- GREEN: `corepack pnpm test tests/unit/electron/engine-process.test.ts tests/unit/lib/windows-service-host.test.ts tests/unit/electron/engine-controller.test.ts tests/unit/electron/runtime-env.test.ts`: 4개 파일, 26개 테스트 통과.
- `corepack pnpm smoke:windows:service-host`: `windows-service-owner-plan`, `windows-service-engine-flag`, `windows-service-winsw-wrapper`, `windows-service-non-mutating-commands` 통과.
- `corepack pnpm tsc --noEmit`: 통과.
- `corepack pnpm lint`: 통과.
- `corepack pnpm test`: 174개 파일 통과, 1개 skipped; 821개 테스트 통과, 1개 skipped.
- `corepack pnpm build:electron`: 통과.
- `corepack pnpm pack:electron:dev`: 통과.
- `corepack pnpm smoke:windows:engine-lifecycle`: 당시 packaged health commit `c1510c22`와 `ui-quit-engine-survival` 통과.
- `codexwinmux-service.exe install`: 통과.
- `codexwinmux-service.exe start`: 통과.
- `Get-Service -Name codexwinmux`: `Running`, `Automatic`, `Win32OwnProcess`.
- `Invoke-RestMethod http://127.0.0.1:8121/api/health`: 2026-05-16 KST 현재 service는 `app=codexwinmux`, `version=0.4.17`, `commit=d632d9c5`, `buildTime=2026-05-15T18:25:47.113Z`.
- `corepack pnpm smoke:windows:service-host`: `windows-service-runbook-helper` check 포함 통과.
- `corepack pnpm windows:service:status`: `codexwinmux Running Automatic Win32OwnProcess`.
- `corepack pnpm windows:service:health`: 2026-05-16 KST 현재 service는 `app=codexwinmux`, `version=0.4.17`, `commit=d632d9c5`.

## 검증 명령

```powershell
corepack pnpm test tests/unit/electron/engine-process.test.ts tests/unit/lib/windows-service-host.test.ts
corepack pnpm smoke:windows:service-host
corepack pnpm test tests/unit/electron/engine-controller.test.ts tests/unit/electron/runtime-env.test.ts
corepack pnpm tsc --noEmit
corepack pnpm lint
```
