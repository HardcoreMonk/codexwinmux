# 문서 맵

이 디렉터리는 codexwinmux의 내부 구현, 운영, 플랫폼 기준 문서를 모은다. 현재
제품 기준은 Windows 설치형 앱이며, 저장소 루트의 `README.md`는 설치와 주요
기능의 빠른 안내를 담당한다. 비-Windows 문서는 남아 있더라도 현재 제품 목표가
아니라 legacy/reference로 본다.

## 핵심 기준 문서

| 문서 | 기준 |
| --- | --- |
| `ADR.md` | 오래가는 아키텍처 결정과 변경 트리거 |
| `ARCHITECTURE-LOGIC.md` | 서버, WebSocket, workspace, terminal, timeline, status, sync 서비스 흐름 |
| `STATUS.md` | Codex 작업 상태 감지, 상태 전이, 알림, timeline metadata |
| `TMUX.md` | tmux session, terminal WebSocket, key input, Codex process 감지 |
| `DATA-DIR.md` | `~/.codexwinmux/` 저장 구조와 삭제 기준 |
| `PERFORMANCE.md` | 성능 계측, 최적화 우선순위, 검증 기준 |
| `TESTING.md` | unit/type/lint/build, Playwright/Chromium, platform smoke, live deploy 검증 기준 |
| `RUNTIME-V2-CUTOVER.md` | Supervisor/Worker runtime v2 production 전환 단계, flag, rollback 기준 |
| `RUNTIME-V2-PARITY.md` | runtime v2 surface별 v1/v2 parity, migration, test, rollback matrix |
| `WINDOWS-ONLY-GAP-AUDIT.md` | Windows-only 제품 전환 gap audit와 runtime/process/host 전환 후보 |

## 운영과 플랫폼

| 문서 | 기준 |
| --- | --- |
| `ELECTRON.md` | Windows Electron shell, engine lifecycle, packaging, updater, native notification |
| `SYSTEMD.md` | legacy Linux `systemd --user` reference. 현재 Windows 제품 운영 기준 아님 |
| `ANDROID.md` | legacy/deferred Android Capacitor shell reference. 현재 Windows 제품 운영 기준 아님 |
| `TAURI-EVALUATION.md` | Rust + Tauri 도입 타당성 조사와 PoC 기준. 현재 제품 전환 범위 아님 |
| `STYLE.md` | theme, color, terminal/mobile UI 규칙 |

## 작업 관리

| 문서 | 기준 |
| --- | --- |
| `FOLLOW-UP.md` | release 전 smoke test와 post-MVP backlog |
| `agents/domain.md` | Codex가 이 repo의 domain/ADR 문서를 읽는 규칙 |
| `agents/issue-tracker.md` | issue tracker 조작 규칙 |
| `agents/triage-labels.md` | triage label/status 매핑 |
| `operations/` | 릴리스, 배포, smoke test 후 운영 진입 handoff |

## 설계 산출물

| 경로 | 기준 |
| --- | --- |
| `superpowers/specs/` | 구현 전 확정한 feature/design spec |
| `superpowers/plans/` | spec, grill-me, design/eng review 결과를 반영한 실행 계획 |
| `operations/YYYY-MM-DD-*-handoff.md` | release 이후 실제 배포 commit, 검증 명령, 남은 운영 리스크 |

## 갱신 규칙

- 상태 모델, provider metadata, notification policy를 바꾸면 `STATUS.md`와 `ADR.md`를 함께 갱신한다.
- status update를 외부 bridge/trace/notification ingress로 전달하는 정책을 바꾸면 `STATUS.md`, `ARCHITECTURE-LOGIC.md`, `ADR.md`, `TESTING.md`를 함께 갱신한다.
- tmux, process 감지, terminal protocol, `Ctrl+D` 입력 정책을 바꾸면 `TMUX.md`를 갱신한다.
- 서버 startup, WebSocket routing, shared singleton, sync 흐름을 바꾸면 `ARCHITECTURE-LOGIC.md`를 갱신한다.
- 성능 계측, polling, timeline render/cache, WebSocket batching을 바꾸면 `PERFORMANCE.md`를 갱신한다.
- 테스트 도구, smoke command, platform 검증 순서, Playwright/Chromium 기준을 바꾸면 `TESTING.md`를 갱신한다.
- PWA manifest, icon, startup image, service worker public asset 기준을 바꾸면 `TESTING.md`, `ARCHITECTURE-LOGIC.md`, `ADR.md`, `STYLE.md`, `README.md`, `landing-src/docs/pwa-setup.md` locale copy를 함께 갱신한다.
- 성능 변경이 사용자 동작이나 운영 점검에 영향을 주면 `README.md`와 `landing-src/docs/`의 architecture/live-session/git/stats/troubleshooting 문서도 함께 갱신한다.
- 저장 파일 구조나 삭제 기준을 바꾸면 `DATA-DIR.md`를 갱신한다.
- Windows-only 제품 타깃, terminal runtime, process inspection, host operation
  전환을 바꾸면 `WINDOWS-ONLY-GAP-AUDIT.md`, `ADR.md`, 관련
  `superpowers/specs/`와 `superpowers/plans/`를 함께 갱신한다.
- Windows Electron client, engine lifecycle, updater, installer 기준을 바꾸면
  `ELECTRON.md`, `TESTING.md`, `WINDOWS-ONLY-GAP-AUDIT.md`, 관련
  `operations/` handoff를 함께 갱신한다.
- Core/Backend 논리 분리, Core protocol, `--codexwinmux-core` host, split service
  계획을 바꾸면 `ADR.md`, `RUNTIME-V2-CUTOVER.md`, `ELECTRON.md`,
  `WINDOWS-ONLY-GAP-AUDIT.md`, 관련 `operations/` handoff와
  `superpowers/plans/`를 함께 갱신한다.
- legacy Android client, 모바일 reconnect, 앱 정보/재시작 bridge, native build
  기준을 바꾸면 `ANDROID.md`를 갱신하되 현재 Windows 제품 기준과 혼동되지 않게
  legacy/deferred 상태를 명시한다.
- release, deploy, smoke 결과가 운영 판단에 영향을 주면 `operations/` handoff를 추가하고 `FOLLOW-UP.md`의 확인 상태를 갱신한다.
- 구현 전 설계 결정을 바꾸면 관련 `superpowers/specs/`와
  `superpowers/plans/` 산출물을 함께 갱신한다.
