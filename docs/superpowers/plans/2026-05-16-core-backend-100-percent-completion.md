# Core/Backend 100% 완료 실행 계획

> **에이전트 실행 규칙:** 이 계획을 실행할 때는 `superpowers:executing-plans` 절차를 사용한다.

## 목표

Core Engine과 Backend Engine의 논리 분리를 현재 milestone 기준으로 100% 완료한다.
runtime v2 기본 경로에서는 Core가 terminal, storage, timeline, status, session projection의
단일 소유자가 되고, Backend는 HTTP/API/WebSocket adapter와 orchestration 경계로만 동작한다.

## 아키텍처 범위

이번 완료 범위는 Phase 1 논리 분리다. Electron Shell Host는 UI, tray, packaged lifecycle을
담당하고, Backend/Core Engine은 같은 local engine process 안에서 동작하되 명확한 API
경계를 유지한다. 별도 Windows Service owner 또는 Core/Backend 개별 서비스 프로세스
분리는 Phase 2 후속 범위로 둔다.

## 완료 정의

이 계획에서 “100% 완료”는 다음 조건을 모두 만족하는 상태다.

1. `CODEXWINMUX_RUNTIME_STORAGE_MODE=default`에서 workspace/layout/message-history가 legacy JSON을 조용히 읽어 복구하지 않는다.
2. runtime v2 storage read/write 오류는 typed failure로 드러나며, Backend API는 stale JSON 대신 명시적 오류 또는 empty runtime state를 반환한다.
3. legacy JSON store는 명시적 rollback/off mode에서만 사용된다.
4. `/api/status`, `/api/timeline`, terminal/session 관련 화면이 runtime v2 상태를 기준으로 stale UI 없이 갱신된다.
5. Electron UI 종료 후 engine 생존 smoke가 통과하고, engine 종료는 tray/명시적 quit 정책을 따른다.
6. 내부 폐쇄망 릴리스 기준에서 Windows local/closed-network smoke와 Android LAN smoke가 통과한다.

## 제외 범위

별도 Windows Service 설치, public SmartScreen reputation, public Phase 6 target URL smoke는
이번 100% 논리 분리의 blocker가 아니다. 외부 공개 배포를 다시 목표로 잡을 때 별도 gate로
재개한다.

## 우선순위

1. **P0: 완료 계약 고정**
   - 문서의 외부 공개 gate와 내부 폐쇄망 gate를 분리된 기준으로 재확인한다.
   - stale parity 문구를 최신 내부 기준으로 정리한다.
   - 현재 smoke가 무엇을 증명하고 무엇을 증명하지 않는지 표로 고정한다.

2. **P0: runtime default JSON fallback read 제거**
   - `workspace-store`, `layout-store`, `message-history-store`에서 runtime default일 때 JSON read fallback을 제거한다.
   - runtime default read 실패는 `RuntimeStorageUnavailableError` typed error로 표면화한다.

3. **P1: runtime write ownership 강화**
   - runtime default write 실패 시 JSON write로 우회하지 않는다.
   - explicit rollback/off mode의 JSON write path와 runtime default path를 분리한다.

4. **P1: status/timeline stale UI 증거 확보**
   - status-default/timeline-websocket-default가 runtime adapter 또는 tmux-free fixture에서 stale UI 없이 통과하도록 고정한다.
   - Android LAN WebView smoke에서 앱명, icon, password, LAN endpoint 흐름을 함께 확인한다.

5. **P1: Electron/engine lifecycle 검증**
   - packaged Windows app에서 UI close가 engine stop으로 이어지지 않음을 재검증한다.
   - “서비스 분리”가 아직 Windows Service owner를 뜻하지 않음을 문서에 명시한다.

6. **P2: 최종 legacy cleanup gate**
   - legacy JSON fallback 제거 후 package gate, runtime v2 gate, Android LAN smoke를 통과시킨다.
   - 통과 후 문서, release notes, follow-up 목록을 갱신하고 commit/push한다.

## 작업 1: 완료 계약 고정

대상 파일:

- `D:\data\projects\codex-zone\codexwinmux\docs\RUNTIME-V2-CUTOVER.md`
- `D:\data\projects\codex-zone\codexwinmux\docs\RUNTIME-V2-PARITY.md`
- `D:\data\projects\codex-zone\codexwinmux\README.md`

실행 내용:

1. `RUNTIME-V2-CUTOVER.md`의 internal closed-network 기준을 100% 논리 분리 gate로 연결한다.
2. `RUNTIME-V2-PARITY.md`에서 public/live Phase 6 evidence missing 문구가 내부 폐쇄망 blocker처럼 읽히는 부분을 정리한다.
3. `README.md`의 engine split 설명에 “Backend/Core는 같은 local engine process 안에서 논리 분리되어 있으며 Windows Service owner는 Phase 2” 문구를 추가한다.
4. 남은 ambiguous 문구를 검색해 정리한다.

## 작업 2: runtime default no-fallback 실패 테스트 추가

대상 파일:

- `D:\data\projects\codex-zone\codexwinmux\tests`
- `D:\data\projects\codex-zone\codexwinmux\src\lib\runtime\storage-read-owner.ts`
- `D:\data\projects\codex-zone\codexwinmux\src\lib\workspace-store.ts`
- `D:\data\projects\codex-zone\codexwinmux\src\lib\layout-store.ts`
- `D:\data\projects\codex-zone\codexwinmux\src\lib\message-history-store.ts`

실행 내용:

