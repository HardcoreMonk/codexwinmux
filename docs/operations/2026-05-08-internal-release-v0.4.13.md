# 2026-05-08 내부 릴리스 v0.4.13

## 상태

- 대상: 내부 사용자 전용.
- 버전: `0.4.13`.
- 커밋: `a95e9ab7`.
- 설치 파일: `release/codexmux-Setup-0.4.13.exe`.
- 업데이트 메타데이터: `release/latest.yml`, `release/codexmux-Setup-0.4.13.exe.blockmap`.
- 제품 표시명: `windows native codexmux`.
- app id, 실행 파일명, data dir: `codexmux`, `com.hardcoremonk.codexmux`, `%USERPROFILE%\.codexmux\` 유지.
- 외부 공개 배포: code signing certificate trust와 SmartScreen reputation evidence 전까지 차단.

## 내부 릴리스 노트

`codexwinmux` Windows 내부 릴리스 `0.4.13`은 내부 파일럿 후보입니다.

이번 릴리스에서 확인된 항목:

- Windows NSIS installer, ZIP, `latest.yml`, installer `.blockmap` 생성.
- updater metadata에 GitHub provider, `HardcoreMonk/codexwinmux`, `codexmux-updater` cache dir 포함.
- local feed updater가 synthetic `0.4.14` feed를 통해 download, `quitAndInstall`, post-update launch, uninstall을 완료.
- packaged app launch, engine lifecycle, packaged Runtime v2 terminal, installer Runtime v2 terminal smoke 통과.
- 창 종료 후 engine health 유지 확인.
- 기본 포트는 `127.0.0.1:8121`.

알려진 제한:

- `codexmux-Setup-0.4.13.exe`와 `release/win-unpacked/codexmux.exe`는 `Get-AuthenticodeSignature` 기준 `NotSigned`입니다.
- 서명되지 않은 installer는 SmartScreen reputation을 통과 처리할 수 없습니다.
- 내부 파일럿은 신뢰된 내부 경로에서 받은 파일로만 진행합니다.

## 설치 안내

내부 배포 담당자는 다음 산출물을 함께 제공합니다.

| 파일 | 용도 |
| --- | --- |
| `codexmux-Setup-0.4.13.exe` | Windows 설치 파일 |
| `codexmux-Setup-0.4.13.exe.blockmap` | updater differential metadata |
| `latest.yml` | electron-updater feed metadata |

사용자 설치 순서:

1. 내부 배포 채널에서 `codexmux-Setup-0.4.13.exe`를 내려받습니다.
2. Windows가 unknown publisher 또는 SmartScreen 경고를 표시하면, 내부 배포 경로와 파일명을 확인한 뒤 파일럿 참여자만 계속합니다.
3. 설치 프로그램을 실행합니다.
4. 설치 과정 로그 pane에서 파일 복사나 권한 오류가 없는지 확인합니다.
5. 시작 메뉴 또는 설치된 `codexmux` 실행 파일로 앱을 엽니다.
6. 앱이 열리면 `http://127.0.0.1:8121/api/health`가 `version=0.4.13`을 반환하는지 확인합니다.
7. 실제 workspace를 열고 새 terminal tab을 생성합니다.

PowerShell quick check:

```powershell
Invoke-RestMethod http://127.0.0.1:8121/api/health
```

예상:

- `app`: `codexmux`
- `version`: `0.4.13`
- `commit`: `a95e9ab7`

## 업데이트 안내

GitHub Release에 `v0.4.13` assets를 발행한 뒤 업데이트 테스트를 진행합니다.

필수 assets:

- `latest.yml`
- `codexmux-Setup-0.4.13.exe`
- `codexmux-Setup-0.4.13.exe.blockmap`

업데이트 사용자 흐름:

1. 기존 설치 앱을 실행합니다.
2. updater가 published channel을 확인할 때까지 기다립니다.
3. update downloaded 상태가 되면 앱 재시작/설치를 허용합니다.
4. 재실행 후 `/api/health`에서 `version=0.4.13`을 확인합니다.
5. 기존 workspace가 유지되는지 확인합니다.
6. Runtime v2 terminal tab을 새로 만들어 입력과 출력이 되는지 확인합니다.

## 3~5명 장시간 파일럿 체크리스트

파일럿 규모:

- 최소 3명.
- 권장 5명.
- 최소 4시간 실제 workspace 사용.
- 가능하면 1영업일 동안 사용.

각 사용자 확인 항목:

