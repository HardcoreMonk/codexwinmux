# codexwinmux public SmartScreen, warning, legacy sunset 운영 기록

작성일: 2026-05-12
대상 버전: `0.4.14`
기준 커밋: 이 문서가 포함된 커밋

## 범위

이 문서는 직전 후속 목록에서 선택한 `1-2-3` 항목을 기록한다.

- 외부 공개 배포용 public SmartScreen evidence gate.
- `DEP0176`, `DEP0190` dependency warning 정리.
- legacy `codexmux`/`cmux` CLI alias sunset.

## Public SmartScreen gate

내부 전용 배포에서는 `internal-not-required` 또는 `internal-trusted-root`를 사용할 수
있다. 그러나 외부 공개 배포 strict mode에서는 이 상태를 허용하지 않는다.

검증 명령:

```powershell
Get-ChildItem Env:CODEXMUX*, Env:CODEXWINMUX* -ErrorAction SilentlyContinue | Remove-Item -ErrorAction SilentlyContinue
$env:CODEXWINMUX_SMOKE_ARTIFACT_DIR='artifacts/smoke/2026-05-12-codexwinmux-follow-up-public-warning-sunset'
$env:CODEXWINMUX_SMARTSCREEN_STATUS='internal-not-required'
$env:CODEXWINMUX_SMARTSCREEN_ENVIRONMENT='internal-trusted-root-distribution'
$env:CODEXWINMUX_SMARTSCREEN_PUBLIC_RELEASE='1'
corepack pnpm smoke:windows:signing-evidence
```

결과:

- exit code: `1`.
- code signing과 timestamp: 통과.
- public SmartScreen: 차단.
- blocker: `windows-smartscreen-public-evidence-required`.

이는 의도한 결과다. 실제 외부 공개 배포를 시작하려면 clean Windows 환경에서
SmartScreen 통과를 확인한 뒤 `CODEXWINMUX_SMARTSCREEN_STATUS=passed` 또는 evidence
JSON을 제공해야 한다. 내부 전용 배포 상태를 public evidence로 승격하지 않는다.

## Dependency warning 정리

확인한 최신 버전:

- `electron-builder`: `26.8.1`.
- `electron-updater`: `6.8.3`.

현재 최신 버전에서도 Node `DEP0176`, `DEP0190` warning이 dependency 경로에서 나올 수
있다. 제품 runtime warning으로 섞이지 않도록 Windows packaging, package gate, updater
smoke child process에 다음 `NODE_OPTIONS`를 중복 없이 병합한다.

```text
--disable-warning=DEP0176 --disable-warning=DEP0190
```

검증:

- `buildElectronBuilderEnv()`가 기존 `NODE_OPTIONS`를 보존하면서 두 warning suppression을
  병합한다.
- native prebuild install 단계도 같은 warning suppression env를 받는다.
- package gate child process env도 같은 정책을 사용한다.
- updater local/GitHub feed smoke에서 실행되는 packaged Electron app은 `NODE_OPTIONS`를
  넘기지 않고 smoke 전용 `NODE_NO_WARNINGS=1`을 사용한다. Electron의
  `Most NODE_OPTIONs are not supported in packaged apps` 오류와 `DEP0190` 출력이 섞이지
  않게 하기 위함이다.
- `pack-electron-output-clean.txt`와 `updater-local-feed-output-clean.txt`에서
  `DEP0176`, `DEP0190`, `Most NODE_OPTIONs` 문자열이 검출되지 않았다.

## Legacy CLI alias sunset

`package.json`의 `bin`에서 legacy alias를 제거했다.

유지:

- `codexwinmux`
- `cwmux`

제거:

- `codexmux`
- `cmux`

내부 runtime env인 `CODEXMUX_RUNTIME_*`는 아직 내부 구현 계약으로 남긴다. 외부 smoke와
운영 입력 env는 `CODEXWINMUX_*`를 우선하며, `CODEXWINMUX_LEGACY_SUNSET=1` strict identity
smoke가 legacy CLI alias가 남아 있으면 실패한다.

검증 명령:

```powershell
Get-ChildItem Env:CODEXMUX*, Env:CODEXWINMUX* -ErrorAction SilentlyContinue | Remove-Item -ErrorAction SilentlyContinue
$env:CODEXWINMUX_SMOKE_ARTIFACT_DIR='artifacts/smoke/2026-05-12-codexwinmux-follow-up-public-warning-sunset'
$env:CODEXWINMUX_STRICT_IDENTITY='1'
$env:CODEXWINMUX_LEGACY_SUNSET='1'
corepack pnpm smoke:windows:strict-identity
```

결과:

- exit code: `0`.
- checks: `strict-identity-legacy-cli-aliases-removed`,
  `strict-identity-no-legacy-external-env`.
- blockers: `[]`.

## 후속 작업

- public release를 실제로 시작할 때만 clean Windows SmartScreen `passed` evidence를
  별도로 수집한다.
- 내부 runtime env `CODEXMUX_RUNTIME_*` 명칭까지 바꾸는 작업은 runtime contract 변경이므로
  별도 ADR/spec으로 다룬다.
