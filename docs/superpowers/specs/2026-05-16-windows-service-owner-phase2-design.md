# Windows Service Owner Phase 2 설계

Date: 2026-05-16
Status: 자동 승인 기준으로 구현 진행

## 목표

Phase 1 tray-first Engine Host에서 한 단계 더 나아가, Windows Service owner가
Backend/Core Engine process를 소유할 수 있는 실행 계약을 만든다.

이번 slice의 1차 목표는 실제 SCM 등록을 실행하는 것이 아니라, 패키지된
`codexwinmux.exe`를 service owner가 `--codexwinmux-engine`으로 실행할 수 있게 하고,
그 등록/해제/시작/중지 명령을 non-mutating plan과 smoke로 검증하는 것이었다.
이후 운영자 요청으로 같은 host에서 WinSW wrapper 기반 실제 service 등록/시작까지 수행했다.

## 범위

- Electron engine-only bootstrap은 canonical `--codexwinmux-engine` 인자를 지원한다.
- 기존 `CODEXMUX_ELECTRON_ENGINE_PROCESS=1`은 호환 입력으로 유지하되, 새 실행 계약은
  `CODEXWINMUX_ELECTRON_ENGINE_PROCESS=1`과 CLI flag를 기준으로 한다.
- `src/lib/windows-service-host.ts`는 tray owner와 service owner를 구분하고, service owner일
  때 WinSW wrapper 명령 계획을 반환한다.
- smoke는 Windows host에 service를 등록하거나 삭제하지 않는다.
- 실제 운영 등록은 WinSW wrapper config를 생성한 뒤 wrapper의 `install`/`start` 명령으로 수행한다.
- Backend/Core는 이번 slice에서 같은 engine process 안에 남는다. Core runtime workers는
  기존 worker process boundary를 계속 사용한다.

## 비범위

- 관리자 권한 상승 UI 구현.
- Windows installer에서 service를 자동 등록하는 동작.
- Backend process와 Core process를 서로 다른 Windows Service로 나누는 작업.

## 실행 모델

```text
Windows SCM
  -> codexwinmux service
       -> codexwinmux-service.exe (WinSW wrapper)
            -> codexwinmux.exe --codexwinmux-engine
                 -> Backend Engine: 127.0.0.1:8121 HTTP/API/WebSocket
                 -> Core Engine: runtime v2 workers, terminal/storage/timeline/status

Electron Shell Host
  -> 기존 engine discovery
  -> service-owned engine이 이미 건강하면 attach
  -> 직접 시작한 tray-owned engine만 stop/restart
```

## 성공 기준

- service owner plan이 packaged executable과 `--codexwinmux-engine` args를 포함한다.
- service owner plan이 WinSW wrapper의 install/uninstall/start/stop command를 구조화해 반환한다.
- smoke가 tray plan과 service plan을 모두 검증하되 `mutatesSystem=false`를 유지한다.
- Electron main이 CLI flag 또는 canonical env로 engine-only mode를 인식한다.
- 기존 tray-first packaged lifecycle smoke와 unit test가 깨지지 않는다.