| 항목 | 기록 |
| --- | --- |
| 설치 방식 | fresh install / update |
| Windows 버전 | 예: Windows 11 24H2 |
| SmartScreen 또는 unknown publisher 경고 | 표시됨 / 표시 안 됨 / 문구 기록 |
| 설치 로그 pane 오류 | 없음 / 있음 |
| 앱 launch | 성공 / 실패 |
| `/api/health` | `0.4.13` 확인 / 실패 |
| workspace 열기 | 성공 / 실패 |
| workspace 생성 | 성공 / 실패 |
| terminal 생성 | 성공 / 실패 |
| terminal 입력/출력 | 성공 / 실패 |
| Codex CLI 실제 사용 | 성공 / 실패 |
| app close 후 engine 유지 | 성공 / 실패 |
| 재실행 후 workspace 유지 | 성공 / 실패 |
| 30분 이상 열린 session 유지 | 성공 / 실패 |
| crash/update/attach/reconnect 이슈 | 상세 기록 |

## 내부 전체 배포 gate

전체 내부 배포는 다음 조건이 모두 맞을 때만 진행합니다.

- 3~5명 파일럿 완료.
- launch blocker 없음.
- workspace 생성/열기 blocker 없음.
- terminal attach/input/reconnect blocker 없음.
- update 후 app health/version 불일치 없음.
- data loss 또는 workspace state loss 없음.
- unsigned build caveat가 공지되어 있음.
- rollback 안내가 배포 안내에 포함되어 있음.
- signed build가 없으면 외부 공개 배포가 아님을 명확히 표시.

## Code signing과 SmartScreen

현재 결과:

| 파일 | 상태 |
| --- | --- |
| `release/codexmux-Setup-0.4.13.exe` | `NotSigned` |
| `release/win-unpacked/codexmux.exe` | `NotSigned` |

명령:

```powershell
Get-AuthenticodeSignature .\release\codexmux-Setup-0.4.13.exe
Get-AuthenticodeSignature .\release\win-unpacked\codexmux.exe
```

판정:

- Code signing certificate trust: 미완료.
- Timestamped signature evidence: 미완료.
- SmartScreen reputation evidence: 미완료.

SmartScreen은 unsigned artifact로는 통과 처리하지 않습니다. 다음 단계는 trusted code signing certificate로 installer/exe를 서명하고, timestamp를 포함한 뒤, clean Windows 환경에서 다운로드/실행 warning 상태를 기록하는 것입니다.

## 제품 정체성 결정

`0.4.13`에서는 다음을 유지합니다.

- `productName`: `codexmux`
- `appId`: `com.hardcoremonk.codexmux`
- 실행 파일: `codexmux.exe`
- installer artifact: `codexmux-Setup-<version>.exe`
- data dir: `%USERPROFILE%\.codexmux\`
- updater cache: `codexmux-updater`

`codexwinmux`로 app id, data dir, artifact, executable name까지 변경하는 것은 아직 결정하지 않습니다. 이 변경은 installer identity, updater continuity, 기존 `%USERPROFILE%\.codexmux\` migration, rollback behavior에 영향을 주므로 별도 ADR/spec으로 처리합니다.

## Rollback drill

현재 실행한 rollback evidence:

```bash
corepack pnpm lifecycle:rollback-dry-run
```

결과:

- `mutates=false`.
- `dropInExists=false`.
- rollback command 후보:
  - `systemctl --user daemon-reload`
  - `systemctl --user restart codexmux.service`
- warning: runtime drop-in이 없으므로 rollback이 이미 적용된 상태일 수 있음.

판정:

- Read-only rollback dry-run: 통과.
- 실제 운영 환경 mutation rollback drill: 미완료.

Windows 설치형 앱 기준 rollback은 이전 installer 보관, 새 버전 uninstall, 이전 버전 reinstall, `%USERPROFILE%\.codexmux\` 보존 확인으로 별도 실행해야 합니다.

## Smoke 증거

2026-05-08 `0.4.13` 기준:

| 항목 | 결과 |
| --- | --- |
| `corepack pnpm pack:electron` | 통과 |
| `release/win-unpacked/resources/app-update.yml` | 생성됨 |
| `corepack pnpm smoke:windows:package-gate` | 통과 |
| ZIP artifact | 통과, `codexmux-0.4.13-win.zip`, 12,484 entries |
| update metadata | 통과, blockers `[]` |
| updater local feed | 통과, synthetic `0.4.14`, `quitAndInstall` |
| packaged launch | 통과 |
| engine lifecycle | 통과, UI quit 뒤 health 유지 |
| packaged Runtime v2 terminal | 통과 |
| installer Runtime v2 terminal | 통과 |

참고:

- `pack:electron:dev`는 `win-unpacked`를 개발 산출물로 덮어쓸 수 있으며, 이 상태에서는 `app-update.yml`이 없어 package gate가 실패할 수 있습니다.
- release gate 전에는 항상 `corepack pnpm pack:electron`으로 산출물을 다시 만든 뒤 `corepack pnpm smoke:windows:package-gate`를 실행합니다.
