# Windows Evidence Pack Generator Design

## 목표

Windows 패키징/업데이트 smoke 이후 사람이 stdout과 handoff 문서를 다시 읽고 정리하는 시간을 줄인다.
각 smoke는 재검토 가능한 JSON evidence를 남기고, evidence pack generator는 이를 모아 내부 배포에 필요한
문서 4종을 자동 생성한다.

1차 목표는 개발 루프의 마지막 정리 비용을 줄이는 것이다. Windows installer, updater, signing, packaged
runtime smoke의 pass/fail/blocker를 사람이 다시 표로 옮기지 않아도 내부 릴리스 판단이 가능해야 한다.

## 배경

현재 Windows release smoke는 `pack:electron`, `smoke:windows:package-gate`,
`smoke:windows:updater-local-feed`, `smoke:windows:updater-github-feed`,
`smoke:windows:signing-evidence`, packaged launch, installer install/runtime v2 smoke처럼 여러
명령으로 나뉜다. 일부 script는 이미 JSON payload를 출력하거나 공통 smoke artifact helper를 사용할 수
있는 구조지만, 최종 운영 handoff, 내부 release note, 설치/업데이트 안내, pilot checklist는 여전히 사람이
결과를 읽고 재작성한다.

이 설계는 smoke pass 기준을 바꾸지 않고, 결과 수집과 문서 생성을 표준화한다. Windows code signing이나
SmartScreen reputation 자체를 해결하지 않는다. unsigned 상태는 자동으로 blocker/caveat로 분류한다.

## 범위

1차 범위:

- Windows smoke evidence 공통 schema를 정의한다.
- 기존 smoke 출력 또는 artifact JSON을 읽어 `summary.json`을 생성한다.
- 새 명령 `corepack pnpm smoke:windows:evidence-pack`을 추가한다.
- `--from <dir>` 모드는 이미 생성된 evidence JSON만 읽어 문서를 만든다.
- `--run` 모드는 기존 Windows smoke 명령을 순서대로 실행하고 같은 evidence directory에 결과를 쓴다.
- 운영 handoff, 내부 release note, 설치/업데이트 안내, 내부 pilot checklist를 Markdown으로 생성한다.
- `FOLLOW-UP.md`는 전체 표 자동 편집보다 생성된 evidence pack 링크만 갱신하는 좁은 방식으로 시작한다.

대상 문서:

- `docs/operations/YYYY-MM-DD-windows-release-evidence.md`
- `docs/releases/YYYY-MM-DD-internal-release-note.md`
- `docs/releases/YYYY-MM-DD-install-update-guide.md`
- `docs/releases/YYYY-MM-DD-internal-pilot-checklist.md`
- `docs/FOLLOW-UP.md`의 최신 evidence pack 링크 1줄

대상 smoke:

- `corepack pnpm smoke:windows:update-metadata`
- `corepack pnpm smoke:windows:signing-evidence`
- `corepack pnpm smoke:windows:updater-local-feed`
- `corepack pnpm smoke:windows:updater-published-channel`
- `corepack pnpm smoke:windows:updater-github-feed`
- `corepack pnpm smoke:windows:packaged-launch`
- `corepack pnpm smoke:windows:engine-lifecycle`
- `corepack pnpm smoke:windows:packaged-runtime-v2`
- `corepack pnpm smoke:windows:installer-install`
- `corepack pnpm smoke:windows:installer-runtime-v2`
- `corepack pnpm smoke:windows:package-gate`
- `corepack pnpm smoke:windows:release-gate`

## 비범위

- smoke pass/fail 판정을 변경하지 않는다.
- Windows installer signing, timestamping, SmartScreen reputation 확보를 자동화하지 않는다.
- GitHub Release asset publish를 자동 실행하지 않는다.
- 실제 설치된 앱을 rollback하는 mutating drill을 1차 범위에 넣지 않는다.
- release note를 GitHub Release body에 자동 게시하지 않는다.
- 기존 smoke stdout contract를 breaking change로 바꾸지 않는다.

## 사용자 흐름

