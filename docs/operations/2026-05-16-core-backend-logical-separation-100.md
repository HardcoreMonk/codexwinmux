# 2026-05-16 Core/Backend 논리 분리 완료 handoff

## 결론

현재 milestone 기준으로 Core/Backend **논리 분리**는 완료 상태다. `default` runtime 경로에서
Core runtime v2가 terminal, storage, timeline, status, session projection의 source of truth를
소유하고, Backend는 HTTP/API/WebSocket adapter와 orchestration 경계로만 동작한다.

이 handoff의 "100%"는 작성 당시 runtime ownership과 source-of-truth 기준의 논리 완료를
뜻한다. 2026-05-18 현재는 이후 후속 작업으로 Backend/Core 물리 process/service 분리도
운영 기본값까지 승격됐다. 최신 완료 판정은 `docs/PROJECT-STATUS.md`와
`docs/operations/2026-05-17-core-backend-store-adapter-follow-up.md`를 우선한다.

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
- 현재 소스 HEAD에는 `codexwinmux.exe --codexwinmux-core`와 `dist/workers/core-engine-host.js` Core host foundation이 있다. 이 host는 BrowserWindow와 UI single-instance lock 없이 runtime Supervisor/workers를 시작하고 Core protocol에 응답한다.
- 엄격한 물리 분리 완료 기준은 `codexwinmux-backend`와 `codexwinmux-core` 또는 동등한 별도 lifecycle/process boundary가 split smoke와 release gate를 통과하는 것이다.

## 당시 남은 후속 작업과 현재 상태

| 당시 항목 | 현재 상태 |
| --- | --- |
| P3: Backend API/WebSocket을 Core client adapter로 전환 | 완료. Backend shared module과 API/WebSocket runtime path는 Core runtime API를 통과한다. |
| P4: `codexwinmux-backend`/`codexwinmux-core` split service mode 추가 | 완료. `0.4.18`부터 split service topology가 운영 기본값이다. |
| P5-P6: 독립 restart lifecycle smoke와 packaged/release split-mode evidence | 완료. split lifecycle, package gate, release gate, reboot-readiness evidence가 통과했다. |
| 외부 공개 배포: public SmartScreen reputation | 외부 공개 배포 전용으로 유지한다. 내부 폐쇄망 blocker가 아니다. |
| 외부 공개 배포: published public Phase 6 target URL | 외부 공개 배포 전용으로 유지한다. 내부 폐쇄망 blocker가 아니다. |
- 필요 시: non-terminal panel creation까지 runtime-owned storage command로 확장할지 별도 결정.
