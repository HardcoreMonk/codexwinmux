# codexwinmux 후속 작업 1, 2, 3 운영 기록

작성일: 2026-05-12
대상 버전: `0.4.14`
기준 코드 커밋: `55f8667c`
GitHub Release: `v0.4.14`

## 범위

이 문서는 `codexwinmux` 재설계 이후 후속 작업 중 다음 세 항목의 완료 증거를
기록한다.

- Windows code signing, timestamp, SmartScreen 범위 증거 확보.
- `CODEXWINMUX_*` preferred alias와 strict identity canary 도입.
- electron-builder/electron-updater `disableWebInstaller` 경고 제거.

앱은 내부 전용 배포 대상이다. 따라서 public SmartScreen reputation 확보는 이번
릴리스의 필수 gate가 아니며, signed/timestamped artifact와 내부 신뢰 루트 배포
범위를 기준으로 판정했다.

## 구현 요약

Windows signing:

- `electron-builder.yml`에 `win.signtoolOptions.signingHashAlgorithms: [sha256]`을
  고정했다.
- `scripts/pack-electron-windows-lib.mjs`가 preferred env alias를 읽어
  `certificateSha1`, `publisherName`, `rfc3161TimeStampServer`를 electron-builder
  설정으로 전달한다.
- `scripts/windows-electron-packaging-smoke-lib.mjs`가 SHA-256 signing hash와
  `nsis-web` target 금지를 검증한다.

Identity alias:

- `scripts/env-alias-lib.mjs`를 추가해 `CODEXWINMUX_*`를 preferred alias로 읽고,
  기존 `CODEXMUX_*`는 호환 fallback으로만 둔다.
- `electron/runtime-env.ts`, `electron/updater-smoke.ts`, smoke artifact 경로,
  signing evidence smoke가 preferred alias를 우선한다.
- `CODEXWINMUX_STRICT_IDENTITY=1` canary를 추가해 외부 입력 표면에서 legacy
  env 의존이 남아 있지 않은지 검증한다.

Updater warning:

- `electron/updater-config.ts`를 추가해 auto updater runtime 기본값을 한 곳에서
  적용한다.
- `disableWebInstaller=true`, `autoDownload=false`, `autoInstallOnAppQuit=true`를
  실행 시점에 강제해 updater local feed smoke의 `disableWebInstaller is set to false`
  경고를 제거했다.

## 서명과 timestamp 증거

빌드 명령:

```powershell
Get-ChildItem Env:CODEXMUX*, Env:CODEXWINMUX* -ErrorAction SilentlyContinue | Remove-Item -ErrorAction SilentlyContinue
$env:CODEXWINMUX_WINDOWS_CERTIFICATE_SHA1='8C5F3B5030D3A54B1150C2C30CFD9868800DF0C6'
$env:CODEXWINMUX_WINDOWS_PUBLISHER_NAME='CN=PureCVisor Desktop Node Internal Code Signing'
$env:CODEXWINMUX_WINDOWS_TIMESTAMP_SERVER='http://timestamp.digicert.com'
$env:SIGNTOOL_PATH='C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe'
corepack pnpm pack:electron
```

결과:

| 항목 | 값 |
| --- | --- |
| `release/codexwinmux-Setup-0.4.14.exe` SHA-256 | `4D75B0378924021C4FECB18FAC1793DB1DD8CE7DEFBDFABFC78685D2C97D5875` |
| `release/win-unpacked/codexwinmux.exe` SHA-256 | `811587DB89732F6AA9382C900CC9878551D3E27D4E811108F4D908C6026ED271` |
| signer | `CN=PureCVisor Desktop Node Internal Code Signing` |
| signer thumbprint | `8C5F3B5030D3A54B1150C2C30CFD9868800DF0C6` |
| timestamp responder | `CN=DigiCert SHA256 RSA4096 Timestamp Responder 2025 1, O="DigiCert, Inc.", C=US` |

서명 smoke:

```powershell
Get-ChildItem Env:CODEXMUX*, Env:CODEXWINMUX* -ErrorAction SilentlyContinue | Remove-Item -ErrorAction SilentlyContinue
$env:CODEXWINMUX_SMOKE_ARTIFACT_DIR='artifacts/smoke/2026-05-12-codexwinmux-follow-up-1-2-3'
$env:CODEXWINMUX_SMARTSCREEN_STATUS='internal-not-required'
$env:CODEXWINMUX_SMARTSCREEN_CHECKED_AT=(Get-Date).ToUniversalTime().ToString('o')
$env:CODEXWINMUX_SMARTSCREEN_ENVIRONMENT='internal-trusted-root-distribution'
corepack pnpm smoke:windows:signing-evidence
```

판정:

