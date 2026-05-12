# codexwinmux 후속 작업 2, 3, 4 운영 기록

작성일: 2026-05-12
대상 버전: `0.4.14`
기준 커밋: `0dc0426e`

## 범위

이 문서는 `codexwinmux` 독립 제품 전환 이후 남은 후속 작업 중 다음 세 항목을
정리한다.

- 기존 `codexmux`/`cmux`/`CODEXMUX_*` 호환 레이어 제거 계획 수립.
- 실제 Windows PC에서 장기 실행 canary 증거 수집.
- Windows tray icon 로딩 경고 제거와 재검증.

## 호환 레이어 제거 계획

현재 `codexwinmux`는 제품 identity를 `codexwinmux`로 분리했지만, 내부 스크립트와
기존 운영 습관을 깨지 않기 위해 아래 호환 표면을 유지한다.

- `CODEXMUX_*` 환경 변수.
- `CMUX_PORT`, `CMUX_TOKEN`.
- `x-cmux-token` CLI/API header.
- `codexmux`, `cmux` CLI alias.
- 기존 `~/.codexmux`와 과거 설치본은 자동 삭제하거나 자동 병합하지 않는 정책.

제거는 즉시 수행하지 않는다. 내부 전용 애플리케이션이라 public 인증 표면은 작지만,
운영 스크립트와 smoke가 아직 같은 이름을 많이 사용한다. 강제 제거보다 계측 가능한
sunset이 안전하다.

단계별 계획:

1. `0.4.x` 재고 단계
   - `rg "CODEXMUX|CMUX|x-cmux-token|codexmux|cmux"` 결과를 기능 계약, 테스트 fixture,
     역사 문서로 분류한다.
   - 런타임에 필요한 호환 env와 단순 문서 잔재를 분리한다.
   - 신규 문서와 UI 표기는 `codexwinmux`/`cwmux`를 우선한다.

2. `0.5.x` 병행 이름 단계
   - 새 preferred env alias를 추가한다. 예: `CODEXWINMUX_*`, 필요한 경우 `CWMUX_*`.
   - 기존 `CODEXMUX_*`는 계속 읽되, 동일 값이 새 이름과 충돌하면 새 이름을 우선한다.
   - CLI/API 문서는 `x-cmux-token`을 호환 header로 명시하고, 새 header 도입 여부는
     별도 ADR로 결정한다.

3. strict canary 단계
   - `CODEXWINMUX_STRICT_IDENTITY=1` 같은 opt-in 모드에서 legacy alias 없이 smoke를
     실행한다.
   - 최소 gate는 `pnpm test`, Windows package gate, published updater channel,
     5분 이상 packaged launch canary다.
   - 이 단계에서도 기존 사용자 데이터는 삭제하지 않는다.

4. 제거 단계
   - 두 번 이상의 내부 릴리스에서 strict canary가 통과하고 운영 스크립트 의존성이
     없다는 증거가 있을 때만 legacy alias 제거를 진행한다.
   - 제거 전 마지막 릴리스에는 deprecation warning과 rollback 방법을 문서화한다.
   - 데이터 경로는 자동 삭제하지 않고, 별도 수동 cleanup 명령으로만 제공한다.

## 장기 실행 canary 증거

실제 Windows packaged exe를 대상으로 5분 hold canary를 실행했다.

명령:

```powershell
$env:CODEXMUX_WINDOWS_PACKAGED_LAUNCH_HOLD_MS='300000'
$env:CODEXMUX_SMOKE_ARTIFACT_DIR='artifacts/smoke/2026-05-12-codexwinmux-canary'
corepack pnpm smoke:windows:packaged-launch
```

결과:

- 상태: 통과.
- 실행 시간: 2026-05-12T07:30:35.855Z ~ 2026-05-12T07:35:44.485Z.
- duration: `308630ms`.
- health: `app=codexwinmux`, `version=0.4.14`, `commit=0dc0426e`.
- long-run health: 최초 health와 같은 `commit=0dc0426e` 유지.
- title: `로그인 - codexwinmux`.
- userAgent: `codexwinmux/0.4.14`.
- `consoleEventCount=0`.
- `blockingConsoleCount=0`.
- checks: `packaged-exe-present`, `isolated-user-dirs`, `packaged-launch-windows-exe`,
  `local-page-target`, `cdp-connected`, `page-ready`, `preload-bridge`,
  `local-server-health`, `runtime-output-clean`, `console-clean`, `long-run-hold`,
  `long-run-health`.
- artifact: `artifacts/smoke/2026-05-12-codexwinmux-canary/windows-packaged-launch-20260512T073544485Z-passed.json`.

## Tray Icon 경고 처리

원인:

- Windows packaged app에서 tray 생성 시 `new Tray(process.execPath)`를 사용했다.
- Electron은 이 값을 이미지 경로로 해석하므로 설치본의 `codexwinmux.exe`를 이미지처럼
  읽으려 했고, updater local feed smoke stderr에 `Failed to load image from path ...codexwinmux.exe`
  경고가 남았다.

변경:

- `electron/tray-icon.ts`에 Windows tray icon 경로 resolver를 추가했다.
- packaged Windows 앱은 `process.resourcesPath/icon.ico`를 사용한다.
- dev Windows 앱은 `build-resources/icon.ico`를 사용한다.
- non-Windows는 기존처럼 empty native image 경로를 유지한다.
- `electron-builder.yml`의 `extraResources`에 `build-resources/icon.ico -> icon.ico`를
  추가했다.
- Windows packaging smoke가 `windows-tray-icon-resource-present` 계약을 검증한다.

검증:

- `corepack pnpm exec vitest run tests/unit/electron/tray-icon.test.ts tests/unit/scripts/windows-electron-packaging-smoke-lib.test.ts`: 통과.
- `corepack pnpm smoke:windows:electron-packaging`: 통과, `windows-tray-icon-resource-present`.
- `corepack pnpm test`: `150 passed | 1 skipped`.
- `corepack pnpm exec tsc --noEmit --pretty false`: 통과.
- `corepack pnpm lint --quiet`: 통과.
- `corepack pnpm pack:electron`: 통과, `release/win-unpacked/resources/icon.ico` 포함.
- `corepack pnpm smoke:windows:package-gate`: 통과.

package gate의 updater local feed stderr에는 Electron builder의 `disableWebInstaller`
deprecation warning만 남았고, tray image load 실패 경고는 재발하지 않았다.

## 남은 제약

- Windows code signing과 timestamp evidence는 아직 없다.
- SmartScreen evidence도 아직 없다.
- 따라서 public/외부 배포 신뢰도까지 완료된 상태는 아니며, 현재 릴리스는 내부 배포용이다.
