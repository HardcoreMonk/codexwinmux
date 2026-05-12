# codexwinmux public SmartScreen, runtime env, release immutability 후속 기록

작성일: 2026-05-12
대상 버전: `0.4.14`

## 처리 범위

- Public SmartScreen `passed`는 단순 env shorthand가 아니라 public launch smoke 증거가
  있을 때만 인정하도록 강화했다.
- Runtime env는 `CODEXWINMUX_RUNTIME_*` preferred alias를 mode resolver와 terminal
  adapter resolver에 도입했다.
- 이미 존재하는 version tag/release를 다시 발행하지 않도록 release immutability smoke를
  추가했다.

## Public SmartScreen

새 명령:

```powershell
corepack pnpm smoke:windows:smartscreen-public-evidence
```

필수 입력:

- `CODEXWINMUX_SMARTSCREEN_DOWNLOAD_URL`
- 선택: `CODEXWINMUX_SMARTSCREEN_EXPECTED_SHA256`
- 선택: `CODEXWINMUX_SMARTSCREEN_PUBLIC_EVIDENCE_OUTPUT`

이 smoke는 Chromium HTTPS download, Internet ZoneId=3, `Start-Process` launch exit
code 0을 확인한 뒤 evidence JSON을 만든다. Playwright Chromium binary가 없는 새
runner에서는 먼저 `corepack pnpm exec playwright install chromium`을 실행한다. 이후
public release signing gate는 다음처럼 실행한다.

```powershell
$env:CODEXWINMUX_SMARTSCREEN_PUBLIC_RELEASE='1'
$env:CODEXWINMUX_SMARTSCREEN_EVIDENCE_PATH='artifacts/smartscreen-v0.4.14-public.json'
corepack pnpm smoke:windows:signing-evidence
```

`CODEXWINMUX_SMARTSCREEN_PUBLIC_RELEASE=1`에서 단순
`CODEXWINMUX_SMARTSCREEN_STATUS=passed`만 주면
`windows-smartscreen-public-launch-evidence-required`로 실패한다.

2026-05-12 실행 결과:

- GitHub Release installer HTTPS download: 통과.
- SHA-256: `D9C41DEAF282B7EF6C681392D6B30E43602F5E3C18F389F84BFF383AA7F4F995` 일치.
- Internet ZoneId=3: 통과.
- `Start-Process` public launch: 실패, exit code `1`.
- 결과: public SmartScreen `passed` evidence는 아직 없음. 현재 `v0.4.14` public launch는
  자동 무개입 smoke에서 차단되므로 외부 공개 배포 기준으로는 blocker다.

## Runtime env alias

새 preferred alias:

- `CODEXWINMUX_RUNTIME_V2`
- `CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE`
- `CODEXWINMUX_RUNTIME_STORAGE_V2_MODE`
- `CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE`
- `CODEXWINMUX_RUNTIME_STATUS_V2_MODE`
- `CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER`

기존 `CODEXMUX_RUNTIME_*`는 아직 fallback이다. 전체 내부 문자열 제거는 ADR-022의 staged
migration으로 분리한다.

## Release immutability

새 명령:

```powershell
corepack pnpm smoke:release-immutability
```

현재 `package.json` version의 local tag, remote tag, GitHub Release 중 하나라도 있으면
실패한다. 이는 같은 version asset을 덮어쓰지 말고 다음 version을 발행하라는 release
blocker다.
