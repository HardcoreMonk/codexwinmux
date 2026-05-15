# 2026-05-16 Core/Backend 논리 분리 완료 handoff

## 결론

현재 milestone 기준으로 Core/Backend **논리 분리**는 완료 상태다. `default` runtime 경로에서
Core runtime v2가 terminal, storage, timeline, status, session projection의 source of truth를
소유하고, Backend는 HTTP/API/WebSocket adapter와 orchestration 경계로만 동작한다.

단, 이 문서의 "100%"는 runtime ownership과 source-of-truth 기준의 논리 완료를 뜻한다.
Backend API host와 Core Supervisor를 별도 process/service로 나누는 **물리 process 분리**는
완료 범위가 아니며 `Core/Backend 100% Physical Separation` milestone으로 별도 추적한다.

## 변경 요약

- runtime storage default read failure가 legacy JSON fallback으로 숨겨지지 않도록 `RuntimeStorageUnavailableError` typed failure로 fail closed한다.
- workspace/layout/message-history read는 runtime default에서 SQLite projection을 source of truth로 사용한다.
- legacy JSON은 명시적 `off` rollback path와 rollback mirror artifact로만 유지한다.
- workspace directory update는 runtime default에서 SQLite `workspace_directories`로 write-through한다.
- storage default smoke의 `message-history-json-fallback-mirror` 명칭을 `message-history-json-rollback-mirror`로 바꿔 의미를 고정했다.
- 문서의 내부 폐쇄망 release gate와 외부 공개 SmartScreen/public URL gate를 분리했다.

## 검증 증거

- `corepack pnpm test tests/unit/lib/runtime/storage-read-owner.test.ts`: 통과.
- `corepack pnpm test tests/unit/lib/runtime/storage-read-owner.test.ts tests/unit/lib/workspace-store.test.ts tests/unit/lib/layout-store.test.ts tests/unit/lib/runtime/message-history-default-read.test.ts tests/unit/lib/runtime/storage-write-ownership.test.ts tests/unit/pages/cli-tabs-api.test.ts tests/unit/pages/layout-tabs-api.test.ts tests/unit/lib/runtime/status-worker-service.test.ts`: 8개 파일, 42개 테스트 통과.
- `corepack pnpm smoke:runtime-v2:storage-default-read`: SQLite cold read, workspace directory/sidebar/status/message-history hydration, rollback mirror 검증 통과.
- `corepack pnpm smoke:runtime-v2:status-default`: Windows runtime tab fixture에서 status WebSocket, needs-input, ack 후 busy 복귀 통과.
- `corepack pnpm smoke:runtime-v2:timeline-websocket-default`: Windows runtime tab fixture에서 init 2 entries, append 1 entry, runtime counter init/append 1 통과.
- `corepack pnpm smoke:runtime-v2:status-timeline-stale-ui`: foreground reconnect 뒤 timeline append와 status 입력 대기 UI 반영 통과.
- `corepack pnpm smoke:runtime-v2:phase6-default-gate`: local closed-network target에서 terminal `new-tabs`, storage/timeline/status `default`, worker diagnostics clean 통과.
- `corepack pnpm smoke:android:runtime-v2`: 실제 Android 기기 `R3CX10RTWFH`의 `com.hardcoremonk.codexwinmux` `0.4.17`에서 password 이후 codexwinmux flow 유지, blocking console/logcat 0 통과.
- `corepack pnpm tsc --noEmit`: 통과.
- `corepack pnpm lint`: 통과.
- `corepack pnpm test`: 173개 파일 통과, 1개 skipped, 815개 테스트 통과.
- `corepack pnpm smoke:windows:signing-evidence`: 내부 code signing certificate와 RFC3161 timestamp 증거 통과.
- `corepack pnpm smoke:windows:package-gate`: zip/update metadata/local updater/packaged launch/engine lifecycle/packaged runtime v2/installer runtime v2 통과.

## 운영 판단

내부 폐쇄망 기준에서는 public SmartScreen reputation과 published public Phase 6 URL 증거가 blocker가
아니다. 외부 공개 배포를 재개할 때만 public SmartScreen reputation 확보와 public evidence smoke를
release blocker로 승격한다.

## 물리 분리 경계

- 현재 runtime v2 worker boundary는 `storage-worker`, `terminal-worker`, `timeline-worker`, `status-worker` child process까지 닫혔다.
- 현재 Windows service owner는 `codexwinmux.exe --codexwinmux-engine` combined engine process를 실행한다.
- combined engine process 안에는 Backend API host와 Core Supervisor가 함께 있다.
- 엄격한 물리 분리 완료 기준은 `codexwinmux-backend`와 `codexwinmux-core` 또는 동등한 별도 lifecycle/process boundary가 split smoke와 release gate를 통과하는 것이다.

## 남은 후속 작업

- Phase 2: Core/Backend 물리 process 분리 설계와 구현.
- 외부 공개 배포 재개 시: public SmartScreen reputation 확보 후 public evidence smoke 재실행.
- 외부 공개 배포 재개 시: published public Phase 6 target URL 지정 후 `smoke:runtime-v2:phase6-default-gate` 재실행.
- 필요 시: non-terminal panel creation까지 runtime-owned storage command로 확장할지 별도 결정.