1. 기존 storage/workspace/layout/message-history 테스트 위치를 확인한다.
2. runtime default에서 runtime read가 실패할 때 JSON fallback을 읽지 않는 테스트를 추가한다.
3. layout read도 같은 기준으로 고정한다.
4. message-history read는 runtime default에서 workspace projection 누락을 JSON으로 숨기지 않는지 검증한다.
5. explicit off/rollback mode에서는 기존 JSON path가 살아 있는 테스트를 별도로 둔다.

## 작업 3: typed runtime storage failure 구현

대상 파일:

- `D:\data\projects\codex-zone\codexwinmux\src\lib\runtime\storage-read-owner.ts`

실행 내용:

1. runtime default read 실패를 나타내는 `RuntimeStorageUnavailableError`를 추가한다.
2. runtime default/off mode 처리를 helper로 모은다.
3. `readRuntimeStorageWorkspaces`, `readRuntimeStorageLayout`, `readRuntimeMessageHistory`가 runtime default에서는 fallback용 `null`을 반환하지 않게 한다.
4. runtime disabled/off mode에서는 기존처럼 `null`을 반환해 JSON rollback path를 허용한다.
5. runtime default path의 logging에서 `falling back to JSON` 의미를 제거한다.

## 작업 4: default store의 JSON read fallback 제거

대상 파일:

- `D:\data\projects\codex-zone\codexwinmux\src\lib\workspace-store.ts`
- `D:\data\projects\codex-zone\codexwinmux\src\lib\layout-store.ts`
- `D:\data\projects\codex-zone\codexwinmux\src\lib\message-history-store.ts`

실행 내용:

1. `workspace-store`에서 runtime default일 때 `readRuntimeStorageWorkspaces()` 결과가 없거나 실패하면 JSON을 읽지 않는다.
2. `initWorkspaceStore`, `getWorkspaces`, `getActiveWorkspaceId`, `getWorkspaceById`의 fallback 조건을 runtime disabled/off mode로 제한한다.
3. `layout-store`의 `readLayoutFile`에서 runtime default일 때 JSON `layout.json`으로 내려가지 않는다.
4. `message-history-store`의 `readMessageHistory`에서 runtime default일 때 legacy message-history JSON을 읽지 않는다.
5. `updateWorkspaceDirectories`처럼 runtime mode와 무관하게 JSON을 직접 쓰는 helper를 분류한다.

## 작업 5: runtime default write ownership 강화

대상 파일:

- `D:\data\projects\codex-zone\codexwinmux\src\lib\workspace-store.ts`
- `D:\data\projects\codex-zone\codexwinmux\src\lib\layout-store.ts`
- `D:\data\projects\codex-zone\codexwinmux\src\lib\message-history-store.ts`
- `D:\data\projects\codex-zone\codexwinmux\src\lib\runtime\storage-read-owner.ts`

실행 내용:

1. runtime default write 실패가 JSON write로 우회되지 않도록 테스트를 추가한다.
2. `writeRuntimeWorkspaceUiState`, `writeRuntimeStorageLayout`, `writeRuntimeMessageHistory`의 failure contract를 통일한다.
3. message-history의 JSON mirror write는 rollback artifact로만 유지하고 default read source of truth로 사용하지 않는다.
4. 유지하는 mirror write를 문서에 “rollback artifact, runtime default source of truth 아님”으로 명시한다.

## 작업 6: Core/Backend 분리 증거 재실행

검증 명령:

```powershell
corepack pnpm test
corepack pnpm smoke:runtime-v2:phase6-default-gate
corepack pnpm smoke:runtime-v2:status-default
corepack pnpm smoke:runtime-v2:timeline-websocket-default
corepack pnpm smoke:windows:engine-lifecycle
corepack pnpm smoke:windows:package-gate
corepack pnpm smoke:android:runtime-v2
git diff --check
```

기대 증거:

- Phase 6 default gate가 legacy JSON fallback 없이 통과한다.
- status/timeline smoke가 runtime adapter 기반 stale UI recovery를 증명한다.
- packaged Windows lifecycle smoke가 UI close 후 engine 생존을 증명한다.
- Android LAN smoke가 password 입력 뒤 codexwinmux flow가 유지됨을 증명한다.

## 작업 7: 최종 문서와 release 기록

대상 파일:

- `D:\data\projects\codex-zone\codexwinmux\docs\RUNTIME-V2-CUTOVER.md`
- `D:\data\projects\codex-zone\codexwinmux\docs\RUNTIME-V2-PARITY.md`
- `D:\data\projects\codex-zone\codexwinmux\docs\operations`
- `D:\data\projects\codex-zone\codexwinmux\README.md`

실행 내용:

1. Core/Backend 논리 분리 완료 상태를 한국어로 기록한다.
2. Windows Service owner/물리 분리는 Phase 2 follow-up으로 남긴다.
3. public SmartScreen/public URL evidence는 외부 공개 배포 follow-up으로만 유지한다.
4. 내부 폐쇄망 릴리스 기준 smoke 결과를 operations handoff에 기록한다.
5. 변경 묶음을 commit/push한다.

## 완료 체크리스트

- [x] runtime default에서 workspace JSON read fallback 없음
- [x] runtime default에서 layout JSON read fallback 없음
- [x] runtime default에서 message-history JSON read fallback 없음
- [x] explicit off/rollback mode JSON path 테스트 유지
- [x] status/timeline stale UI evidence 통과
- [x] Windows packaged lifecycle evidence 통과
- [x] Android LAN runtime evidence 통과
- [x] 문서가 내부 폐쇄망 gate와 외부 공개 gate를 혼동하지 않음
- [x] Core/Backend 논리 분리 완료와 Windows Service Phase 2가 분리되어 기록됨
