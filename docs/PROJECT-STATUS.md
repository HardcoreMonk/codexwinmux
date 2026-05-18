# 프로젝트 진행 상황

최종 갱신: 2026-05-18  
기준 버전: `0.4.19`  
기준 commit: `06b4285b`

이 문서는 `codexwinmux`의 현재 개발 상태를 판단하는 canonical status 문서다.
과거 `operations/` handoff와 `superpowers/plans/` 문서는 작성 시점의 의사결정과
검증 기록으로 보존한다. 최신 완료 여부를 판단할 때는 이 문서를 먼저 보고,
세부 근거가 필요할 때 각 근거 문서로 내려간다.

## 요약 판정

| 영역 | 현재 상태 | 운영 기준 |
| --- | --- | --- |
| Core runtime v2 | 완료 | terminal/storage/timeline/status default 경로가 worker/runtime v2를 사용한다. |
| Core/Backend 논리 분리 | 완료 | Core가 source of truth를 소유하고 Backend는 HTTP/API/WebSocket adapter와 orchestration 경계로 남는다. |
| Core/Backend 물리 분리 | 완료 | `codexwinmux-core`와 `codexwinmux-backend` split service가 기본 topology다. |
| Backend direct Supervisor 제거 | 완료 | Backend shared module과 API route는 Core runtime API를 통과한다. |
| Runtime timeline surface 분리 | 완료 | `timeline-ws`와 `timeline-live-shadow`는 `timeline-runtime-adapter` 경계를 통과한다. |
| 내부 폐쇄망 release gate | 통과 | signed/local package, split service health, Phase 6, stale UI evidence를 기준으로 판단한다. |
| 외부 공개 release gate | 보류 | public SmartScreen reputation과 published/public Phase 6 URL evidence는 외부 공개 배포 시에만 필요하다. |

## 코어 로직

Core는 runtime v2 source of truth를 소유한다.

- Terminal Worker는 runtime terminal session lifecycle과 `/api/v2/terminal` attach/stdin/stdout/resize 경로를 소유한다.
- Storage Worker는 `~/.codexwinmux/runtime-v2/state.db` SQLite app state를 소유한다.
- Timeline Worker는 timeline read/live/session-watch delivery를 소유한다.
- Status Worker는 default mode에서 `StatusManager` live state machine, polling, JSONL watch, ack/dismiss, session history, Web Push, rate-limit update를 소유한다.
- Core process host는 `codexwinmux.exe --codexwinmux-core`와 `src/workers/core-engine-host.ts`이며, BrowserWindow와 UI single-instance lock 없이 runtime Supervisor/workers를 시작한다.

완료 근거:

- `docs/ARCHITECTURE-LOGIC.md`
- `docs/RUNTIME-V2-CUTOVER.md`
- `docs/RUNTIME-V2-PARITY.md`
- `docs/operations/2026-05-16-core-backend-logical-separation-100.md`

## 백엔드 로직

Backend는 Core source of truth를 직접 소유하지 않는다. 현재 역할은 HTTP/API/WebSocket
adapter, 기존 client protocol bridge, sync broadcast, orchestration boundary다.

- Backend Core transport 기본값은 loopback TCP다.
- `src/lib/core-engine/runtime-api.ts`는 in-process Core fallback 없이 TCP Core client를 사용한다.
- `layout-store`, `workspace-store`, `status-manager`, `status-server`, session history/Web Push adapter, `timeline-server`, `tab-session-cleanup`은 runtime default 경로에서 Core runtime API를 통과한다.
- `timeline-ws`와 `timeline-live-shadow`는 직접 Supervisor fallback 없이 `timeline-runtime-adapter`를 통과한다.
- direct import policy test는 API route, Backend shared module, Core client adapter, runtime timeline surface의 Supervisor 직접 import를 차단한다.

완료 근거:

- `docs/operations/2026-05-17-core-backend-store-adapter-follow-up.md`
- `docs/FOLLOW-UP.md`
- `tests/unit/pages/runtime-direct-import-policy.test.ts`

## 현재 실행 상태

2026-05-18 elevated Windows host에서 재빌드와 service restart를 수행했다.

- `pack:electron:dev`: 통과
- `windows:service-account:restart-services`: 통과
- `windows:service-account:health`: `version=0.4.19`, `commit=06b4285b`, `buildTime=2026-05-18T06:53:16.750Z`
- `windows:service-account:verify-reboot-readiness`: `ok=true`
- `smoke:runtime-v2:phase6-default-gate`: 통과, failures `[]`
- Android device `R3CX10RTWFH`: ADB 인식 확인

## 남은 작업 분류

내부 폐쇄망 운영 기준에서 Core/Backend 분리와 runtime v2 기본 경로는 완료다.
남은 작업은 기능 완성 blocker가 아니라 배포 범위 또는 정리 작업으로 분류한다.

| 분류 | 작업 | 상태 |
| --- | --- | --- |
| 외부 공개 배포 | public SmartScreen reputation 확보 후 public evidence smoke 재실행 | 외부 공개 배포 전용 |
| 외부 공개 배포 | published/public Phase 6 target URL 지정 후 gate 재실행 | 외부 공개 배포 전용 |
| 운영 UX | service-owned engine stop/restart를 Electron UI에서 어떻게 표현할지 결정 | 선택적 개선 |
| Android 정리 | 기기에 남은 legacy `com.hardcoremonk.codexmux` package 정리 여부 결정 | 선택적 운영 정리 |
| 장기 cleanup | rollback JSON artifact와 legacy 호환 레이어 sunset | 별도 release gate 필요 |

## 문서 판정 규칙

1. 최신 상태 판단은 이 문서, `README.md`, `docs/ARCHITECTURE-LOGIC.md`,
   `docs/RUNTIME-V2-CUTOVER.md`, `docs/FOLLOW-UP.md` 순서로 한다.
2. `docs/operations/`는 시점별 handoff다. 문서 안의 "남은 작업"은 작성 당시 기준일 수 있다.
3. `docs/superpowers/plans/`와 `docs/superpowers/specs/`는 계획/설계 산출물이다.
   완료 여부 판단은 최신 handoff와 status 문서를 우선한다.
4. 내부 폐쇄망 기준과 외부 공개 배포 기준은 분리한다. public SmartScreen 미확보는
   내부 폐쇄망 운영 blocker가 아니다.
