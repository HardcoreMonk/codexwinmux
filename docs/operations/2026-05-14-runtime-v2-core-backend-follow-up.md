# runtime v2 코어/백엔드 분리 후속 작업 기록

작성일: 2026-05-14

## 처리한 항목

- CLI plain terminal tab 생성 경로를 runtime v2 Supervisor/Storage Worker 경로로 이동했다.
- Storage default의 layout tab 생성과 CLI tab 생성에서 runtime storage 응답을 app-facing source로 반환하고 `layout` sync invalidation을 직접 broadcast한다.
- `smoke:runtime-v2:browser-sync`를 추가해 Windows에서도 tmux kill 없이 browser page-context `/api/sync` event와 workspace sidebar 갱신을 확인한다.
- Electron runtime v2 smoke의 Windows process-tree cleanup을 보정하고 `CODEXWINMUX_ELECTRON_*` preferred env를 읽게 했다.
- ADB는 winget `Google.PlatformTools`로 설치했다.
- Windows 앱 범위에서 `workspace`, `layout`, `config`, `keybindings` stale sync 경로를 확장 검증했다.
- 브라우저 sync refetch는 `cache: 'no-store'` 요청과 API `Cache-Control: no-store` 응답으로 304 캐시 경로를 차단했다.
- runtime v2 browser sync fixture는 빈 active workspace 자동 삭제와 충돌하지 않도록 workspace 생성 직후 terminal tab을 함께 생성한다.
- smoke server는 Windows에서 `cmd.exe`/`corepack` wrapper PID가 남지 않도록 local `tsx` CLI를 `node`로 직접 실행하고 process tree를 정리한다.

## 실행 결과

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| CLI/runtime storage unit | 통과 | `corepack pnpm test tests/unit/pages/cli-tabs-api.test.ts` |
| layout tab sync unit | 통과 | `corepack pnpm test tests/unit/pages/layout-tabs-api.test.ts` |
| browser sync helper unit | 통과 | `corepack pnpm test tests/unit/scripts/browser-sync-smoke-lib.test.ts` |
| browser sync smoke | 통과 | `corepack pnpm smoke:runtime-v2:browser-sync`, workspace sync event와 UI 갱신 확인 |
| Electron runtime v2 smoke | 통과 | `CODEXWINMUX_ELECTRON_SMOKE_TIMEOUT_MS=60000 corepack pnpm smoke:electron:runtime-v2`, initial + reconnect 2회 marker 확인 |
| Android runtime v2 smoke | 미통과 | ADB 설치 후 `adb devices -l` 실행 가능, 연결 기기 없음: `connected=-` |
| Phase 6 default gate | 로컬 target 통과 | temp runtime v2 default server를 target URL로 지정해 worker health/mode/counter 확인 |
| Windows browser sync stale matrix | 통과 | `corepack pnpm smoke:runtime-v2:browser-sync`, workspace create/rename/group/order, layout tab create/patch/reorder/split/move/patch/close, config/keybinding refetch 확인 |
| Windows 단위/정적 검증 | 통과 | `corepack pnpm tsc --noEmit`, `corepack pnpm lint`, `corepack pnpm test` |

## 남은 gate

- 실제 Android 기기 또는 self-hosted Android runner 연결 후 `corepack pnpm smoke:android:runtime-v2` 재실행.
- 운영/live URL을 `CODEXWINMUX_RUNTIME_V2_PHASE6_GATE_URL`로 지정한 뒤 `corepack pnpm smoke:runtime-v2:phase6-default-gate` 재실행.
- Android/live evidence와 rollback smoke가 닫히기 전까지 legacy JSON fallback 제거는 보류.
- 현재 추가 검증은 Windows `codexwinmux` 로컬 앱 범위로 한정했다. Linux `codexmux` live service, Android app, Tailscale Serve 증거 수집은 별도 승인 전까지 보류한다.