이미 smoke를 실행한 경우:

```bash
corepack pnpm smoke:windows:evidence-pack --from artifacts/smoke/windows/20260509T010203Z
```

새로 smoke를 실행하고 문서를 만들 경우:

```bash
corepack pnpm smoke:windows:evidence-pack --run
```

예상 산출물:

```text
artifacts/smoke/windows/20260509T010203Z/
  update-metadata.json
  signing-evidence.json
  updater-local-feed.json
  updater-github-feed.json
  packaged-launch.json
  installer-runtime-v2.json
  package-gate.json
  release-gate.json
  summary.json

docs/operations/2026-05-09-windows-release-evidence.md
docs/releases/2026-05-09-internal-release-note.md
docs/releases/2026-05-09-install-update-guide.md
docs/releases/2026-05-09-internal-pilot-checklist.md
```

## Evidence Schema

개별 evidence 파일은 다음 최소 shape를 사용한다.

```json
{
  "schemaVersion": 1,
  "smokeName": "windows-updater-local-feed",
  "command": "corepack pnpm smoke:windows:updater-local-feed",
  "status": "passed",
  "startedAt": "2026-05-09T01:02:03.000Z",
  "endedAt": "2026-05-09T01:04:03.000Z",
  "durationMs": 120000,
  "version": "0.4.13",
  "checks": [
    { "name": "download", "status": "passed" },
    { "name": "quitAndInstall", "status": "passed" },
    { "name": "post-update-launch", "status": "passed" }
  ],
  "blockers": [],
  "caveats": []
}
```

`status` 값:

- `passed`
- `failed`
- `blocked`
- `manual-required`

