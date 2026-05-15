# runtime v2 코어/백엔드 분리 후속 작업 기록

작성일: 2026-05-14

상태 갱신: 2026-05-16 기준 이 기록의 live/public gate 보류 문구는
`docs/RUNTIME-V2-CUTOVER.md`의 내부 폐쇄망 release scope로 대체한다. 현재
codexwinmux는 내부 폐쇄망 전용 배포이므로 public SmartScreen reputation과
published/public Phase 6 evidence는 외부 공개 배포 전용 gate이며, 내부 legacy JSON
fallback 제거는 signed/local package, 폐쇄망 Phase 6 target, status/timeline stale UI
evidence 기준으로 재개한다.

## 처리한 항목

- CLI plain terminal tab 생성 경로를 runtime v2 Supervisor/Storage Worker 경로로 이동했다.
- Storage default의 layout tab 생성과 CLI tab 생성에서 runtime storage 응답을 app-facing source로 반환하고 `layout` sync invalidation을 직접 broadcast한다.
- `smoke:runtime-v2:browser-sync`를 추가해 Windows에서도 tmux kill 없이 browser page-context `/api/sync` event와 workspace sidebar 갱신을 확인한다.
- Electron runtime v2 smoke의 Windows process-tree cleanup을 보정하고 `CODEXWINMUX_ELECTRON_*` preferred env를 읽게 했다.
- ADB는 winget `Google.PlatformTools`로 설치했다.
- 실제 Android 기기 `R3CX10RTWFH`/SM-S928N(Android 16)에 설치된 `com.hardcoremonk.codexwinmux` `0.4.16` debug app을 확인했다.
- Windows 앱 범위에서 `workspace`, `layout`, `config`, `keybindings` stale sync 경로를 확장 검증했다.
- 브라우저 sync refetch는 `cache: 'no-store'` 요청과 API `Cache-Control: no-store` 응답으로 304 캐시 경로를 차단했다.
- runtime v2 browser sync fixture는 빈 active workspace 자동 삭제와 충돌하지 않도록 workspace 생성 직후 terminal tab을 함께 생성한다.
- smoke server는 Windows에서 `cmd.exe`/`corepack` wrapper PID가 남지 않도록 local `tsx` CLI를 `node`로 직접 실행하고 process tree를 정리한다.
- Android runtime v2 smoke는 Windows host의 Tailscale IPv4가 없을 때 USB `adb reverse` target URL을 명시해 실행할 수 있음을 확인했다.
- Android logcat blocking 판정은 Next dev HMR static indicator의 known `components` TypeError warning을 제품 failure로 오판하지 않도록 보정했다.

## 실행 결과

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| CLI/runtime storage unit | 통과 | `corepack pnpm test tests/unit/pages/cli-tabs-api.test.ts` |
| layout tab sync unit | 통과 | `corepack pnpm test tests/unit/pages/layout-tabs-api.test.ts` |
| browser sync helper unit | 통과 | `corepack pnpm test tests/unit/scripts/browser-sync-smoke-lib.test.ts` |
| browser sync smoke | 통과 | `corepack pnpm smoke:runtime-v2:browser-sync`, workspace sync event와 UI 갱신 확인 |
| Electron runtime v2 smoke | 통과 | `CODEXWINMUX_ELECTRON_SMOKE_TIMEOUT_MS=60000 corepack pnpm smoke:electron:runtime-v2`, initial + reconnect 2회 marker 확인 |
| Android install smoke | 통과 | `corepack pnpm smoke:android:install`, `com.hardcoremonk.codexwinmux`, `versionName=0.4.16`, `versionCode=416`, `lastUpdateTime=2026-05-14 18:40:47` |
| Android runtime v2 smoke | 통과 | USB `adb reverse` target `http://127.0.0.1:2579`, `corepack pnpm smoke:android:runtime-v2`, SM-S928N Android 16, initial + 2회 foreground `/api/v2/terminal` marker output, blocking console/logcat 0 |
| Phase 6 live/default gate | 미통과 | live URL 미지정 상태에서 `corepack pnpm smoke:runtime-v2:phase6-default-gate`가 기본 `http://127.0.0.1:8121` fetch 실패 |
| status/timeline Windows fixture | 미통과 | `smoke:runtime-v2:status-default`, `smoke:runtime-v2:timeline-websocket-default`는 현재 fixture가 `tmux`를 직접 호출해 Windows host에서 `spawnSync tmux ENOENT` |
| Windows browser sync stale matrix | 통과 | `corepack pnpm smoke:runtime-v2:browser-sync`, workspace create/rename/group/order, layout tab create/patch/reorder/split/move/patch/close, config/keybinding refetch 확인 |
| Windows 단위/정적 검증 | 통과 | `corepack pnpm tsc --noEmit`, `corepack pnpm lint`, `corepack pnpm test` |

## 남은 gate

- 운영/live URL을 `CODEXWINMUX_RUNTIME_V2_PHASE6_GATE_URL`로 지정한 뒤 `corepack pnpm smoke:runtime-v2:phase6-default-gate` 재실행.
- `smoke:runtime-v2:status-default`와 `smoke:runtime-v2:timeline-websocket-default`를 Windows runtime adapter 또는 tmux-free fixture로 전환해 status/timeline stale UI evidence를 수집한다.
- 내부 폐쇄망 기준 legacy JSON fallback 제거는 signed/local package, 폐쇄망 Phase 6 target, Windows-compatible status/timeline smoke 기준으로 재개한다. Public Phase 6와 public SmartScreen evidence는 외부 공개 배포 전용 gate로 분리한다.
- 현재 추가 검증은 Windows `codexwinmux` 로컬 앱 범위로 한정했다. Linux `codexmux` live service와 Tailscale Serve 운영 상태는 변경하지 않았다.