- 상태: 통과.
- checks: `windows-code-signing-all-valid`,
  `windows-smartscreen-internal-scope-accepted`.
- SmartScreen: 내부 전용 앱이므로 public reputation을 release blocker로 두지 않는다.
  내부 trusted root 배포 범위에서 signed/timestamped artifact를 배포한다.

## Strict identity canary

명령:

```powershell
Get-ChildItem Env:CODEXMUX*, Env:CODEXWINMUX* -ErrorAction SilentlyContinue | Remove-Item -ErrorAction SilentlyContinue
$env:CODEXWINMUX_SMOKE_ARTIFACT_DIR='artifacts/smoke/2026-05-12-codexwinmux-follow-up-1-2-3'
$env:CODEXWINMUX_STRICT_IDENTITY='1'
corepack pnpm smoke:windows:strict-identity
```

결과:

- 상태: 통과.
- checks: `strict-identity-no-legacy-external-env`, preferred CLI aliases,
  product/repo identity, preferred env aliases.
- legacy `CODEXMUX_*`는 외부 smoke 입력 표면에서 필요하지 않다.
- 내부 호환 레이어는 아직 유지한다. 제거는 별도 sunset gate에서 진행한다.

## Package gate와 updater 경고

명령:

```powershell
Get-ChildItem Env:CODEXMUX*, Env:CODEXWINMUX* -ErrorAction SilentlyContinue | Remove-Item -ErrorAction SilentlyContinue
$env:CODEXWINMUX_SMOKE_ARTIFACT_DIR='artifacts/smoke/2026-05-12-codexwinmux-follow-up-1-2-3'
corepack pnpm smoke:windows:package-gate
```

결과:

- 상태: 통과.
- duration: `558127ms`.
- 단계: `windows-zip-artifact`, `windows-update-metadata`,
  `windows-updater-local-feed`, `windows-packaged-launch`,
  `windows-engine-lifecycle`, `windows-packaged-runtime-v2`,
  `windows-installer-runtime-v2`.
- update 후 health: `version=0.4.14`, `commit=55f8667c`.
- `disableWebInstaller is set to false` 경고는 재발하지 않았다.
- `publisherName` full DN 누락 경고도 재발하지 않았다.

잔여 비차단 경고:

- `DEP0176 fs.R_OK`는 electron-builder 계열 dependency 경고다.
- `DEP0190 shell option true`는 updater/package smoke 실행 중 dependency 경로에서
  출력되는 Node 경고다.

## Release 자산

`v0.4.14` release assets를 새 signed build 산출물로 교체했다.

| 파일 | 크기 | SHA-256 |
| --- | ---: | --- |
| `codexwinmux-0.4.14-win.zip` | `199429243` | `CEFB4D92326C1C8D4231EE2B37AC52C55BC1A158696C13EEDEFC91325EA43563` |
| `codexwinmux-Setup-0.4.14.exe` | `152364704` | `4D75B0378924021C4FECB18FAC1793DB1DD8CE7DEFBDFABFC78685D2C97D5875` |
| `codexwinmux-Setup-0.4.14.exe.blockmap` | `159505` | `77FE07B8C5E7F4921C78E0A0C20DEE4E0FB0B545279D65D534FABD7FCF8D0A38` |
| `latest.yml` | `354` | `B79621A8816B70C730B8F6E3CBB6C5D74757DC3B2529074EB2A7D91517AB0422` |

GitHub release 상태:

- URL: `https://github.com/HardcoreMonk/codexwinmux/releases/tag/v0.4.14`
- release `targetCommitish`: `main`
- 원격 `refs/tags/v0.4.14`: `55f8667ce36aecaed493330e979a890f29283253`
- release asset digest는 로컬 파일 SHA-256과 일치한다.

## 완료 판정

선택된 후속 작업 `1-2-3`은 내부 배포 기준으로 완료했다.

- signed/timestamped Windows artifact 증거가 있다.
- 내부 전용 SmartScreen scope 판정이 smoke gate에 기록되어 있다.
- preferred `CODEXWINMUX_*` alias와 strict identity canary가 동작한다.
- updater `disableWebInstaller` 경고가 제거되었다.
- package gate와 실제 GitHub release 자산 교체가 완료되었다.

## 남은 후속 작업 후보

- dependency 경고 `DEP0176`, `DEP0190`를 upstream package 버전 또는 smoke 실행 방식
  변경으로 줄일 수 있는지 검토한다.
- legacy `CODEXMUX_*`/`CMUX_*` 호환 레이어 제거는 두 번 이상의 strict canary 통과 후
  별도 sunset 작업으로 진행한다.
- 내부 신뢰 루트 배포 현황은 조직 단말 정책 변경 시 재확인한다.