`summary.json`은 개별 evidence를 집계한다.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-09T01:05:00.000Z",
  "version": "0.4.13",
  "overallStatus": "blocked",
  "internalReleaseReady": true,
  "externalReleaseReady": false,
  "passed": ["package-gate", "updater-local-feed"],
  "blocked": ["signing-evidence"],
  "manualRequired": ["smart-screen-reputation"],
  "blockers": [
    "installer and executable are unsigned"
  ],
  "caveats": [
    "internal pilot may proceed only through trusted internal distribution"
  ],
  "documents": []
}
```

## Redaction

Evidence와 생성 문서는 운영 판단에 필요한 사실만 담는다.

저장하지 않는 값:

- auth token, cookie, password
- temp HOME 경로
- full workspace path
- full install temp path
- raw stdout/stderr
- terminal output
- Codex prompt/assistant text
- session name, tab id, workspace id
- GitHub token

보존 가능한 값:

- app version, commit short hash
- artifact basename
- release asset basename
- smoke command name
- duration
- pass/fail/blocker code
- Windows version, architecture
- signed/unsigned 상태
- updater 단계 이름과 결과

## 문서 생성 규칙

### 운영 Handoff

운영 handoff는 가장 자세한 문서다.

포함:

- version, commit, generatedAt
- evidence directory
- smoke별 result table
- blockers/caveats
- code signing/SmartScreen 상태
- installer/update/runtime v2 terminal 결과
- 다음 운영 action

### 내부 Release Note

내부 사용자에게 필요한 변경과 제한만 담는다.

포함:

- 릴리스 목적
- 확인된 동작
- 알려진 제한
- 내부 파일럿 가능 여부
- 외부 공개 차단 여부

Raw smoke log, script 내부 path, temp install path는 넣지 않는다.

### 설치/업데이트 안내

내부 사용자 또는 배포 담당자가 그대로 따라 할 수 있는 순서로 작성한다.

포함:

- 설치 전 확인
- installer 실행
- `/api/health` 확인
- updater 확인
- 문제 발생 시 보고 항목
- unsigned caveat가 있으면 SmartScreen/unknown publisher 안내

### 내부 Pilot Checklist

3~5명 장시간 사용 검증용 checklist다.

포함:

- fresh install/update 구분
- Windows version
- app launch
- workspace create/open
- terminal create/input/output
- Codex CLI 실제 사용
- app close 후 engine 유지
- reconnect/update/crash 기록

## Architecture

### `windows-evidence-pack-lib.mjs`

책임:

- evidence directory 생성
- 개별 evidence file 읽기/검증
- stdout JSON fallback 파싱
- summary 계산
- Markdown 문서 render
- redaction

이 모듈은 순수 함수 중심으로 테스트한다.

### `smoke-windows-evidence-pack.mjs`

책임:

- CLI argument 처리
- `--run` mode에서 smoke command 실행
- `--from` mode에서 기존 evidence directory 로드
- 생성 파일 path 출력
- 실패 시 blocker summary를 JSON으로 출력하고 non-zero exit

### 기존 Windows smoke script

1차에서는 가능한 기존 stdout JSON을 보존한다. 이미 artifact writer를 쓰는 script는 같은 helper를
재사용하고, 부족한 script는 evidence pack runner가 wrapper evidence를 만든다.

2차에서 각 smoke script가 직접 richer evidence를 쓰도록 넓힌다.

## Error Handling

- evidence directory가 없으면 `evidence-dir-not-found`.
- JSON parse 실패는 해당 smoke를 `failed`로 표시하고 summary에 blocker로 넣는다.
- 필수 smoke가 누락되면 `manual-required` 또는 `blocked`로 분류한다.
- signing evidence가 unsigned를 보고하면 internal release는 caveat付き 가능, external release는 blocked다.
- updater GitHub feed처럼 실제 publish가 필요한 smoke가 실행되지 않았으면 `manual-required`다.
- 문서 생성 중 기존 파일이 있으면 기본은 덮어쓰지 않고 `--force`가 있을 때만 덮어쓴다.

## Testing

단위 테스트:

- evidence schema normalize
- pass/fail/blocker/manual-required 집계
- unsigned signing policy
- updater 단계 table rendering
- redaction
- Markdown 4종 생성
- missing evidence 처리
- existing document overwrite guard

명령 검증:

```bash
corepack pnpm test tests/unit/scripts/windows-evidence-pack-lib.test.ts
node --check scripts/smoke-windows-evidence-pack.mjs
corepack pnpm smoke:windows:evidence-pack --from tests/fixtures/windows-evidence
```

Release 전 확장 검증:

```bash
corepack pnpm smoke:windows:evidence-pack --run
```

## Rollout

1. `tests/fixtures/windows-evidence/`에 최소 pass/blocked fixture를 추가한다.
2. `windows-evidence-pack-lib.mjs` 순수 집계/렌더 함수를 구현한다.
3. `smoke-windows-evidence-pack.mjs` CLI를 추가한다.
4. `package.json`에 `smoke:windows:evidence-pack` script를 추가한다.
5. 문서 4종 생성과 `summary.json` 생성을 검증한다.
6. 기존 smoke scripts의 stdout contract를 바꾸지 않고 wrapper mode로 먼저 운영한다.
7. 후속 slice에서 개별 smoke script가 richer evidence를 직접 쓰도록 확장한다.

## 성공 기준

- `--from` mode가 fixture evidence로 `summary.json`과 문서 4종을 생성한다.
- unsigned artifact는 external release blocker로 분류된다.
- internal release note에는 unsigned caveat가 자동 포함된다.
- install/update guide에는 `/api/health`와 updater 확인 단계가 포함된다.
- pilot checklist에는 3~5명 장시간 workspace 사용 항목이 포함된다.
- 생성 문서와 summary에 raw stdout/stderr, token, temp path, terminal output이 없다.
- 기존 Windows smoke 명령의 pass/fail 기준과 stdout JSON은 깨지지 않는다.

## Self Review

- Placeholder 없음.
- 1차 범위는 evidence 수집/집계/문서 생성으로 제한했다.
- Windows signing/SmartScreen 해결, GitHub publish, mutating rollback drill은 비범위로 분리했다.
- `FOLLOW-UP.md` 자동 편집은 링크 1줄 갱신으로 제한해 문서 churn을 줄였다.
- 구현 전 TDD 대상과 성공 기준이 명확하다.
