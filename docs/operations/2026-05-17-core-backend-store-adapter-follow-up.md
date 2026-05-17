# 2026-05-17 Core/Backend adapter 후속 작업

## 결론

Core/Backend 분리 후속 작업으로 Backend 공유 store 계층의 직접 runtime Supervisor 의존성을
한 단계 더 제거했다. `layout-store`와 `workspace-store`의 runtime v2 default mutation 경로는
이제 `core-engine/runtime-api` client adapter를 통해 Core process로 요청한다.
추가 후속 slice에서 `status-manager`, `status-server`, status session history/Web Push adapter,
`timeline-server`, `tab-session-cleanup`의 직접 runtime Supervisor 호출도 Core runtime API로
전환했다.

이번 slice는 source 기준 변경 뒤 Windows app 재빌드와 split service 재시작까지 완료했다.
현재 live health는 source commit `38ec650c`, build time `2026-05-17T08:35:21.621Z`를
반환한다. commit 값은 현재 변경이 아직 commit되지 않아 기존 HEAD를 가리킨다.

## 변경 요약

- Core protocol에 workspace rename/group/order, layout mutation, tab status metadata 명령을 추가했다.
- `layout-store`의 runtime v2 tab restart, pane/layout mutation, tab metadata update/read를 Core runtime API 경유로 전환했다.
- `workspace-store`의 workspace create/delete/rename, group create/rename/collapse/delete/reorder, workspace reorder/group assign을 Core runtime API 경유로 전환했다.
- Core protocol에 terminal session info, status policy shadow, session history, Web Push, status live client/sync/subscribe command를 추가했다.
- `status-manager`, `status-server`, `status-session-history-adapter`, `status-web-push-adapter`, `timeline-server`, `tab-session-cleanup`의 runtime default path를 Core runtime API 경유로 전환했다.
- direct import policy test가 API route뿐 아니라 Backend shared store/status/timeline/cleanup 모듈과 Core client adapter도 runtime Supervisor를 직접 import하지 못하게 검증한다.

## 검증 증거

- `corepack pnpm exec vitest run tests/unit/lib/layout-store.test.ts tests/unit/lib/core-engine/contracts.test.ts tests/unit/lib/core-engine/server.test.ts`: 통과.
- `corepack pnpm exec vitest run tests/unit/lib/workspace-store.test.ts tests/unit/lib/core-engine/contracts.test.ts tests/unit/lib/core-engine/server.test.ts tests/unit/pages/runtime-direct-import-policy.test.ts`: 통과.
- `corepack pnpm exec vitest run tests/unit/lib/workspace-store.test.ts tests/unit/lib/layout-store.test.ts tests/unit/lib/core-engine/contracts.test.ts tests/unit/lib/core-engine/server.test.ts tests/unit/pages/runtime-direct-import-policy.test.ts tests/unit/pages/layout-tab-api.test.ts`: 6개 파일, 29개 테스트 통과.
- `corepack pnpm exec vitest run tests/unit/lib/workspace-store.test.ts tests/unit/lib/layout-store.test.ts tests/unit/lib/core-engine/contracts.test.ts tests/unit/lib/core-engine/server.test.ts tests/unit/lib/tab-session-cleanup.test.ts tests/unit/pages/runtime-direct-import-policy.test.ts tests/unit/pages/layout-tab-api.test.ts tests/unit/lib/status-side-effect-adapter.test.ts`: 8개 파일, 35개 테스트 통과.
- `corepack pnpm exec tsc --noEmit`: 통과.
- `corepack pnpm lint`: 통과.
- 첫 `corepack pnpm pack:electron:dev`는 기존 service가 `release/win-unpacked/codexwinmux.exe`를 점유해 packaging 단계에서 `Access is denied`로 중단됐다.
- `corepack pnpm windows:service-account:stop-services`: `codexwinmux-backend`, `codexwinmux-core` 중지 통과.
- `corepack pnpm pack:electron:dev`: Next build, post-build, tsup, Electron `win-unpacked` packaging/signing 통과.
- `corepack pnpm windows:service-account:restart-services`: `codexwinmux-core`, `codexwinmux-backend` 시작 통과.
- `corepack pnpm windows:service:status`: 두 service 모두 `Running`, `Automatic`.
- `corepack pnpm windows:service-account:health`: `app=codexwinmux`, `version=0.4.19`, `commit=38ec650c`, `buildTime=2026-05-17T08:35:21.621Z`.
- `CODEXWINMUX_RUNTIME_V2_SMOKE_URL=http://127.0.0.1:8121 corepack pnpm smoke:runtime-v2:phase6-default-gate`: terminal `new-tabs`, storage/timeline/status `default`, worker diagnostics clean, failures `[]`.
- `corepack pnpm windows:service-account:verify-reboot-readiness`: `ok=true`, 두 split service `Running/Auto`, service account `.\codexwinmux-svc`.

## 남은 후속 작업

- 남은 직접 Supervisor import는 `src/workers/core-engine-host.ts`와 runtime-owned `src/lib/runtime/timeline-ws.ts`, `src/lib/runtime/timeline-live-shadow.ts`로 한정된다. Core host는 runtime Supervisor 소유자라 허용 경로이고, runtime-owned timeline modules는 별도 adapter 분리 여부를 다음 slice에서 결정한다.
- 현재 변경을 commit/push할 때 build info commit hash가 새 commit을 가리키도록 Windows artifact를 다시 빌드할지 결정한다.
